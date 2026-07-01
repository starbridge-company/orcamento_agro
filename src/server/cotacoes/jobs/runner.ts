/**
 * Runner assíncrono do pipeline de cotação.
 *
 * Costura de escalabilidade: hoje roda IN-PROCESS (fire-and-forget via
 * setImmediate), sem bloquear a resposta HTTP. Quando o volume justificar,
 * troca-se a implementação por uma fila durável (pg-boss/BullMQ) SEM alterar
 * quem chama `enqueueQuotePipeline`.
 *
 * Garantia: qualquer erro do pipeline é capturado e a cotação é marcada como
 * 'failed' (nunca deixa uma promise rejeitada sem tratamento derrubar o app).
 */
import { setQuoteStatus } from "../repository";
import { runQuotePipeline, type PipelineInput } from "../pipeline";

export function enqueueQuotePipeline(input: PipelineInput): void {
  setImmediate(() => {
    runQuotePipeline(input).catch(async (error) => {
      console.error(`[cotacao ${input.quoteId}] pipeline falhou:`, error);
      try {
        await setQuoteStatus(input.quoteId, "failed");
      } catch (statusError) {
        console.error(
          `[cotacao ${input.quoteId}] falha ao marcar status 'failed':`,
          statusError,
        );
      }
    });
  });
}
