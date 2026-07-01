/**
 * Cliente HTTP JSON compartilhado pelos providers do pipeline.
 * Aplica timeout por chamada (AbortController), normaliza erros (status +
 * trecho do corpo) e oferece retry OPCIONAL para erros transitórios.
 *
 * ATENÇÃO: retry só deve ser ligado em chamadas idempotentes (buscas, LLM,
 * checagem de número). NUNCA em envios com efeito colateral (ex.: Evolution
 * sendText, e-mail), para não duplicar mensagens.
 */
import { config } from "../../config";

export interface HttpJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  timeoutMs?: number;
  /** Tentativas EXTRAS em erro transitório (5xx/429/rede/timeout). Default 0. */
  retries?: number;
  /** Backoff base entre tentativas (ms). Default 500. */
  retryDelayMs?: number;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx e 429 (servidor) ou erros de rede/timeout são transitórios. */
function isTransient(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429;
  }
  return true; // rede / timeout
}

function buildUrl(url: string, query?: HttpJsonOptions["query"]): string {
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}${url.includes("?") ? "&" : "?"}${s}` : url;
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpJsonOptions = {},
): Promise<T> {
  const { method = "GET", headers = {}, body } = opts;
  const timeoutMs = opts.timeoutMs ?? config.cotacao.httpTimeoutMs;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const finalUrl = buildUrl(url, opts.query);
  const shortUrl = finalUrl.split("?")[0];

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(finalUrl, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new HttpError(res.status, `HTTP ${res.status} em ${shortUrl}: ${text.slice(0, 500)}`);
      }

      try {
        return (text ? JSON.parse(text) : undefined) as T;
      } catch {
        // Corpo não-JSON num 2xx: devolve indefinido em vez de estourar retry.
        return undefined as T;
      }
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? new Error(`Timeout (${timeoutMs}ms) em ${shortUrl}`)
          : error;

      if (attempt < retries && isTransient(lastError)) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
