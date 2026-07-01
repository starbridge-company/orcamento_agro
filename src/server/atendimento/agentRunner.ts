/**
 * Aciona o agente conversacional para uma conversa (chamado pelo buffer após a
 * janela de debounce):
 *   1. carrega a conversa (com a cotação original) + histórico recente
 *   2. gera a resposta (agente) → { message, tag, reasoning }
 *   3. envia a resposta ao fornecedor (Evolution) e grava no histórico
 *
 * Segurança: em MODO TESTE (DISPATCH_TEST_RECIPIENT preenchido) a resposta vai
 * para o número de teste, não para o fornecedor real.
 * (Etapa 4 aplicará a tag ao estado da conversa: responsible/status.)
 */
import { config } from "../config";
import { normalizePhone } from "../cotacoes/pipeline/phone";
import { sendText } from "../cotacoes/providers/evolution";
import { generateReply } from "./agent";
import {
  applyAgentOutcome,
  getConversationForAgent,
  getLastAgentMessage,
  getRecentMessages,
  insertAgentMessage,
  saveProposal,
} from "./repository";
import { agentShouldHandle } from "./gate";

const HISTORY_WINDOW = 15;

// Acima deste Jaccard de palavras, a nova resposta é tratada como duplicata da
// anterior e NÃO é reenviada. Calibrado com conversas reais: duplicatas ficaram
// em 0.68-0.88 e a transição legítima mais próxima em 0.46 — 0.6 separa com folga.
const DUPLICATE_SIMILARITY = 0.6;

/** Normaliza para comparação: minúsculas, sem acento, sem pontuação, 1 espaço. */
function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (marcas combinantes)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similaridade de Jaccard entre os conjuntos de palavras de a e b (0..1). */
function wordSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return wa.size === wb.size ? 1 : 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export async function runAgentForConversation(
  conversationId: string,
): Promise<void> {
  const conv = await getConversationForAgent(conversationId);
  if (!conv) return;

  // Revalida o gate: pode ter virado Humano/resolvido durante a janela.
  if (!agentShouldHandle(conv)) {
    console.log(`[agent] conversa ${conversationId} fora do atendimento da IA — não responde`);
    return;
  }

  const history = await getRecentMessages(conversationId, HISTORY_WINDOW);
  const { message, tag, status, reasoning, proposal } = await generateReply(
    conv.initialMessage ?? "",
    history,
  );
  console.log(
    `[agent] conversa ${conversationId} tag=${tag} status="${status}"${proposal ? " (proposta extraída)" : ""} | ${reasoning}`,
  );

  // Salva a proposta estruturada (o mais importante) sempre que houver dados.
  if (proposal) {
    await saveProposal(conversationId, proposal);
  }

  if (message && message.trim()) {
    // Dedupe: se a resposta é praticamente idêntica à última que o agente já
    // mandou, NÃO reenvia (evita as duplicatas em rajada). Status/proposta
    // seguem sendo aplicados normalmente abaixo.
    const lastAgentMessage = await getLastAgentMessage(conversationId);
    const similarity = lastAgentMessage
      ? wordSimilarity(lastAgentMessage, message)
      : 0;

    if (similarity >= DUPLICATE_SIMILARITY) {
      console.warn(
        `[agent] resposta ${similarity.toFixed(2)} similar à anterior — ` +
          `suprimindo envio duplicado (conversa ${conversationId})`,
      );
    } else {
      const to =
        normalizePhone(config.cotacao.dispatchTestRecipient) || conv.phone || "";
      if (to) {
        const { waMessageId } = await sendText(to, message);
        await insertAgentMessage({
          conversationId,
          content: message,
          waMessageId,
          sentAt: new Date(),
        });
        console.log(`[agent] resposta enviada p/ ${to} (conversa ${conversationId})`);
      } else {
        console.warn(`[agent] sem telefone p/ responder (conversa ${conversationId})`);
      }
    }
  } else {
    console.log(`[agent] sem mensagem a enviar (tag=${tag})`);
  }

  // Atualiza o status da conversa (e escala para humano se for o caso).
  await applyAgentOutcome(conversationId, tag, status);
}
