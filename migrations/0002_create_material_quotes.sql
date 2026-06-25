-- migrate:up
CREATE TABLE IF NOT EXISTS material_quotes (
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

CREATE TABLE IF NOT EXISTS quote_products (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    quote_id   BIGINT      NOT NULL REFERENCES material_quotes (id),
    material   TEXT        NOT NULL,
    quantity   NUMERIC,
    unit       TEXT,
    brand      TEXT,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_products_quote_id
    ON quote_products (quote_id);

-- migrate:down
DROP TABLE IF EXISTS quote_products;
DROP TABLE IF EXISTS material_quotes;
