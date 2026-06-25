/**
 * Sessões = refresh tokens ROTATIVOS com detecção de reuso.
 *
 * Fluxo:
 *  1. Login cria uma sessão (linha em agro.user_sessions) com o hash do token.
 *  2. Cada /refresh ROTACIONA: revoga o token atual e emite um novo na mesma
 *     `family_id`. Janela deslizante: o novo token expira daqui a TTL.
 *  3. Se um token JÁ ROTACIONADO (revogado) for reapresentado, é sinal de roubo
 *     => revogamos a FAMÍLIA inteira. O atacante e a vítima caem juntos e a
 *     vítima é forçada a logar de novo (defesa contra replay de refresh tokens).
 *
 * Guardamos só o SHA-256 do token; o valor cru vive apenas no cookie do cliente.
 */
import { getPool } from "../db/pool";
import { config } from "../config";
import {
  generateRefreshToken,
  hashRefreshToken,
  type AppRole,
} from "./tokens";

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

/** Cria uma sessão nova (no login). Retorna o id da sessão. */
export async function createSession(input: {
  userId: string;
  token: string;
  rememberMe: boolean;
  ttlSec: number;
  meta: SessionMeta;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO agro.user_sessions
        (user_id, token_hash, remember_me, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
     RETURNING id`,
    [
      input.userId,
      hashRefreshToken(input.token),
      input.rememberMe,
      input.meta.userAgent,
      input.meta.ip,
      input.ttlSec,
    ],
  );
  return rows[0].id;
}

export type RotationResult =
  | {
      ok: true;
      userId: string;
      role: AppRole;
      sessionId: string;
      newToken: string;
      rememberMe: boolean;
      ttlSec: number;
    }
  | { ok: false; reason: "invalid" | "expired" | "reuse" };

/**
 * Valida o refresh token apresentado e, se válido, rotaciona-o. Tudo numa
 * transação com FOR UPDATE para evitar corrida (duas requisições rotacionando
 * o mesmo token ao mesmo tempo).
 */
export async function rotateRefreshToken(
  presentedToken: string,
  meta: SessionMeta,
): Promise<RotationResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: string;
      user_id: string;
      family_id: string;
      remember_me: boolean;
      revoked_at: string | null;
      expires_at: string;
      role: AppRole;
      is_active: boolean;
      deleted_at: string | null;
    }>(
      `SELECT s.id, s.user_id, s.family_id, s.remember_me, s.revoked_at,
              s.expires_at, u.role, u.is_active, u.deleted_at
         FROM agro.user_sessions s
         JOIN agro.users u ON u.id = s.user_id
        WHERE s.token_hash = $1
        FOR UPDATE OF s`,
      [tokenHash],
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }

    const s = rows[0];

    // Token já rotacionado/revogado reapresentado => provável roubo.
    if (s.revoked_at !== null) {
      await client.query(
        `UPDATE agro.user_sessions
            SET revoked_at = now()
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [s.family_id],
      );
      await client.query("COMMIT");
      return { ok: false, reason: "reuse" };
    }

    // Expirado ou usuário desativado/removido.
    if (
      new Date(s.expires_at) <= new Date() ||
      !s.is_active ||
      s.deleted_at !== null
    ) {
      await client.query(
        `UPDATE agro.user_sessions SET revoked_at = now() WHERE id = $1`,
        [s.id],
      );
      await client.query("COMMIT");
      return { ok: false, reason: "expired" };
    }

    // Rotação: emite novo token na mesma família e revoga o atual.
    const newToken = generateRefreshToken();
    const ttlSec = s.remember_me
      ? config.auth.refreshRememberTtlSec
      : config.auth.refreshTtlSec;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO agro.user_sessions
          (user_id, token_hash, family_id, remember_me, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       RETURNING id`,
      [
        s.user_id,
        hashRefreshToken(newToken),
        s.family_id,
        s.remember_me,
        meta.userAgent,
        meta.ip,
        ttlSec,
      ],
    );

    await client.query(
      `UPDATE agro.user_sessions
          SET revoked_at = now(), last_used_at = now()
        WHERE id = $1`,
      [s.id],
    );

    await client.query("COMMIT");
    return {
      ok: true,
      userId: s.user_id,
      role: s.role,
      sessionId: inserted.rows[0].id,
      newToken,
      rememberMe: s.remember_me,
      ttlSec,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Logout: revoga a sessão correspondente ao refresh token apresentado. */
export async function revokeSessionByToken(token: string): Promise<void> {
  await getPool().query(
    `UPDATE agro.user_sessions
        SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashRefreshToken(token)],
  );
}

/** Revoga TODAS as sessões ativas de um usuário (logout em todos os dispositivos). */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE agro.user_sessions
        SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

/** Housekeeping opcional: remove sessões expiradas/revogadas há mais de 7 dias. */
export async function deleteStaleSessions(): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM agro.user_sessions
      WHERE expires_at < now() - interval '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`,
  );
  return rowCount ?? 0;
}
