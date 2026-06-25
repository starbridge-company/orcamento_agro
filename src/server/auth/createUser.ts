/**
 * CLI para criar usuários com segurança (sem self-registration aberto).
 *
 *   npm run create-user -- --name "Nome" --email user@ex.com --role admin
 *
 * Senha:
 *   - --password "Senha-Forte-123"            (fica no histórico do shell)
 *   - CREATE_USER_PASSWORD=... npm run ...     (recomendado: fora do histórico)
 *   - se omitida, uma senha forte é GERADA e exibida UMA única vez.
 *
 * Roles válidas: admin | manager | user | viewer  (padrão: admin, p/ bootstrap)
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config } from "../config";
import { getPool } from "../db/pool";
import { hashPassword } from "./password";
import { passwordSchema } from "./schema";
import { createUser, EmailTakenError } from "./users";
import type { AppRole } from "./tokens";

const ROLES: readonly AppRole[] = ["admin", "manager", "user", "viewer"];

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

/** Senha aleatória forte que satisfaz a política (maiúscula+minúscula+dígito). */
function generatePassword(): string {
  return randomBytes(18).toString("base64url") + "Aa1";
}

const inputSchema = z.object({
  name: z.string().trim().min(2, "Informe --name (>= 2 caracteres)").max(120),
  email: z.string().trim().email("Informe um --email válido").max(254),
});

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    console.error("Defina DATABASE_URL no .env antes de criar usuários.");
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const role = (args.role ?? "admin") as AppRole;

  if (!ROLES.includes(role)) {
    console.error(`Role inválida: "${role}". Use uma de: ${ROLES.join(", ")}.`);
    process.exit(1);
  }

  const base = inputSchema.safeParse({ name: args.name, email: args.email });
  if (!base.success) {
    for (const issue of base.error.issues) console.error("•", issue.message);
    console.error(
      '\nUso: npm run create-user -- --name "Nome" --email user@ex.com --role admin',
    );
    process.exit(1);
  }

  let password = process.env.CREATE_USER_PASSWORD ?? args.password;
  let generated = false;
  if (!password || password === "true") {
    password = generatePassword();
    generated = true;
  }

  const pw = passwordSchema.safeParse(password);
  if (!pw.success) {
    console.error("Senha não atende à política:");
    for (const issue of pw.error.issues) console.error("•", issue.message);
    process.exit(1);
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await createUser({
      name: base.data.name,
      email: base.data.email,
      passwordHash,
      role,
    });
    console.log("\n✓ Usuário criado com sucesso:");
    console.log(`  id:    ${user.id}`);
    console.log(`  nome:  ${user.name}`);
    console.log(`  email: ${user.email}`);
    console.log(`  role:  ${user.role}`);
    if (generated) {
      console.log("\n  SENHA GERADA (anote agora, não será exibida de novo):");
      console.log(`  ${password}\n`);
    }
  } catch (err) {
    if (err instanceof EmailTakenError) {
      console.error(`E-mail já cadastrado: ${base.data.email}`);
      process.exit(1);
    }
    console.error("Falha ao criar usuário:", err);
    process.exit(1);
  } finally {
    await getPool().end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
