/**
 * Acesso ao banco para o fluxo INBOUND (agente conversacional).
 * Reusa `quote_conversations` (estado) e `quote_conversation_messages`
 * (histórico). A conversa é localizada pelo TELEFONE do fornecedor.
 */
import { getPool } from "../db/pool";

/**
 * Variações do telefone para tolerar o 9º dígito de celular brasileiro
 * (55 + DDD + [9]XXXXXXXX): tenta com e sem o 9.
 */
function phoneVariants(phone: string): string[] {
  const set = new Set<string>([phone]);
  if (phone.startsWith("55") && phone.length >= 12) {
    const dd = phone.slice(2, 4);
    const rest = phone.slice(4);
    if (rest.length === 9 && rest.startsWith("9")) {
      set.add(`55${dd}${rest.slice(1)}`);
    } else if (rest.length === 8) {
      set.add(`55${dd}9${rest}`);
    }
  }
  return [...set];
}

export interface InboundConversation {
  id: string;
  quoteId: string;
  supplierId: string;
  responsible: string;
  status: string;
  supplierName: string;
  phone: string | null;
}

/** Acha a conversa ATIVA mais recente de um fornecedor pelo telefone. */
export async function findConversationByPhone(
  phone: string,
): Promise<InboundConversation | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    quote_id: string;
    supplier_id: string;
    responsible: string;
    status: string;
    supplier_name: string;
    phone: string | null;
  }>(
    `SELECT qc.id, qc.quote_id, qc.supplier_id, qc.responsible, qc.status,
            s.name AS supplier_name, s.phone
       FROM agro.quote_conversations qc
       JOIN agro.suppliers s ON s.id = qc.supplier_id
      WHERE qc.deleted_at IS NULL AND s.phone = ANY($1)
      ORDER BY qc.created_at DESC, qc.id DESC
      LIMIT 1`,
    [phoneVariants(phone)],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    quoteId: r.quote_id,
    supplierId: r.supplier_id,
    responsible: r.responsible,
    status: r.status,
    supplierName: r.supplier_name,
    phone: r.phone,
  };
}

/** Idempotência: já gravamos essa mensagem (por wa_message_id)? */
export async function messageExists(waMessageId: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM agro.quote_conversation_messages
      WHERE wa_message_id = $1 LIMIT 1`,
    [waMessageId],
  );
  return rows.length > 0;
}

export interface SupplierMessageInput {
  conversationId: string;
  content: string | null;
  mediaType: string; // text | audio | image | pdf
  waMessageId: string | null;
  sentAt: Date;
}

/** Grava a mensagem recebida do fornecedor (author='supplier'). */
export async function insertSupplierMessage(
  m: SupplierMessageInput,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO agro.quote_conversation_messages
       (conversation_id, author, content, message_type, wa_message_id, sent_at)
     VALUES ($1, 'supplier', $2, $3, $4, $5)`,
    [m.conversationId, m.content, m.mediaType, m.waMessageId, m.sentAt],
  );
}

export interface AgentConversation {
  id: string;
  phone: string | null;
  initialMessage: string | null;
  responsible: string;
  status: string;
}

/** Dados da conversa que o agente precisa (por id da conversa). */
export async function getConversationForAgent(
  conversationId: string,
): Promise<AgentConversation | null> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    phone: string | null;
    initial_message: string | null;
    responsible: string;
    status: string;
  }>(
    `SELECT qc.id, s.phone, qc.initial_message, qc.responsible, qc.status
       FROM agro.quote_conversations qc
       JOIN agro.suppliers s ON s.id = qc.supplier_id
      WHERE qc.id = $1 AND qc.deleted_at IS NULL`,
    [conversationId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    phone: r.phone,
    initialMessage: r.initial_message,
    responsible: r.responsible,
    status: r.status,
  };
}

export interface HistoryMessage {
  author: string;
  content: string | null;
}

/** Últimas `limit` mensagens da conversa, em ordem cronológica. */
export async function getRecentMessages(
  conversationId: string,
  limit: number,
): Promise<HistoryMessage[]> {
  const pool = getPool();
  const { rows } = await pool.query<HistoryMessage>(
    `SELECT author, content FROM (
       SELECT author, content, COALESCE(sent_at, created_at) AS ts, id
         FROM agro.quote_conversation_messages
        WHERE conversation_id = $1 AND deleted_at IS NULL
        ORDER BY ts DESC, id DESC
        LIMIT $2
     ) recent
     ORDER BY ts ASC, id ASC`,
    [conversationId, limit],
  );
  return rows;
}

