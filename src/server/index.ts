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

    const payload = toWebhookPayload(parsed.data);

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
