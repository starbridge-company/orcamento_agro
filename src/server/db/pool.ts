/**
 * Pool de conexões Postgres compartilhado pelas consultas em runtime
 * (separado do `Client` de vida curta usado em migrate.ts).
 *
 * O pool só é criado se DATABASE_URL estiver definida. Use getPool() nas
 * rotas: se o banco não estiver configurado, lança um erro claro em vez de
 * derrubar o processo na inicialização.
 */
import { Pool } from "pg";
import { config } from "../config";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!config.databaseUrl) {
    throw new Error(
      "DATABASE_URL não configurada — consultas ao banco indisponíveis.",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl });
    pool.on("error", (err) => {
      console.error("Erro inesperado no pool Postgres:", err);
    });
  }
  return pool;
}
