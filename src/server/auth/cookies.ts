/**
 * Cookies de sessão — httpOnly (invisíveis ao JS, então XSS não rouba o token),
 * SameSite=Strict (corta CSRF: o navegador não envia o cookie em requisições
 * cross-site) e Secure em produção.
 *
 *  - Access token: path "/" (enviado a toda a API).
 *  - Refresh token: path "/api/auth" (só vai para os endpoints de auth — a
 *    credencial de longa duração tem exposição mínima).
 *
 * Prefixos de cookie sob HTTPS:
 *  - __Host-  exige Secure + path "/" + sem Domain (o mais rígido).
 *  - __Secure- exige Secure (permite path scopeado).
 */
import type { Request, Response } from "express";
import { config } from "../config";

const secure = config.auth.cookieSecure;

export const ACCESS_COOKIE = secure ? "__Host-at" : "at";
export const REFRESH_COOKIE = secure ? "__Secure-rt" : "rt";
const REFRESH_PATH = "/api/auth";

const base = {
  httpOnly: true,
  secure,
  sameSite: "strict" as const,
};

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE, token, {
    ...base,
    path: "/",
    maxAge: config.auth.accessTtlSec * 1000,
  });
}

export function setRefreshCookie(
  res: Response,
  token: string,
  maxAgeSec: number,
): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...base,
    path: REFRESH_PATH,
    maxAge: maxAgeSec * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}

export function readAccessToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === "string" && fromCookie) return fromCookie;
  // Fallback Authorization: Bearer — útil para testes/integrações server-side.
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return null;
}

export function readRefreshToken(req: Request): string | null {
  const v = req.cookies?.[REFRESH_COOKIE];
  return typeof v === "string" && v ? v : null;
}
