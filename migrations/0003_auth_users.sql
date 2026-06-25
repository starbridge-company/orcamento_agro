-- migrate:up
-- ============================================================
-- Autenticação: usuários (com roles já preparadas) e sessões
-- (refresh tokens ROTATIVOS, com detecção de reuso). Tudo no
-- schema `agro`, seguindo o padrão das demais tabelas:
-- BIGINT identity, timestamptz, soft delete (deleted_at).
-- ============================================================
CREATE SCHEMA IF NOT EXISTS agro;

-- gen_random_uuid() é nativo no Postgres 13+; a extensão cobre versões antigas.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- Usuários -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agro.users (
    id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                  TEXT        NOT NULL,
    email                 TEXT        NOT NULL,                 -- sempre gravado em minúsculas
    password_hash         TEXT        NOT NULL,                 -- argon2id (string PHC completa)
    -- Roles já preparadas para o controle de acesso futuro. Mais papéis podem
    -- ser adicionados depois alterando este CHECK numa nova migration.
    role                  TEXT        NOT NULL DEFAULT 'user'
                              CHECK (role IN ('admin', 'manager', 'user', 'viewer')),
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,    -- desativar sem apagar
    email_verified        BOOLEAN     NOT NULL DEFAULT FALSE,   -- preparado p/ verificação por e-mail
    failed_login_attempts INTEGER     NOT NULL DEFAULT 0,       -- contador p/ bloqueio anti brute force
    locked_until          TIMESTAMPTZ,                          -- bloqueio temporário após N tentativas
    last_login_at         TIMESTAMPTZ,
    password_changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at            TIMESTAMPTZ                            -- soft delete: NULL = ativo
);

-- E-mail único entre usuários ativos. Gravamos sempre minúsculo; o índice em
-- lower(email) garante a unicidade case-insensitive de forma definitiva.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
    ON agro.users (lower(email))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_active
    ON agro.users (id)
    WHERE deleted_at IS NULL;

-- ---- Sessões (refresh tokens rotativos) -----------------------------------
-- Guardamos apenas o HASH (SHA-256) do refresh token, NUNCA o valor cru: se o
-- banco vazar, os tokens continuam inúteis. A cada refresh rotacionamos o
-- token (nova linha na mesma `family_id`). Reapresentar um token já rotacionado
-- (revoked_at preenchido) indica roubo => revogamos a família inteira.
CREATE TABLE IF NOT EXISTS agro.user_sessions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT      NOT NULL REFERENCES agro.users (id) ON DELETE CASCADE,
    token_hash     TEXT        NOT NULL,                        -- sha256(refresh token) em hex
    family_id      UUID        NOT NULL DEFAULT gen_random_uuid(),
    remember_me    BOOLEAN     NOT NULL DEFAULT FALSE,          -- "lembrar de mim" => TTL longo
    user_agent     TEXT,                                        -- auditoria / dispositivos
    ip_address     TEXT,                                        -- auditoria
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,                                 -- NULL = sessão ativa
    last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token_hash
    ON agro.user_sessions (token_hash);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
    ON agro.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_family
    ON agro.user_sessions (family_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active
    ON agro.user_sessions (user_id)
    WHERE revoked_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS agro.user_sessions;
DROP TABLE IF EXISTS agro.users;
