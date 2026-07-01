/**
 * Serviço de cotação: ponto de entrada usado pela rota HTTP.
 *
 * Persiste a cotação de forma SÍNCRONA (para o id existir na hora e o link do
 * painel funcionar) e então enfileira o pipeline ASSÍNCRONO (descoberta de
 * fornecedores + disparo + e-mails). O POST responde sem esperar o pipeline.
 */
import type { Cotacao } from "../schema";
import { createQuoteWithProducts } from "./repository";
import { enqueueQuotePipeline } from "./jobs/runner";

export interface SubmitQuoteResult {
  id: string;
}

export async function submitQuote(
  cotacao: Cotacao,
  dominio: string,
): Promise<SubmitQuoteResult> {
  const quoteId = await createQuoteWithProducts(cotacao);
  enqueueQuotePipeline({ quoteId, cotacao, dominio });
  return { id: quoteId };
}
