-- migrate:up
-- Adiciona o responsável (Agente | Humano) às conversas de cotação.
-- A coluna também consta no 0001 (para instalações novas); este ALTER é
-- idempotente (ADD COLUMN IF NOT EXISTS) e cobre os bancos em que o 0001 já
-- havia sido aplicado antes deste campo existir.
ALTER TABLE agro.quote_conversations
    ADD COLUMN IF NOT EXISTS responsible TEXT NOT NULL DEFAULT 'Agente'
    CHECK (responsible IN ('Agente', 'Humano'));

-- migrate:down
ALTER TABLE agro.quote_conversations
    DROP COLUMN IF EXISTS responsible;
