/**
 * Escritas/leituras no schema `agro` para o pipeline de cotação.
 *
 * Observação sobre ids: colunas BIGINT são serializadas pelo pg como STRING em
 * JS. Mantemos os ids como `string` de ponta a ponta (nada de Number()).
 */
import { getPool } from "../db/pool";
import type { Cotacao } from "../schema";

export type QuoteStatus =
  | "processing"
  | "completed"
  | "no_suppliers"
  | "failed";

/**
 * Cria a cotação (quote) e seus materiais (quote_products) numa única
 * transação. A cotação nasce com status 'processing'; o job assíncrono a
 * atualiza ao final. Retorna o id (string) da cotação criada.
 */
export async function createQuoteWithProducts(data: Cotacao): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO agro.quote (buyer_name, email, city, state, status)
       VALUES ($1, $2, $3, $4, 'processing')
       RETURNING id`,
      [data.nome, data.email, data.cidade, data.estado],
    );
    const quoteId = rows[0].id;

    for (const p of data.produtos) {
      await client.query(
        `INSERT INTO agro.quote_products (quote_id, material, quantity, unit, brand)
         VALUES ($1, $2, $3, $4, $5)`,
        [quoteId, p.material, p.quantidade, p.unidade, p.marca ?? null],
      );
    }

    await client.query("COMMIT");
    return quoteId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Atualiza o status da cotação (usado pelo job ao longo do pipeline). */
export async function setQuoteStatus(
  quoteId: string,
  status: QuoteStatus,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE agro.quote SET status = $2, updated_at = now() WHERE id = $1`,
    [quoteId, status],
  );
}

/** Grava o grupo de insumos classificado (pode conter múltiplos, concatenados). */
export async function setQuoteSupplyGroup(
  quoteId: string,
  supplyGroup: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE agro.quote SET supply_group = $2, updated_at = now() WHERE id = $1`,
    [quoteId, supplyGroup],
  );
}

export interface SupplierInput {
  name: string;
  city: string;
  state: string;
  phone: string;
  address: string | null;
}

/**
 * Encontra (por telefone, entre ativos) ou cria um fornecedor. Evita duplicar
 * o mesmo fornecedor entre cotações distintas. Retorna o id (string).
 */
export async function findOrCreateSupplier(s: SupplierInput): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM agro.suppliers
      WHERE phone = $1 AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
    [s.phone],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agro.suppliers (name, city, state, phone, address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [s.name, s.city, s.state, s.phone, s.address],
  );
  return rows[0].id;
}

export interface ConversationInput {
  quoteId: string;
  supplierId: string;
  dispatchNumber: number;
  initialMessage: string;
}

/** Cria a conversa cotação↔fornecedor (status/responsável usam os defaults). */
export async function createConversation(c: ConversationInput): Promise<string> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO agro.quote_conversations
       (quote_id, supplier_id, dispatch_number, initial_message)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [c.quoteId, c.supplierId, c.dispatchNumber, c.initialMessage],
  );
  return rows[0].id;
}

export interface SystemMessageInput {
  conversationId: string;
  content: string;
  waMessageId: string | null;
  sentAt: Date;
}

/** Registra a mensagem de abertura enviada pelo sistema (author='system'). */
export async function insertSystemMessage(
  m: SystemMessageInput,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO agro.quote_conversation_messages
       (conversation_id, author, content, message_type, wa_message_id, sent_at)
     VALUES ($1, 'system', $2, 'text', $3, $4)`,
    [m.conversationId, m.content, m.waMessageId, m.sentAt],
  );
}
