/**
 * Debounce de mensagens (réplica do message_buffer do n8n).
 *
 * Cada bolha recebida é gravada no buffer e reinicia um timer por conversa.
 * Passada a janela de silêncio (config.cotacao.bufferWindowSeconds), as bolhas
 * expiradas são reivindicadas (com lock), agregadas e entregues ao agente —
 * assim, uma rajada de mensagens vira um único input.
 */
import { config } from "../config";
import {
  claimBufferedMessages,
  deleteBuffered,
  insertBuffer,
  pendingExpiredConversations,
  resetStaleLocks,
} from "./repository";
import { runAgentForConversation } from "./agentRunner";

const timers = new Map<string, NodeJS.Timeout>();
const STALE_LOCK_SECONDS = 5 * 60;

export interface EnqueueInput {
  waMessageId: string | null;
  content: string | null;
  mediaType: string;
  senderName: string | null;
  phone: string | null;
}

export async function enqueue(
  conversationId: string,
  msg: EnqueueInput,
): Promise<void> {
  await insertBuffer({
    conversationId,
    ...msg,
    windowSeconds: config.cotacao.bufferWindowSeconds,
  });
  scheduleProcessing(conversationId);
}

function scheduleProcessing(conversationId: string): void {
  const existing = timers.get(conversationId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(
    () => {
      timers.delete(conversationId);
      processBuffer(conversationId).catch((error) =>
        console.error(
          `[buffer] falha ao processar conversa ${conversationId}:`,
          error,
        ),
      );
    },
    config.cotacao.bufferWindowSeconds * 1000,
  );

  timers.set(conversationId, timer);
}

async function processBuffer(conversationId: string): Promise<void> {
  const rows = await claimBufferedMessages(conversationId);
  if (rows.length === 0) return; // nada expirado ainda / já processado

  console.log(
    `[buffer] conversa ${conversationId}: ${rows.length} bolha(s) — acionando agente`,
  );

  // O agente lê o histórico da conversa (que já inclui estas bolhas); o buffer
  // serve como gatilho de debounce. Removemos as bolhas ao final.
  try {
    await runAgentForConversation(conversationId);
  } finally {
    await deleteBuffered(rows.map((r) => r.id));
  }
}

/**
 * Sweeper de segurança: timers em memória se perdem num restart. Este intervalo
 * reabre locks presos e processa conversas com bolhas expiradas que ficaram
 * sem timer. Idempotente com o claim (quem pega as linhas processa; o resto
 * vira no-op).
 */
let sweeperStarted = false;

export function startBufferSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;

  const intervalMs =
    Math.max(5, config.cotacao.bufferWindowSeconds) * 1000;
  const timer = setInterval(() => {
    sweep().catch((error) => console.error("[buffer] sweeper falhou:", error));
  }, intervalMs);
  timer.unref(); // não segura o processo vivo

  console.log(`[buffer] sweeper ativo (a cada ${intervalMs / 1000}s)`);
}

async function sweep(): Promise<void> {
  const reopened = await resetStaleLocks(STALE_LOCK_SECONDS);
  if (reopened > 0) {
    console.warn(`[buffer] ${reopened} lock(s) preso(s) reaberto(s)`);
  }
  const conversationIds = await pendingExpiredConversations();
  for (const id of conversationIds) {
    await processBuffer(id).catch((error) =>
      console.error(`[buffer] sweep conversa ${id}:`, error),
    );
  }
}
