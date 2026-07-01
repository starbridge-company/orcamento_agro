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
  getRecentMessages,
  insertAgentMessage,
  saveProposal,
} from "./repository";
import { agentShouldHandle } from "./gate";

const HISTORY_WINDOW = 15;

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
    const to = normalizePhone(config.cotacao.dispatchTestRecipient) || conv.phone || "";
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
  } else {
    console.log(`[agent] sem mensagem a enviar (tag=${tag})`);
  }

  // Atualiza o status da conversa (e escala para humano se for o caso).
  await applyAgentOutcome(conversationId, tag, status);
}
