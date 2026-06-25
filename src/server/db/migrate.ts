/**
 * Runner de migrations simples (SQL puro + Postgres).
 *
 *   npm run migrate          aplica as migrations pendentes
 *   npm run migrate:down     reverte a última migration aplicada
 *   npm run migrate:status   mostra o que já foi aplicado
 *
 * Cada arquivo em /migrations é um .sql com duas seções:
 *   -- migrate:up     (executado no "up")
 *   -- migrate:down   (executado no "down")
 * Os arquivos são aplicados em ordem alfabética (use prefixo numérico).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config } from "../config";

const currentDir = path.dirname(fileURLToPath(import.meta.url)); // src/server/db
const migrationsDir = path.resolve(currentDir, "../../../migrations");

const UP_MARKER = "-- migrate:up";
const DOWN_MARKER = "-- migrate:down";

function parseSql(sql: string): { up: string; down: string } {
  const upIdx = sql.indexOf(UP_MARKER);
  const downIdx = sql.indexOf(DOWN_MARKER);
  if (upIdx === -1) return { up: sql.trim(), down: "" };
  const up = (
    downIdx === -1
      ? sql.slice(upIdx + UP_MARKER.length)
      : sql.slice(upIdx + UP_MARKER.length, downIdx)
  ).trim();
  const down = downIdx === -1 ? "" : sql.slice(downIdx + DOWN_MARKER.length).trim();
  return { up, down };
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  // Tudo das migrations (inclusive o controle) vive no schema `agro`.
  await client.query("CREATE SCHEMA IF NOT EXISTS agro;");
  await client.query(`
    CREATE TABLE IF NOT EXISTS agro.schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ name: string }>(
    "SELECT name FROM agro.schema_migrations ORDER BY name",
  );
  return new Set(rows.map((r) => r.name));
}

async function runUp(client: Client): Promise<void> {
  const done = await appliedSet(client);
  const pending = listMigrationFiles().filter((f) => !done.has(f));

  if (pending.length === 0) {
    console.log("Banco já está atualizado. Nada a aplicar.");
    return;
  }

  for (const file of pending) {
    const { up } = parseSql(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    console.log(`Aplicando ${file}...`);
    await client.query("BEGIN");
    try {
      if (up) await client.query(up);
      await client.query("INSERT INTO agro.schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(`OK: ${pending.length} migration(s) aplicada(s).`);
}

async function runDown(client: Client): Promise<void> {
  const done = [...(await appliedSet(client))].sort();
  const last = done[done.length - 1];

  if (!last) {
    console.log("Nenhuma migration aplicada para reverter.");
    return;
  }

  const { down } = parseSql(fs.readFileSync(path.join(migrationsDir, last), "utf8"));
  console.log(`Revertendo ${last}...`);
  await client.query("BEGIN");
  try {
    if (down) await client.query(down);
    await client.query("DELETE FROM agro.schema_migrations WHERE name = $1", [last]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  console.log("OK: migration revertida.");
}

async function showStatus(client: Client): Promise<void> {
  const done = await appliedSet(client);
  const files = listMigrationFiles();
  if (files.length === 0) {
    console.log("Nenhuma migration encontrada em /migrations.");
    return;
  }
  for (const file of files) {
    console.log(`${done.has(file) ? "[x] aplicada " : "[ ] pendente "} ${file}`);
  }
}

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    console.error("Defina DATABASE_URL no .env para rodar as migrations.");
    process.exit(1);
  }

  const command = process.argv[2] ?? "up";
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    if (command === "up") await runUp(client);
    else if (command === "down") await runDown(client);
    else if (command === "status") await showStatus(client);
    else {
      console.error(`Comando desconhecido: ${command} (use up | down | status)`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Falha nas migrations:", error);
  process.exit(1);
});
