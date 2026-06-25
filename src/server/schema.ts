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
});

export type Cotacao = z.infer<typeof cotacaoSchema>;
export type Produto = z.infer<typeof produtoSchema>;

/**
 * Normaliza a cotação para o formato enviado ao webhook:
 * remove o campo `marca` quando vier vazio (mantém o payload limpo).
 */
export function toWebhookPayload(cotacao: Cotacao): Cotacao {
  return {
    ...cotacao,
    produtos: cotacao.produtos.map((p) => {
      const marca = p.marca?.trim();
      const produto: Produto = {
        material: p.material,
        quantidade: p.quantidade,
        unidade: p.unidade,
      };
      if (marca) produto.marca = marca;
      return produto;
    }),
  };
}
