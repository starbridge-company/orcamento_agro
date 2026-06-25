import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url)); // src/server
const projectRoot = path.resolve(currentDir, "../.."); // raiz do projeto

// .env ÚNICO na raiz do projeto. Se não existir, segue com as variáveis do
// ambiente (em produção/Docker elas vêm do runtime).
dotenv.config({ path: path.join(projectRoot, ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Dev = Vite embutido com hot-reload. Caso contrário, serve o build estático.
  isDev: process.env.NODE_ENV === "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:4000",
  webhookUrl: required(
    "WEBHOOK_URL",
    "https://n8n-gw8k8gks84k0cwcgwo4ws884.app5.w8hub.com.br/webhook/fbe013a0-9e52-43e3-9671-5d52f63f60da",
  ),
  webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 15000),
  // Conexão Postgres usada pelas migrations.
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Raiz do projeto (onde ficam index.html e vite.config.ts) e a pasta do
  // build do frontend (dist), servida em produção pelo próprio backend.
  projectRoot,
  clientDist: process.env.CLIENT_DIST ?? path.join(projectRoot, "dist"),
} as const;
