import { z } from "zod";

/**
 * Política de senha:
 *  - 8 a 128 caracteres (o teto evita DoS no argon2 com inputs gigantes).
 *  - ao menos uma minúscula, uma maiúscula e um dígito.
 */
export const passwordSchema = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres")
  .max(128, "A senha deve ter no máximo 128 caracteres")
  .refine((v) => /[a-z]/.test(v), "Inclua ao menos uma letra minúscula")
  .refine((v) => /[A-Z]/.test(v), "Inclua ao menos uma letra maiúscula")
  .refine((v) => /[0-9]/.test(v), "Inclua ao menos um número");

export const loginSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(254),
  // No login só exigimos que não esteja vazia (a política se aplica no cadastro).
  password: z.string().min(1, "Informe a senha").max(128),
  rememberMe: z.boolean().optional().default(false),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(254),
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
