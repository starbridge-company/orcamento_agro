/**
 * Tokens da sessão.
 *
 *  - ACCESS TOKEN: JWT curto (HS256, via `jose`). Carrega o id e a role do
 *    usuário. Sem estado no servidor — validado só pela assinatura + exp.
 *  - REFRESH TOKEN: string opaca de 256 bits de entropia. NÃO é um JWT; é uma
 *    credencial aleatória cujo SHA-256 fica guardado em agro.user_sessions.
 *    O valor cru só existe no cookie do cliente.
 */
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config";

const secret = () => new TextEncoder().encode(config.auth.jwtSecret);

export type AppRole = "admin" | "manager" | "user" | "viewer";

export interface AccessClaims {
  /** id do usuário (BIGINT serializado como string). */
  sub: string;
  role: AppRole;
  /** id da sessão (agro.user_sessions.id) que originou este access token. */
  sid: string;
}

/** Assina um access token JWT (HS256) com validade curta. */
export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(config.auth.jwtIssuer)
    .setAudience(config.auth.jwtAudience)
    .setIssuedAt()
    .setExpirationTime(`${config.auth.accessTtlSec}s`)
    .sign(secret());
}

/** Verifica assinatura + iss/aud + exp. Lança se inválido/expirado. */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: config.auth.jwtIssuer,
    audience: config.auth.jwtAudience,
    algorithms: ["HS256"],
  });
  return claimsFromPayload(payload);
}

function claimsFromPayload(p: JWTPayload): AccessClaims {
  const role = p.role;
  const sid = p.sid;
  if (typeof p.sub !== "string" || typeof role !== "string" || typeof sid !== "string") {
    throw new Error("Claims do token inválidas.");
  }
  return { sub: p.sub, role: role as AppRole, sid };
}

/** Gera um refresh token opaco (256 bits) — entregue ao cliente em cookie. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 (hex) do refresh token — é isto que vai para o banco. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
