/**
 * Rotas de cotação (montadas em /api/cotacoes, atrás de requireAuth).
 *
 * POST /            -> registra a cotação e dispara o pipeline assíncrono.
 * GET  /            -> lista cotações (com materiais e contagem de conversas).
 * GET  /conversas   -> conversas (respostas dos fornecedores); ?quote_id=N.
 * PATCH /conversas/:id -> troca o responsável (Agente | Humano).
 * GET  /conversas/:id/mensagens -> mensagens da conversa (ordem cronológica).
 * GET  /:id         -> detalhe de uma cotação (registrado por ÚLTIMO para o
 *                      parâmetro :id não capturar "conversas").
 */
import { Router, type Request, type Response } from "express";
import { cotacaoSchema } from "../schema";
import { getPool } from "../db/pool";
import { submitQuote } from "./service";

/** Domínio de origem da requisição (respeita proxy reverso), p/ link do painel. */
function resolveDominio(req: Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || req.get("host") || "";
  const proto = forwardedProto || req.protocol;
  return host ? `${proto}://${host}` : "";
}

export function buildCotacoesRouter(): Router {
  const router = Router();

  /**
   * Recebe a cotação validada, grava no banco (quote + quote_products) e
   * dispara o pipeline assíncrono que localiza fornecedores e os contata.
   * Responde na hora (não espera o pipeline); o comprador é avisado por e-mail.
   */
  router.post("/", async (req: Request, res: Response) => {
    const parsed = cotacaoSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados da cotação inválidos.",
        errors: parsed.error.flatten(),
      });
    }

    try {
      const { id } = await submitQuote(parsed.data, resolveDominio(req));
      return res.status(201).json({
        id,
        message:
          "Cotação recebida! Estamos localizando fornecedores e você será avisado por e-mail.",
      });
    } catch (error) {
      console.error("Falha ao registrar cotação:", error);
      return res.status(500).json({
        message:
          "Não foi possível registrar a cotação no momento. Tente novamente.",
      });
    }
  });

  /**
   * Lista as cotações (quote) com os materiais solicitados (quote_products)
   * e a quantidade de respostas de fornecedores (quote_conversations).
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const pool = getPool();
      const { rows } = await pool.query(`
        SELECT
          q.id,
          q.buyer_name,
          q.email,
          q.city,
          q.state,
          q.supply_group,
          q.status,
          q.created_at,
          COALESCE((
            SELECT json_agg(
                     json_build_object(
                       'id', qp.id,
                       'material', qp.material,
                       'quantity', qp.quantity,
                       'unit', qp.unit,
                       'brand', qp.brand
                     ) ORDER BY qp.id
                   )
            FROM agro.quote_products qp
            WHERE qp.quote_id = q.id AND qp.deleted_at IS NULL
          ), '[]') AS products,
          (
            SELECT COUNT(*)::int
            FROM agro.quote_conversations qc
            WHERE qc.quote_id = q.id AND qc.deleted_at IS NULL
          ) AS conversation_count
        FROM agro.quote q
        WHERE q.deleted_at IS NULL
        ORDER BY q.created_at DESC, q.id DESC
      `);
      return res.status(200).json({ cotacoes: rows });
    } catch (error) {
      console.error("Falha ao listar cotações:", error);
      return res.status(500).json({
        message: "Não foi possível carregar as cotações no momento.",
      });
    }
  });

  /**
   * Lista as conversas de cotação (quote_conversations) refletindo os dados do
   * fornecedor (suppliers). Aceita ?quote_id=N para filtrar.
   */
  router.get("/conversas", async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      const quoteIdRaw = req.query.quote_id;
      const quoteId = typeof quoteIdRaw === "string" ? Number(quoteIdRaw) : NaN;
      const hasFilter = Number.isInteger(quoteId);

      const { rows } = await pool.query(
        `
        SELECT
          qc.id,
          qc.quote_id,
          q.buyer_name        AS buyer_name,
          qc.responsible,
          qc.dispatch_number,
          s.name              AS supplier_name,
          s.city              AS supplier_city,
          s.phone             AS phone,
          qc.initial_message,
          qc.status,
          qc.delivery_time,
          qc.payment_method,
          qc.shipping,
          qc.taxes,
          qc.volume,
          qc.proposal_validity,
          qc.metadata,
          qc.created_at,
          qc.updated_at
        FROM agro.quote_conversations qc
        JOIN agro.suppliers s ON s.id = qc.supplier_id
        LEFT JOIN agro.quote q ON q.id = qc.quote_id
        WHERE qc.deleted_at IS NULL
        ${hasFilter ? "AND qc.quote_id = $1" : ""}
        ORDER BY qc.quote_id DESC, qc.dispatch_number ASC, qc.id ASC
        `,
        hasFilter ? [quoteId] : [],
      );
      return res.status(200).json({ conversas: rows });
    } catch (error) {
      console.error("Falha ao listar conversas de cotação:", error);
      return res.status(500).json({
        message: "Não foi possível carregar as conversas no momento.",
      });
    }
  });

  /** Atualiza o responsável (Agente | Humano) de uma conversa de cotação. */
  router.patch("/conversas/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { responsible } = req.body ?? {};

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    if (responsible !== "Agente" && responsible !== "Humano") {
      return res
        .status(400)
        .json({ message: "Responsável deve ser 'Agente' ou 'Humano'." });
    }

    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `UPDATE agro.quote_conversations
            SET responsible = $1, updated_at = now()
          WHERE id = $2 AND deleted_at IS NULL
          RETURNING id, responsible`,
        [responsible, id],
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: "Conversa não encontrada." });
      }
      return res.status(200).json({ conversa: rows[0] });
    } catch (error) {
      console.error("Falha ao atualizar responsável:", error);
      return res.status(500).json({
        message: "Não foi possível atualizar o responsável.",
      });
    }
  });

  /**
   * Lista as mensagens (quote_conversation_messages) de uma conversa, em ordem
   * cronológica. Usado pelo chat do frontend.
   */
  router.get("/conversas/:id/mensagens", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT
           id,
           conversation_id,
           author,
           content,
           message_type,
           wa_message_id,
           media_url,
           sent_at,
           created_at
         FROM agro.quote_conversation_messages
         WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY COALESCE(sent_at, created_at) ASC, id ASC`,
        [id],
      );
      return res.status(200).json({ mensagens: rows });
    } catch (error) {
      console.error("Falha ao listar mensagens da conversa:", error);
      return res.status(500).json({
        message: "Não foi possível carregar as mensagens no momento.",
      });
    }
  });

  /**
   * Detalhe de UMA cotação (quote) com seus materiais. Registrado depois das
   * rotas "/conversas..." para que o parâmetro :id não capture "conversas".
   */
  router.get("/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "ID inválido." });
    }
    try {
      const pool = getPool();
      const { rows } = await pool.query(
        `
        SELECT
          q.id,
          q.buyer_name,
          q.email,
          q.city,
          q.state,
          q.supply_group,
          q.status,
          q.created_at,
          COALESCE((
            SELECT json_agg(
                     json_build_object(
                       'id', qp.id,
                       'material', qp.material,
                       'quantity', qp.quantity,
                       'unit', qp.unit,
                       'brand', qp.brand
                     ) ORDER BY qp.id
                   )
            FROM agro.quote_products qp
            WHERE qp.quote_id = q.id AND qp.deleted_at IS NULL
          ), '[]') AS products,
          (
            SELECT COUNT(*)::int
            FROM agro.quote_conversations qc
            WHERE qc.quote_id = q.id AND qc.deleted_at IS NULL
          ) AS conversation_count
        FROM agro.quote q
        WHERE q.id = $1 AND q.deleted_at IS NULL
        `,
        [id],
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: "Cotação não encontrada." });
      }
      return res.status(200).json({ cotacao: rows[0] });
    } catch (error) {
      console.error("Falha ao obter cotação:", error);
      return res.status(500).json({
        message: "Não foi possível carregar a cotação no momento.",
      });
    }
  });

  return router;
}
