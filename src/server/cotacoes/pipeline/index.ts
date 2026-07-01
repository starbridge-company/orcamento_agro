/**
 * Orquestrador do pipeline de cotação (equivalente em código ao fluxo n8n
 * "Agente Comprador"). Roda de forma ASSÍNCRONA, disparado pelo runner após o
 * POST já ter respondido ao cliente.
 *
 * Fases:
 *   A. Classificar insumos em grupo(s)                        (OpenAI)
 *   C. Descobrir fornecedores: Places -> Perplexity -> vizinhas
 *   E. Persistir + disparar WhatsApp
 *   D/F. E-mails (sem fornecedores / sucesso) + status final
 */
import type { Cotacao } from "../../schema";
import { config } from "../../config";
import { setQuoteStatus, setQuoteSupplyGroup } from "../repository";
import { classifyGroup } from "./classify";
import { collectFromCity } from "./discovery";
import { findNearbyCities } from "./nearbyCities";
import { dispatchToSuppliers } from "./dispatch";
import { notifyNoSuppliers, notifySuccess } from "./notify";
import type { SupplierCandidate } from "./types";

export interface PipelineInput {
  quoteId: string;
  cotacao: Cotacao;
  /** Origem da requisição (ex.: https://app.exemplo.com) p/ link do painel. */
  dominio: string;
}

/** Teto de negócio para o número de fornecedores contatados por cotação. */
const MAX_SUPPLIERS = 10;

export async function runQuotePipeline(input: PipelineInput): Promise<void> {
  const { quoteId, cotacao } = input;

  // Alvo de fornecedores: preferência da cotação (limitada a 1..10) ou default.
  const target = Math.min(
    MAX_SUPPLIERS,
    Math.max(1, cotacao.maxFornecedores ?? config.cotacao.suppliersTarget),
  );

  // Abrangência: "brasil" => sem teto de km (null); senão o raio da cotação ou
  // o default do .env.
  const maxRadiusKm: number | null =
    cotacao.abrangencia === "brasil"
      ? null
      : (cotacao.raioKm ?? config.cotacao.searchMaxRadiusKm);

  // Fase A — classificar grupo(s) de insumos.
  const supplyGroup = await classifyGroup(cotacao.produtos);
  await setQuoteSupplyGroup(quoteId, supplyGroup);
  console.log(`[cotacao ${quoteId}] grupo classificado: ${supplyGroup}`);

  // Fase C — descobrir fornecedores COM WhatsApp. `seenPhones` dedup GLOBAL
  // entre a origem e todas as cidades vizinhas.
  const seenPhones = new Set<string>();
  const suppliers: SupplierCandidate[] = [];

  suppliers.push(
    ...(await collectFromCity(
      supplyGroup,
      cotacao.cidade,
      cotacao.estado,
      target,
      seenPhones,
    )),
  );
  console.log(
    `[cotacao ${quoteId}] ${suppliers.length}/${target} na origem ${cotacao.cidade}/${cotacao.estado}`,
  );

  // Expansão para cidades vizinhas enquanto faltarem fornecedores (equivalente
  // ao loop de raios 10/40/70/100km do n8n, aqui um for com break).
  if (suppliers.length < target) {
    let nearby: Awaited<ReturnType<typeof findNearbyCities>> = [];
    try {
      nearby = await findNearbyCities(
        cotacao.cidade,
        cotacao.estado,
        maxRadiusKm,
      );
    } catch (error) {
      console.warn(
        `[cotacao ${quoteId}] falha ao listar cidades vizinhas:`,
        (error as Error).message,
      );
    }

    for (const nc of nearby) {
      if (suppliers.length >= target) break;
      const needed = target - suppliers.length;
      const found = await collectFromCity(
        supplyGroup,
        nc.city,
        nc.state,
        needed,
        seenPhones,
      );
      suppliers.push(...found);
      console.log(
        `[cotacao ${quoteId}] +${found.length} em ${nc.city}/${nc.state} (${nc.radius}); total ${suppliers.length}/${target}`,
      );
    }
  }

  // Guarda "sem fornecedores": nada encontrado dentro do raio máximo.
  if (suppliers.length === 0) {
    console.log(`[cotacao ${quoteId}] nenhum fornecedor encontrado`);
    await safeNotify(quoteId, () => notifyNoSuppliers(cotacao.email));
    await setQuoteStatus(quoteId, "no_suppliers");
    return;
  }

  // Fase E — disparar a cotação por WhatsApp e persistir o histórico.
  const dispatched = await dispatchToSuppliers(quoteId, cotacao, suppliers);
  console.log(
    `[cotacao ${quoteId}] disparado para ${dispatched.length}/${suppliers.length} fornecedor(es)`,
  );

  // Fase F — e-mail de sucesso ao comprador (lista + link do painel).
  await safeNotify(quoteId, () =>
    notifySuccess({
      email: cotacao.email,
      quoteId,
      dominio: input.dominio,
      suppliers: dispatched.length > 0 ? dispatched : suppliers,
    }),
  );

  await setQuoteStatus(quoteId, "completed");
}

/**
 * Executa um envio de e-mail sem deixar uma falha de SMTP quebrar o pipeline:
 * os WhatsApps já foram disparados; um e-mail que não sai vira apenas um aviso.
 */
async function safeNotify(
  quoteId: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn(
      `[cotacao ${quoteId}] falha ao enviar e-mail:`,
      (error as Error).message,
    );
  }
}
