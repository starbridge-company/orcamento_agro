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

CREATE TABLE IF NOT EXISTS agro.quote_conversations (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_id          BIGINT      NOT NULL REFERENCES agro.quote (id),
    supplier_id       BIGINT      NOT NULL REFERENCES agro.suppliers (id),
    responsible       TEXT        NOT NULL DEFAULT 'Agente'
                          CHECK (responsible IN ('Agente', 'Humano')), -- Responsável: Agente ou Humano
    dispatch_number   INTEGER     NOT NULL,                           -- numero_disparo
    initial_message   TEXT,                                           -- mensagem de abertura disparada
    status            TEXT        NOT NULL DEFAULT 'aguardando retorno fornecedor',
    delivery_time     TEXT,                                           -- Prazo
    payment_method    TEXT,                                           -- Forma de Pagamento
    shipping          TEXT,                                           -- Frete
    taxes             TEXT,                                           -- Impostos
    volume            TEXT,                                           -- Volume
    proposal_validity TEXT,                                           -- Validade da Proposta
    metadata          JSONB,                                          -- observações, especificações etc.
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_conversations_active
    ON agro.quote_conversations (id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_conversations_quote_id
    ON agro.quote_conversations (quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_conversations_supplier_id
    ON agro.quote_conversations (supplier_id);

CREATE TABLE IF NOT EXISTS agro.quote_conversation_messages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT      NOT NULL REFERENCES agro.quote_conversations (id),
    author          TEXT        NOT NULL,                    -- 'supplier', 'system', 'buyer'
    content         TEXT,                                    -- texto da mensagem
    message_type    TEXT        NOT NULL DEFAULT 'text',     -- text, image, audio, document...
    wa_message_id   TEXT,                                    -- id da mensagem na Evolution (key.id)
    media_url       TEXT,                                    -- link/ref de mídia, se houver
    sent_at         TIMESTAMPTZ,                             -- timestamp real da mensagem (WhatsApp)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_conv_messages_active
    ON agro.quote_conversation_messages (id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_conv_messages_conversation_id
    ON agro.quote_conversation_messages (conversation_id);

-- migrate:down
DROP TABLE IF EXISTS agro.quote_conversation_messages;
DROP TABLE IF EXISTS agro.quote_conversations;
DROP TABLE IF EXISTS agro.quote_products;
DROP TABLE IF EXISTS agro.quote_executions;
DROP TABLE IF EXISTS agro.quote;
DROP TABLE IF EXISTS agro.suppliers;
