/**
 * Webhook INBOUND da Evolution (respostas dos fornecedores no WhatsApp).
 *
 * Rota PÚBLICA (montada fora do requireAuth), validada por um segredo
 * compartilhado. Responde 200 rapidamente e processa o evento em background,
 * para não segurar a Evolution.
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config";
import { handleEvolutionEvent } from "./handler";

/** Confere o segredo do webhook (query ?secret= ou header x-webhook-secret). */
function isAuthorized(req: Request): boolean {
  const secret = config.cotacao.evolutionWebhookSecret;
  if (!secret) return true; // não configurado => aceita (dev)
  const provided =
    (typeof req.query.secret === "string" ? req.query.secret : undefined) ??
    (typeof req.headers["x-webhook-secret"] === "string"
      ? req.headers["x-webhook-secret"]
      : undefined);
  return provided === secret;
}

export function buildWebhooksRouter(): Router {
  const router = Router();

  router.post("/evolution", (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ message: "unauthorized" });
    }

    // Responde já; o processamento roda em background (fire-and-forget).
    res.status(200).json({ ok: true });

    const body = req.body;
    Promise.resolve()
      .then(() => handleEvolutionEvent(body))
      .catch((error) =>
        console.error("[webhook evolution] falha ao processar:", error),
      );
  });

  return router;
}
