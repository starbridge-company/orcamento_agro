import fs from "node:fs";
import path from "node:path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config, assertAuthConfig } from "./config";
import { buildAuthRouter } from "./auth/routes";
import { requireAuth } from "./auth/middleware";
import { buildCotacoesRouter } from "./cotacoes/routes";

async function bootstrap() {
  // Fail-closed: sem um JWT_SECRET forte, o servidor não sobe.
  assertAuthConfig();

  const app = express();

  // Atrás de um proxy reverso (Docker/n8n): confia no 1º hop para obter o IP
  // real do cliente (usado pelo rate limit).
  app.set("trust proxy", 1);

  // Cabeçalhos de segurança. CSP/COEP desligados para não quebrar o Vite
  // (dev) nem o carregamento de imagens; o resto (HSTS, noSniff, frameguard,
  // referrer-policy, etc.) fica ativo.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Autenticação (público: login/refresh/logout/register). Tudo abaixo de
  // /api/cotacoes exige sessão válida.
  app.use("/api/auth", buildAuthRouter());
  app.use("/api/cotacoes", requireAuth, buildCotacoesRouter());

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
    console.log(`\n➜  App em http://localhost:${config.port}\n`);
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar o servidor:", error);
  process.exit(1);
});
