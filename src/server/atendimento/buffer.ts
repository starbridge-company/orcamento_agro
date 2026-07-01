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
  quietConversations,
  resetStaleLocks,
} from "./repository";
import { runAgentForConversation } from "./agentRunner";

const timers = new Map<string, NodeJS.Timeout>();
const STALE_LOCK_SECONDS = 5 * 60;
// Margem para o timer disparar DEPOIS da expiração da última bolha (evita a
// reivindicação achar a última bolha ainda "fresca" por milissegundos).
const TIMER_MARGIN_MS = 400;

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
  const t = new Date().toLocaleTimeString("pt-BR");
  console.log(
    `[buffer] ${t} bolha enfileirada (conversa ${conversationId}); aguardando ${config.cotacao.bufferWindowSeconds}s de silêncio`,
  );
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
    config.cotacao.bufferWindowSeconds * 1000 + TIMER_MARGIN_MS,
  );

  timers.set(conversationId, timer);
}

async function processBuffer(conversationId: string): Promise<void> {
  // A reivindicação só retorna bolhas se a conversa estiver quieta pela janela
  // inteira; senão devolve vazio (ainda chegando mensagem) — evita responder no
  // meio da rajada.
  const rows = await claimBufferedMessages(conversationId);
  if (rows.length === 0) return;

  const t = new Date().toLocaleTimeString("pt-BR");
  console.log(
    `[buffer] ${t} conversa ${conversationId}: JUNTANDO ${rows.length} bolha(s) numa resposta — acionando agente`,
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

  // Recuperação: independente da janela, varre a cada 5-15s (não precisa ser
  // tão frequente quanto o timer em memória, que já dá a resposta rápida).
  const intervalMs =
    Math.min(15, Math.max(5, config.cotacao.bufferWindowSeconds)) * 1000;
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
  // Só processa conversas quietas pela janela inteira (a reivindicação também
  // reconfirma isso atomicamente).
  const conversationIds = await quietConversations();
  for (const id of conversationIds) {
    await processBuffer(id).catch((error) =>
      console.error(`[buffer] sweep conversa ${id}:`, error),
    );
  }
}
