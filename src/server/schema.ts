import { z } from "zod";

/**
 * Validação do payload da cotação de insumos.
 * Espelha exatamente os campos pedidos: marca é o único opcional.
 */
export const produtoSchema = z.object({
  material: z.string().trim().min(1, "Material é obrigatório"),
  quantidade: z
    .number({ invalid_type_error: "Quantidade deve ser um número" })
    .positive("Quantidade deve ser maior que zero"),
  unidade: z.string().trim().min(1, "Unidade é obrigatória"),
  marca: z.string().trim().optional(),
});

export const cotacaoSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório"),
  email: z.string().trim().email("E-mail inválido"),
  cidade: z.string().trim().min(1, "Cidade é obrigatória"),
  estado: z.string().trim().min(1, "Estado é obrigatório"),
  produtos: z.array(produtoSchema).min(1, "Inclua pelo menos um produto"),

  // Preferências da busca (opcionais; caem nos defaults do .env se ausentes).
  // Máximo de fornecedores a contatar (regra de negócio: teto de 10).
  maxFornecedores: z.number().int().min(1).max(10).optional(),
  // Abrangência: "raio" usa raioKm; "brasil" busca no país inteiro (sem teto de km).
  abrangencia: z.enum(["raio", "brasil"]).optional(),
  // Raio máximo em km (usado quando abrangencia === "raio").
  raioKm: z.number().int().positive().max(1000).optional(),
});

export type Cotacao = z.infer<typeof cotacaoSchema>;
export type Produto = z.infer<typeof produtoSchema>;
