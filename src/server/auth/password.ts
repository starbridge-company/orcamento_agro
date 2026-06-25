/**
 * Hashing de senhas com argon2id (vencedor da Password Hashing Competition,
 * recomendado pela OWASP). Guardamos a string PHC completa — ela já carrega o
 * salt e os parâmetros de custo, então `verify` não precisa deles.
 *
 * Pontos de segurança:
 *  - argon2id resiste a ataques de GPU e side-channel.
 *  - Parâmetros de custo configuráveis (config.auth.argon).
 *  - `verifyDummy` mantém o tempo de resposta constante quando o usuário não
 *    existe (evita enumeração de contas por timing).
 *  - `needsRehash` permite "subir" hashes antigos quando os custos aumentam.
 */
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { Algorithm } from "@node-rs/argon2";
import { config } from "../config";

// Argon2id = 2. Usamos o literal (com cast de tipo) porque `Algorithm` é um
// const enum ambiente — acessá-lo como valor quebra com `isolatedModules`.
const ARGON2ID = 2 as Algorithm;

const opts = {
  algorithm: ARGON2ID,
  memoryCost: config.auth.argon.memoryCost,
  timeCost: config.auth.argon.timeCost,
  parallelism: config.auth.argon.parallelism,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, opts);
}

export function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  // verify lê salt/custos da própria string PHC; basta passar hash + senha.
  return argonVerify(storedHash, plain).catch(() => false);
}

// Hash descartável (de uma senha aleatória) calculado uma única vez. Usado para
// gastar ~o mesmo tempo de um verify real quando o e-mail não existe.
const DUMMY_HASH = argonHash(
  "no-such-user::" + Math.random().toString(36),
  opts,
);

/** Consome tempo de verificação sem revelar se a conta existe. */
export async function verifyDummy(plain: string): Promise<void> {
  try {
    await argonVerify(await DUMMY_HASH, plain);
  } catch {
    /* ignore */
  }
}

/**
 * True se o hash foi gerado com custos menores que os atuais (ou outro algo),
 * sinalizando que devemos re-hashear a senha no próximo login bem-sucedido.
 */
export function needsRehash(storedHash: string): boolean {
  const m = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!m) return true; // formato desconhecido/legado => re-hashear
  const [, mem, time, par] = m;
  return (
    Number(mem) < opts.memoryCost ||
    Number(time) < opts.timeCost ||
    Number(par) < opts.parallelism
  );
}
