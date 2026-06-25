-- migrate:up
-- Réplica exata do estado atual do banco (schema `agro`).
CREATE SCHEMA IF NOT EXISTS agro;

CREATE TABLE IF NOT EXISTS agro.suppliers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT        NOT NULL,
    city          TEXT,
    state         TEXT,
    phone         TEXT,                          -- whatsapp_numero
    address       TEXT,                          -- endereço
    execution_id  TEXT,                          -- $execution.id (n8n)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ                     -- soft delete: NULL = ativo
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active
    ON agro.suppliers (id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_execution_id
    ON agro.suppliers (execution_id);

CREATE TABLE IF NOT EXISTS agro.quote (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    buyer_name   TEXT        NOT NULL,
    email        TEXT        NOT NULL,
    city         TEXT        NOT NULL,
    state        TEXT        NOT NULL,
    supply_group TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agro.quote_products (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_id   BIGINT      NOT NULL REFERENCES agro.quote (id),
    material   TEXT        NOT NULL,
    quantity   NUMERIC,
    unit       TEXT,
    brand      TEXT,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_products_quote_id
    ON agro.quote_products (quote_id);

CREATE TABLE IF NOT EXISTS agro.quote_executions (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_id      BIGINT      REFERENCES agro.quote (id),  -- comprador/cotação de origem
    execution_id  TEXT        NOT NULL,                              -- $execution.id (n8n)
    execution_url TEXT,                                              -- URL da execução no n8n
    executed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),                -- substitui Data + Hora separadas
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_executions_active
    ON agro.quote_executions (id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_executions_execution_id
    ON agro.quote_executions (execution_id);

CREATE INDEX IF NOT EXISTS idx_quote_executions_quote_id
    ON agro.quote_executions (quote_id);

-- migrate:down
DROP TABLE IF EXISTS agro.quote_products;
DROP TABLE IF EXISTS agro.quote_executions;
DROP TABLE IF EXISTS agro.quote;
DROP TABLE IF EXISTS agro.suppliers;
