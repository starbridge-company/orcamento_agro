/**
 * Orquestrador do fluxo INBOUND (agente conversacional).
 *
 * Etapa 1: parse do messages.upsert -> acha a conversa pelo telefone -> grava a
 * mensagem do fornecedor (idempotente) -> aplica o gate (só a IA responde se
 * responsible='Agente'). Buffer/agente/mídia entram nas próximas etapas.
 */
import { parseEvolutionMessage } from "./parse";
import {
  findConversationByPhone,
  insertSupplierMessage,
  messageExists,
} from "./repository";
import { enqueue } from "./buffer";
import { agentShouldHandle } from "./gate";
import { resolveMediaText } from "./media";

interface EvolutionEvent {
  event?: string;
  data?: { key?: { fromMe?: boolean } };
}

export async function handleEvolutionEvent(body: unknown): Promise<void> {
  const evt = (body ?? {}) as EvolutionEvent;

  // Só nos interessa mensagem recebida (não as que nós mesmos enviamos).
  if (evt.event !== "messages.upsert") return;
  if (evt.data?.key?.fromMe) return;

  const parsed = parseEvolutionMessage(evt);
  if (!parsed) return;

  const conversation = await findConversationByPhone(parsed.phone);
  if (!conversation) {
    console.log(
      `[inbound] sem conversa p/ ${parsed.phone} (fornecedor desconhecido) — ignorando`,
    );
    return;
  }

  // Idempotência: não processa a mesma mensagem duas vezes.
  if (parsed.waMessageId && (await messageExists(parsed.waMessageId))) {
    console.log(`[inbound] msg ${parsed.waMessageId} já processada — ignorando`);
    return;
  }

  // Mídia (áudio/imagem/PDF) vira texto; texto passa direto. Falha na mídia
  // cai para "Arquivo não suportado" (o agente pede reenvio em PDF).
  let content = parsed.text;
  if (parsed.mediaType !== "text") {
    try {
      content = await resolveMediaText(parsed);
      console.log(
        `[inbound] mídia '${parsed.mediaType}' resolvida (conversa ${conversation.id})`,
      );
    } catch (error) {
      console.warn(
        `[inbound] falha ao processar mídia '${parsed.mediaType}':`,
        (error as Error).message,
      );
      content = "Arquivo não suportado";
    }
  }

  await insertSupplierMessage({
    conversationId: conversation.id,
    content,
    mediaType: parsed.mediaType,
    waMessageId: parsed.waMessageId,
    sentAt: new Date(),
  });
  console.log(
    `[inbound] msg do fornecedor gravada (conversa ${conversation.id}, tipo=${parsed.mediaType})`,
  );

  // Gate: a IA só responde se a conversa está com o Agente e não foi resolvida.
  if (!agentShouldHandle(conversation)) {
    console.log(
      `[inbound] conversa ${conversation.id} fora do atendimento da IA (resp=${conversation.responsible}, status=${conversation.status}) — não aciona agente`,
    );
    return;
  }

  // Debounce: agrega as bolhas em rajada antes de acionar o agente.
  await enqueue(conversation.id, {
    waMessageId: parsed.waMessageId,
    content,
    mediaType: parsed.mediaType,
    senderName: parsed.senderName,
    phone: parsed.phone,
  });
}
