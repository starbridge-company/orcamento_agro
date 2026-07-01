import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url)); // src/server
const projectRoot = path.resolve(currentDir, "../.."); // raiz do projeto

// .env ÚNICO na raiz do projeto. Se não existir, segue com as variáveis do
// ambiente (em produção/Docker elas vêm do runtime).
dotenv.config({ path: path.join(projectRoot, ".env") });

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

function str(name: string, fallback = ""): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

const isDev = process.env.NODE_ENV === "development";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  // Dev = Vite embutido com hot-reload. Caso contrário, serve o build estático.
  isDev,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:4000",
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

  // ---- Pipeline de cotação (migração do fluxo n8n para código) ----
  // Todas as chaves ficam aqui, lidas do .env (NUNCA hardcoded como no n8n).
  // Leitura "lazy" (sem throw no boot): a ausência de uma chave só quebra
  // quando o provider correspondente é usado dentro do job, que então marca a
  // cotação como 'failed' com mensagem clara — sem derrubar o servidor.
  cotacao: {
    // OpenAI: classificação de grupo de insumos + cidades vizinhas.
    openaiApiKey: str("OPENAI_API_KEY"),
    openaiModel: str("OPENAI_MODEL", "gpt-5.5"),

    // Google Maps: Places (Text Search + Details) e Geocoding.
    googleMapsApiKey: str("GOOGLE_MAPS_API_KEY"),

    // Perplexity (sonar-pro): fonte alternativa de fornecedores.
    perplexityApiKey: str("PERPLEXITY_API_KEY"),
    perplexityModel: str("PERPLEXITY_MODEL", "sonar-pro"),

    // Evolution API (WhatsApp). A MESMA instância serve à verificação de
    // número (POST /chat/whatsappNumbers/{instance}) e ao envio de mensagem
    // (POST /message/sendText/{instance}).
    evolution: {
      apiUrl: str("EVOLUTION_API_URL"),
      apiKey: str("EVOLUTION_API_KEY"),
      instance: str("EVOLUTION_INSTANCE", "Starbridge"),
    },

    // SMTP (nodemailer) para os e-mails ao comprador (sucesso / sem fornecedores).
    smtp: {
      host: str("SMTP_HOST"),
      port: num("SMTP_PORT", 587),
      secure: bool("SMTP_SECURE", false), // true => porta 465 (TLS implícito)
      user: str("SMTP_USER"),
      pass: str("SMTP_PASS"),
      from: str("SMTP_FROM"),
      fromName: str("SMTP_FROM_NAME", "Agente Comprador"),
    },

    // Parâmetros do pipeline, tunáveis sem tocar no código.
    suppliersTarget: num("SUPPLIERS_TARGET", 8), // alvo de fornecedores
    searchMaxRadiusKm: num("SEARCH_MAX_RADIUS_KM", 100), // raio máx. p/ vizinhas
    dispatchDelayMs: num("DISPATCH_DELAY_MS", 1500), // espaço entre envios WhatsApp
    httpTimeoutMs: num("PIPELINE_HTTP_TIMEOUT_MS", 30000), // timeout por chamada externa

    // MODO DE TESTE CONTROLADO: se preenchido, TODO envio de WhatsApp vai para
    // este número (em vez do fornecedor real). Os fornecedores reais continuam
    // gravados no banco. DEIXE VAZIO EM PRODUÇÃO.
    dispatchTestRecipient: str("DISPATCH_TEST_RECIPIENT"),

    // ---- Agente conversacional INBOUND (respostas dos fornecedores) ----
    // Segredo que valida o webhook da Evolution (query ?secret= ou header
    // x-webhook-secret). Sem ele configurado, o webhook aceita qualquer origem
    // (ok em dev; defina em produção).
    evolutionWebhookSecret: str("EVOLUTION_WEBHOOK_SECRET"),
    // Janela de agregação (debounce) das mensagens em rajada.
    bufferWindowSeconds: num("BUFFER_WINDOW_SECONDS", 30),
    // Modelos de mídia (transcrição de áudio / visão de imagem).
    transcriptionModel: str("OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
    visionModel: str("OPENAI_VISION_MODEL", "gpt-4o"),
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
