/**
 * Fase E — dispara a cotação por WhatsApp e persiste o histórico.
 *
 * Para cada fornecedor: envia a mensagem (Evolution) e, SÓ se o envio der
 * certo, registra fornecedor + conversa + mensagem de abertura. Assim o painel
 * reflete apenas o que foi realmente enviado. Falha num fornecedor não aborta
 * os demais. Envios são espaçados (config.cotacao.dispatchDelayMs) para não
 * sobrecarregar a instância do WhatsApp.
 */
import { config } from "../../config";
import type { Cotacao } from "../../schema";
import { buildSupplierMessage } from "../messages";
import { sendText } from "../providers/evolution";
import {
  createConversation,
  findOrCreateSupplier,
  insertSystemMessage,
} from "../repository";
import { normalizePhone } from "./phone";
import type { SupplierCandidate } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function dispatchToSuppliers(
  quoteId: string,
  cotacao: Cotacao,
  suppliers: SupplierCandidate[],
): Promise<SupplierCandidate[]> {
  // A mensagem não é específica por fornecedor — construída uma vez.
  const text = buildSupplierMessage({
    nome: cotacao.nome,
    cidade: cotacao.cidade,
    produtos: cotacao.produtos,
  });

  // Modo de teste controlado: redireciona TODO envio para um único número.
  const testRecipient = normalizePhone(config.cotacao.dispatchTestRecipient);
  if (testRecipient) {
    console.warn(
      `[cotacao ${quoteId}] MODO TESTE ATIVO: todos os WhatsApps vão para ${testRecipient} (fornecedores reais não recebem).`,
    );
  }

  const dispatched: SupplierCandidate[] = [];
  for (let i = 0; i < suppliers.length; i++) {
    const s = suppliers[i];
    try {
      const { waMessageId } = await sendText(testRecipient || s.phone, text);

      const supplierId = await findOrCreateSupplier({
        name: s.name,
        city: s.city,
        state: s.state,
        phone: s.phone,
        address: s.address,
      });
      const conversationId = await createConversation({
        quoteId,
        supplierId,
        dispatchNumber: i + 1,
        initialMessage: text,
      });
      await insertSystemMessage({
        conversationId,
        content: text,
        waMessageId,
        sentAt: new Date(),
      });
      dispatched.push(s);
    } catch (error) {
      console.warn(
        `[cotacao ${quoteId}] falha ao contatar ${s.name} (${s.phone}):`,
        (error as Error).message,
      );
    }

    if (i < suppliers.length - 1) await sleep(config.cotacao.dispatchDelayMs);
  }

  return dispatched;
}