/**
 * Aplica o resultado do agente ao estado da conversa:
 *   - status: sempre atualizado (reflete o andamento no painel).
 *   - responsible: vira 'Humano' quando a tag é atendimento_n2 (escala); nos
 *     demais casos permanece 'Agente'.
 */
export async function applyAgentOutcome(
  conversationId: string,
  tag: string,
  status: string,
): Promise<void> {
  const pool = getPool();
  if (tag === "atendimento_n2") {
    await pool.query(
      `UPDATE agro.quote_conversations
          SET status = $2, responsible = 'Humano', updated_at = now()
        WHERE id = $1`,
      [conversationId, status],
    );
  } else {
    await pool.query(
      `UPDATE agro.quote_conversations
          SET status = $2, updated_at = now()
        WHERE id = $1`,
      [conversationId, status],
    );
  }
}

/** Grava a resposta do agente (author='system'). */
export async function insertAgentMessage(m: {
  conversationId: string;
  content: string;
  waMessageId: string | null;
  sentAt: Date;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO agro.quote_conversation_messages
       (conversation_id, author, content, message_type, wa_message_id, sent_at)
     VALUES ($1, 'system', $2, 'text', $3, $4)`,
    [m.conversationId, m.content, m.waMessageId, m.sentAt],
  );
}

// ---- Buffer de debounce ---------------------------------------------------

export interface BufferRow {
  id: string;
  conversationId: string;
  waMessageId: string | null;
  content: string | null;
  mediaType: string;
  senderName: string | null;
  phone: string | null;
}

/** Enfileira uma bolha no buffer, com expiração = agora + janela de debounce. */
export async function insertBuffer(row: {
  conversationId: string;
  waMessageId: string | null;
  content: string | null;
  mediaType: string;
  senderName: string | null;
  phone: string | null;
  windowSeconds: number;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO agro.message_buffer
       (conversation_id, wa_message_id, content, media_type, sender_name, phone, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [
      row.conversationId,
      row.waMessageId,
      row.content,
      row.mediaType,
      row.senderName,
      row.phone,
      String(row.windowSeconds),
    ],
  );
}

/**
 * Reivindica (com lock) as bolhas de uma conversa — SOMENTE se ela estiver
 * quieta pela janela inteira, isto é, se NENHUMA bolha pendente ainda estiver
 * "fresca" (expires_at no futuro). É o coração do debounce: só dispara o agente
 * quando parou de chegar mensagem há `windowSeconds`. Atômico (sem corrida):
 * marca processing_at e devolve TODAS as bolhas pendentes de uma vez.
 */
export async function claimBufferedMessages(
  conversationId: string,
): Promise<BufferRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    conversation_id: string;
    wa_message_id: string | null;
    content: string | null;
    media_type: string;
    sender_name: string | null;
    phone: string | null;
  }>(
    `UPDATE agro.message_buffer m
        SET processing_at = now()
      WHERE m.conversation_id = $1
        AND m.processing_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM agro.message_buffer b
           WHERE b.conversation_id = $1
             AND b.processing_at IS NULL
             AND b.expires_at > now()   -- ainda dentro da janela (chegou há pouco)
        )
      RETURNING id, conversation_id, wa_message_id, content, media_type, sender_name, phone`,
    [conversationId],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    waMessageId: r.wa_message_id,
    content: r.content,
    mediaType: r.media_type,
    senderName: r.sender_name,
    phone: r.phone,
  }));
}

/** Remove bolhas já processadas do buffer. */
export async function deleteBuffered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const pool = getPool();
  await pool.query(`DELETE FROM agro.message_buffer WHERE id = ANY($1)`, [ids]);
}

/** Reabre locks presos (processamento que travou/caiu). Retorna quantos. */
export async function resetStaleLocks(olderThanSeconds: number): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE agro.message_buffer
        SET processing_at = NULL
      WHERE processing_at IS NOT NULL
        AND processing_at < now() - ($1 || ' seconds')::interval`,
    [String(olderThanSeconds)],
  );
  return rowCount ?? 0;
}

/**
 * Conversas QUIETAS (última bolha já passou da janela) e ainda não travadas —
 * candidatas a processar. Usada pelo sweeper (recuperação pós-restart). O
 * `MAX(expires_at) <= now()` garante "quieto desde a última mensagem".
 */
export async function quietConversations(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ conversation_id: string }>(
    `SELECT conversation_id FROM agro.message_buffer
      WHERE processing_at IS NULL
      GROUP BY conversation_id
      HAVING MAX(expires_at) <= now()`,
  );
  return rows.map((r) => r.conversation_id);
}
