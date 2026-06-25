import fs from "node:fs";
import path from "node:path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { config } from "./config";
import { cotacaoSchema, toWebhookPayload } from "./schema";
import { getPool } from "./db/pool";

async function bootstrap() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  /**
   * Recebe a cotação validada do frontend e a repassa ao webhook (n8n)
   * configurado em WEBHOOK_URL. Mantém a URL fora do navegador e evita CORS.
   */
  app.post("/api/cotacoes", async (req: Request, res: Response) => {
    const parsed = cotacaoSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados da cotação inválidos.",
        errors: parsed.error.flatten(),
      });
    }

    // Domínio de origem da requisição (respeita proxy reverso), enviado ao n8n.
    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
      .split(",")[0]
      .trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] ?? "")
      .split(",")[0]
      .trim();
    const host = forwardedHost || req.get("host") || "";
    const proto = forwardedProto || req.protocol;
    const dominio = host ? `${proto}://${host}` : "";

    const payload = {
      ...toWebhookPayload(parsed.data),
      dominio,
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.webhookTimeoutMs,
    );

    try {
      const response = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(
          `Webhook respondeu ${response.status}: ${detail.slice(0, 500)}`,
        );
        return res.status(502).json({
          message:
            "A cotação não pôde ser enviada aos fornecedores. Tente novamente em instantes.",
        });
      }

      return res.status(200).json({
        message: "Cotação enviada aos fornecedores com sucesso!",
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      console.error("Falha ao chamar o webhook:", error);
      return res.status(aborted ? 504 : 502).json({
        message: aborted
          ? "O envio demorou mais que o esperado. Tente novamente."
          : "Não foi possível contatar o serviço de fornecedores no momento.",
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  /**
   * Lista as cotações (quote) com os materiais solicitados (quote_products)
   * e a quantidade de respostas de fornecedores (quote_conversations).
   * É a visão "mestre" da aba Cotações. Os materiais e a contagem são obtidos
   * por subconsultas para evitar fan-out do JOIN.
   */
  app.get("/api/cotacoes", async (_req: Request, res: Response) => {
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
   * Lista as conversas de cotação (quote_conversations) de UMA cotação,
   * refletindo em paralelo os dados necessários do fornecedor (suppliers).
   * Aceita ?quote_id=N para filtrar; sem o filtro, retorna todas.
   */
  app.get("/api/cotacoes/conversas", async (req: Request, res: Response) => {
    try {
      const pool = getPool();
      const quoteIdRaw = req.query.quote_id;
      const quoteId =
        typeof quoteIdRaw === "string" ? Number(quoteIdRaw) : NaN;
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

  /**
   * Atualiza o responsável (Agente | Humano) de uma conversa de cotação.
   */
  app.patch(
    "/api/cotacoes/conversas/:id",
    async (req: Request, res: Response) => {
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
    },
  );

  /**
   * Lista as mensagens (quote_conversation_messages) de uma conversa, em ordem
   * cronológica. Usado pelo chat (estilo WhatsApp/Telegram) do frontend.
   */
  app.get(
    "/api/cotacoes/conversas/:id/mensagens",
    async (req: Request, res: Response) => {
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
    },
  );

  /**
   * Detalhe de UMA cotação (quote) com seus materiais. Registrado depois das
   * rotas "/conversas..." para que o parâmetro :id não capture "conversas".
   */
  app.get("/api/cotacoes/:id", async (req: Request, res: Response) => {
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

  // ---- Frontend ----
  // O frontend é servido pelo MESMO servidor/porta do backend.
  if (config.isDev) {
    // DEV: Vite embutido (middleware mode) => hot-reload em tempo real,
    // sem build e sem porta separada. O vite vem do node_modules compartilhado.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: config.projectRoot,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Modo desenvolvimento: hot-reload ativo (Vite embutido).");
  } else if (fs.existsSync(path.join(config.clientDist, "index.html"))) {
    // PRODUÇÃO: serve o build estático + fallback de SPA.
    app.use(express.static(config.clientDist));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(config.clientDist, "index.html"));
    });
    console.log(`Frontend (build) servido de ${config.clientDist}`);
  } else {
    console.warn(
      "Frontend não compilado. Rode 'npm run build' ou use 'npm run dev'.",
    );
  }

  app.listen(config.port, () => {
    console.log(`\n➜  App em http://localhost:${config.port}`);
    console.log(`   Webhook de destino: ${config.webhookUrl}\n`);
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});
