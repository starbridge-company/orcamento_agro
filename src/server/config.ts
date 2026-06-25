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

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

const isDev = process.env.NODE_ENV === "development";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Dev = Vite embutido com hot-reload. Caso contrário, serve o build estático.
  isDev,
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

  // ---- Autenticação (login seguro: JWT + argon2 + refresh rotativo) ----
  auth: {
    // Segredo HMAC que assina os access tokens (JWT/HS256). Lido aqui sem
    // lançar (migrations não precisam dele); a validação de força acontece em
    // assertAuthConfig(), chamada no bootstrap do servidor (fail-closed).
    jwtSecret: process.env.JWT_SECRET ?? "",
    jwtIssuer: process.env.JWT_ISSUER ?? "orcamento-agro",
    jwtAudience: process.env.JWT_AUDIENCE ?? "orcamento-agro-web",

    // TTL do access token (curto). Refresh token é a sessão de longa duração.
    accessTtlSec: num("AUTH_ACCESS_TTL_SEC", 15 * 60), // 15 min
    // Sessão sem "lembrar de mim" (expira relativamente rápido).
    refreshTtlSec: num("AUTH_REFRESH_TTL_SEC", 12 * 60 * 60), // 12 h
    // Sessão com "lembrar de mim" marcado (persiste por mais tempo).
    refreshRememberTtlSec: num(
      "AUTH_REFRESH_REMEMBER_TTL_SEC",
      30 * 24 * 60 * 60, // 30 dias
    ),

    // Cookies Secure + prefixo __Host- só funcionam sob HTTPS. Em dev (http)
    // ficam desligados; em produção, ligados por padrão.
    cookieSecure: bool("AUTH_COOKIE_SECURE", !isDev),

    // Bloqueio de conta após brute force (defesa em profundidade junto ao
    // rate limit por IP).
    maxLoginAttempts: num("AUTH_MAX_LOGIN_ATTEMPTS", 5),
    lockoutMinutes: num("AUTH_LOCKOUT_MINUTES", 15),

    // Self-registration desligado por padrão (ferramenta interna). Usuários são
    // criados pela CLI `npm run create-user`. Ligue com AUTH_ALLOW_REGISTRATION.
    allowRegistration: bool("AUTH_ALLOW_REGISTRATION", false),

    // Parâmetros do argon2id (OWASP: m=19 MiB, t=2, p=1 como mínimo sólido).
    argon: {
      memoryCost: num("ARGON_MEMORY_KIB", 19456), // 19 MiB
      timeCost: num("ARGON_TIME_COST", 2),
      parallelism: num("ARGON_PARALLELISM", 1),
    },
  },
} as const;

/**
 * Garante que a configuração de auth é forte o suficiente para subir o
 * servidor. Chamada no bootstrap: se o segredo faltar/for fraco, o processo
 * NÃO sobe (fail-closed) em vez de assinar tokens com um segredo inseguro.
 */
export function assertAuthConfig(): void {
  const secret = config.auth.jwtSecret;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET ausente ou fraco. Defina JWT_SECRET com >= 32 caracteres " +
        "aleatórios no .env (ex.: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\").",
    );
  }
  if (!config.isDev && !config.auth.cookieSecure) {
    console.warn(
      "[auth] AUTH_COOKIE_SECURE=false em produção: cookies de sessão sem " +
        "flag Secure. Use HTTPS e mantenha cookies Secure.",
    );
  }
}
