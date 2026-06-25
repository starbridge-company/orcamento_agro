/**
 * Acesso a agro.users. Os ids BIGINT voltam do `pg` como STRING — mantemos
 * tudo como string para evitar perda de precisão e comparações erradas.
 */
import { getPool } from "../db/pool";
import { config } from "../config";
import type { AppRole } from "./tokens";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: AppRole;
  is_active: boolean;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

/** Visão "pública" do usuário (sem hash de senha) devolvida à API/cliente. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  emailVerified: boolean;
}

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    emailVerified: u.email_verified,
  };
}

const COLUMNS = `
  id, name, email, password_hash, role, is_active, email_verified,
  failed_login_attempts, locked_until, last_login_at, created_at
`;

/** Normaliza e-mail para casar com o índice único em lower(email). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT ${COLUMNS} FROM agro.users
      WHERE lower(email) = lower($1) AND deleted_at IS NULL
      LIMIT 1`,
    [normalizeEmail(email)],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT ${COLUMNS} FROM agro.users
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export class EmailTakenError extends Error {
  constructor() {
    super("E-mail já cadastrado.");
    this.name = "EmailTakenError";
  }
}

export async function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  role: AppRole;
}): Promise<UserRow> {
  try {
    const { rows } = await getPool().query<UserRow>(
      `INSERT INTO agro.users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [input.name.trim(), normalizeEmail(input.email), input.passwordHash, input.role],
    );
    return rows[0];
  } catch (err) {
    // 23505 = unique_violation (índice de e-mail).
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      throw new EmailTakenError();
    }
    throw err;
  }
}

/** True se a conta está temporariamente bloqueada por brute force. */
export function isLocked(user: UserRow): boolean {
  return user.locked_until !== null && new Date(user.locked_until) > new Date();
}

/** Login OK: zera o contador de falhas e registra o acesso. */
export async function recordSuccessfulLogin(id: string): Promise<void> {
  await getPool().query(
    `UPDATE agro.users
        SET failed_login_attempts = 0,
            locked_until = NULL,
            last_login_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

/** Login falho: incrementa o contador e bloqueia ao atingir o limite. */
export async function recordFailedLogin(id: string): Promise<void> {
  await getPool().query(
    `UPDATE agro.users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2
              THEN now() + make_interval(mins => $3)
              ELSE locked_until
            END,
            updated_at = now()
      WHERE id = $1`,
    [id, config.auth.maxLoginAttempts, config.auth.lockoutMinutes],
  );
}

/** Atualiza o hash da senha (usado para re-hashear no login quando os custos sobem). */
export async function updatePasswordHash(id: string, passwordHash: string): Promise<void> {
  await getPool().query(
    `UPDATE agro.users
        SET password_hash = $2,
            password_changed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [id, passwordHash],
  );
}
