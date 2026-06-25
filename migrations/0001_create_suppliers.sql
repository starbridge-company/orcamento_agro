-- migrate:up
CREATE TABLE IF NOT EXISTS suppliers (
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
    ON suppliers (id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_execution_id
    ON suppliers (execution_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_phone
    ON suppliers (phone)
    WHERE deleted_at IS NULL AND phone IS NOT NULL;

-- migrate:down
DROP TABLE IF EXISTS suppliers;
