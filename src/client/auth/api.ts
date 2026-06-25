/**
 * Cliente de autenticação (framework-agnóstico).
 *
 * - Tokens vivem em cookies httpOnly: o JS nunca os toca. Por isso usamos
 *   `credentials: "include"` em vez de ler/escrever tokens manualmente.
 * - `apiFetch` renova a sessão de forma transparente: se uma chamada responder
 *   401, tenta UMA rotação de refresh token e refaz a requisição. Refreshes
 *   concorrentes são deduplicados num único pedido.
 */
export type AppRole = "admin" | "manager" | "user" | "viewer";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

// ---- Notificação de sessão expirada (AuthContext ouve para deslogar) ----
type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

export function onSessionExpired(fn: Listener): () => void {
  sessionExpiredListeners.add(fn);
  return () => sessionExpiredListeners.delete(fn);
}

function emitSessionExpired(): void {
  for (const fn of sessionExpiredListeners) fn();
}

// ---- Rotação de refresh deduplicada ----
let pendingRefresh: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  if (!pendingRefresh) {
    pendingRefresh = fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        pendingRefresh = null;
      });
  }
  return pendingRefresh;
}

/**
 * fetch autenticado com refresh transparente. Use para toda chamada à API que
 * exige sessão. Em 401 (fora das rotas /api/auth), tenta renovar e refaz uma vez.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });

  if (res.status !== 401 || path.startsWith("/api/auth/")) return res;

  const refreshed = await refreshOnce();
  if (!refreshed) {
    emitSessionExpired();
    return res;
  }
  return fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
}

// ---- Endpoints de auth ----
export async function loginRequest(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    user?: AuthUser;
    message?: string;
  };
  if (!res.ok || !data.user) {
    throw new Error(data.message ?? "Não foi possível entrar. Tente novamente.");
  }
  return data.user;
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}

/**
 * Restaura a sessão no carregamento da página. Se o access token expirou mas o
 * refresh ainda é válido, uma rotação reativa a sessão silenciosamente.
 */
export async function fetchMe(): Promise<AuthUser | null> {
  let res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) {
    const ok = await refreshOnce();
    if (!ok) return null;
    res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser };
  return data.user ?? null;
}
