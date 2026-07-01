-- migrate:up
-- ============================================================
-- Status da cotação para o pipeline ASSÍNCRONO (migração do
-- fluxo n8n para código). O POST cria a cotação e retorna na
-- hora; um job em background roda a descoberta de fornecedores,
-- o disparo no WhatsApp e o e-mail final, atualizando este status:
--   processing    -> job em andamento
--   completed     -> fornecedores encontrados e cotação disparada
--   no_suppliers  -> nenhum fornecedor no raio máximo (e-mail avisando)
--   failed        -> erro no pipeline (ver logs)
-- ============================================================
ALTER TABLE agro.quote
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'completed', 'no_suppliers', 'failed'));

-- Backfill: cotações que já existiam (criadas pelo n8n) são histórico
-- concluído. Novas cotações serão inseridas explicitamente como 'processing'
-- pelo backend; o DEFAULT continua 'processing' para segurança.
UPDATE agro.quote SET status = 'completed' WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_quote_status
    ON agro.quote (status)
    WHERE deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS agro.idx_quote_status;
ALTER TABLE agro.quote DROP COLUMN IF EXISTS status;
