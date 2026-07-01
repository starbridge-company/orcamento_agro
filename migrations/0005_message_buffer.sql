-- migrate:up
-- ============================================================
-- Buffer de mensagens (debounce) do agente conversacional INBOUND.
-- Quando um fornecedor responde no WhatsApp, cada "bolha" é gravada aqui e
-- agregada após uma janela de silêncio (~30s) antes de acionar o agente.
-- Assim, várias mensagens em rajada viram um único input.
-- ============================================================
CREATE TABLE IF NOT EXISTS agro.message_buffer (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT      NOT NULL REFERENCES agro.quote_conversations (id),
    wa_message_id   TEXT,                                   -- id da mensagem na Evolution (idempotência)
    content         TEXT,                                   -- texto/transcrição/descrição
    media_type      TEXT        NOT NULL DEFAULT 'text',    -- text | audio | image | pdf | unsupported
    sender_name     TEXT,
    phone           TEXT,                                   -- telefone normalizado do fornecedor
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,                   -- created_at + janela de debounce
    processing_at   TIMESTAMPTZ                             -- lock: NULL = aguardando processamento
);

CREATE INDEX IF NOT EXISTS idx_message_buffer_conversation
    ON agro.message_buffer (conversation_id);

-- Pendentes (ainda não travados), para o sweeper varrer por expiração.
CREATE INDEX IF NOT EXISTS idx_message_buffer_pending
    ON agro.message_buffer (expires_at)
    WHERE processing_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS agro.message_buffer;
