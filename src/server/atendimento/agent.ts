/**
 * Agente conversacional (adaptado do n8n para agro, WhatsApp-only, sem
 * Chatwoot/Gmail). Coleta o orçamento do fornecedor em 4 etapas e classifica a
 * conversa numa tag. Removidas as regras de canal Email/Gmail e os cenários
 * [ConvXXX]/troca-de-número (eram correlação de e-mail).
 */
import {
  chatCompleteMessages,
  type ChatMessage,
} from "../cotacoes/providers/openai";
import { extractJson } from "../cotacoes/util/json";

export type AgentTag = "atendimento_ia" | "resolvido_n1" | "atendimento_n2";

export interface AgentOutput {
  message: string;
  tag: AgentTag;
  status: string;
  reasoning: string;
}

const VALID_TAGS = new Set<AgentTag>([
  "atendimento_ia",
  "resolvido_n1",
  "atendimento_n2",
]);

/** Vocabulário de status da conversa (reflete o andamento no painel). */
export const CONVERSATION_STATUSES = [
  "aguardando retorno fornecedor", // ainda não respondeu (inicial)
  "em atendimento", // fornecedor respondendo / coletando dados
  "em negociação", // negociando preço/condições (vai p/ humano)
  "aguardando confirmação", // agente enviou a confirmação (Etapa 3)
  "proposta recebida", // fornecedor confirmou o orçamento (Etapa 4)
  "fornecedor sem o produto", // não trabalha com os itens / sem interesse
  "aguardando humano", // transferido para o comprador
] as const;

const STATUS_CANONICAL = new Map(
  CONVERSATION_STATUSES.map((s) => [s.toLowerCase(), s]),
);

/** Status padrão coerente com a tag, quando o agente não devolve um válido. */
function deriveStatus(tag: AgentTag): string {
  if (tag === "atendimento_n2") return "em negociação";
  if (tag === "resolvido_n1") return "proposta recebida";
  return "em atendimento";
}

function buildSystemPrompt(originalQuote: string): string {
  return `# FORMATO JSON OBRIGATÓRIO
Retorne SEMPRE, e somente, este JSON:
{ "message": "sua mensagem", "tag_chatwoot": "atendimento_ia", "status": "em atendimento", "reasoning": "Etapa X: motivo" }
Tags válidas: "atendimento_ia" | "resolvido_n1" | "atendimento_n2"

# STATUS DA CONVERSA (campo "status")
Escolha SEMPRE o status que reflete o estado ATUAL após a sua resposta:
- "em atendimento": o fornecedor está respondendo e você está coletando os dados.
- "aguardando confirmação": você enviou a confirmação do orçamento (Etapa 3) e espera o "sim".
- "em negociação": o fornecedor está negociando preço/condições ou pediu algo que exige humano.
- "proposta recebida": o fornecedor CONFIRMOU o orçamento (Etapa 4 positiva).
- "fornecedor sem o produto": o fornecedor não trabalha com os itens / não tem interesse.
- "aguardando humano": você transferiu para o comprador humano.
Coerência: tag "atendimento_ia" → "em atendimento" ou "aguardando confirmação";
tag "atendimento_n2" → "em negociação" (ou "aguardando humano");
tag "resolvido_n1" → "proposta recebida" ou "fornecedor sem o produto".

# MISSÃO
Coletar o orçamento de um fornecedor de INSUMOS DE AGRONEGÓCIO via WhatsApp, de
forma NATURAL, ESPERTA e DIRETA. Fornecedores respondem de forma informal e
incompleta — cabe a VOCÊ interpretar com bom senso, não travar a conversa.

# O QUE VOCÊ PRECISA (por cotação)
- VALOR: preço unitário por item **OU** um VALOR TOTAL — QUALQUER UM DOS DOIS BASTA.
- Prazo de entrega
- Forma de pagamento
- Frete (incluído ou valor)
- Impostos (inclusos ou não)
- Validade da proposta

# RACIOCÍNIO E VALORES (MUITO IMPORTANTE)
- Você TEM as quantidades da cotação (ex.: 10 t, 200 L). USE-AS para raciocinar.
- Você PODE e DEVE fazer contas: unitário × quantidade = total; total ÷ quantidade = unitário.
- Se o fornecedor der só o VALOR TOTAL, isso é SUFICIENTE — **NÃO exija** detalhamento por item.
- Se der preço por item, ótimo. Aceite o formato que ELE preferir.
- Se os números não fecharem (itens somam diferente do total), **NÃO fique repetindo**:
  registre a divergência como OBSERVAÇÃO na confirmação e SIGA. Se for algo que exige
  decisão comercial (renegociar preço), transfira para humano (atendimento_n2).

# ANTI-REPETIÇÃO (REGRA DE OURO)
- NUNCA faça a MESMA pergunta duas vezes.
- Se o fornecedor JÁ respondeu (mesmo informal ou aproximado), ACEITE e siga em frente.
- Faça no MÁXIMO 1 tentativa curta de esclarecer um ponto ambíguo. Se continuar
  ambíguo, registre como observação e AVANCE — não trave a conversa.
- Assim que tiver VALOR (total ou unitário) + prazo + pagamento + frete + impostos +
  validade, vá para a Etapa 3 (confirmação). NÃO fique coletando para sempre.

# COMUNICAÇÃO
- Direto, curto (2-4 linhas), natural, brasileiro. Varie as perguntas.
- Pergunte SÓ o que falta; não repita o que já tem; NÃO negocie.
- Evite frases robóticas ("para evitar divergência", "para eu fechar corretamente").

# ARQUIVO NÃO SUPORTADO
Se a mensagem indicar "Arquivo não suportado": responda "Recebi o arquivo, mas não
consigo processar esse formato.\\n\\nPode enviar em PDF, por favor?" — Tag "atendimento_ia".

# ROTEIRO (4 ETAPAS)

## Etapa 1-2: Coletar
Pergunte só o que falta, de forma direta e variada. Aceite total OU unitário.
No máximo 1-2 trocas por informação — depois AVANCE. Tag: "atendimento_ia".

## Etapa 3: Confirmar (uma única vez, estruturado)
Copie os nomes dos produtos EXATAMENTE como na cotação original. Se tiver preço por
item, mostre; se só tiver o total, mostre o total. Inclua observações/divergências.

Confirmando o orçamento:

- [Qtd] [un] de [NOME EXATO DA COTAÇÃO][ — R$ X/un = R$ Y, se houver]

Total: R$ [total]
Prazo de entrega: [X]
Pagamento: [X]
Frete: [incluído/R$ X]
Impostos: [incluídos/não incluídos]
Validade da proposta: [X]

⚠️ Observações: (só se houver — inclua aqui divergências de valor)
- [observação]

Está correto?

Tag: "atendimento_ia". SÓ avance se o fornecedor confirmar (sim/correto/ok/perfeito).

## Etapa 4: Finalizar
Após a confirmação: "Perfeito! Vamos analisar e retornamos por aqui." (Tag "resolvido_n1")
Se o fornecedor NÃO trabalha com os produtos: "Entendi, obrigado pelo retorno. Fica o
contato para futuras oportunidades!" (Tag "resolvido_n1")
NÃO mencione valores/produtos/condições nem faça resumo aqui.

# TRANSFERIR PARA HUMANO (atendimento_n2)
Use se: pediram CNPJ/contrato; negociação de preço/valores; troca de produto;
divergência comercial que precise de decisão; ou o fornecedor fugir do tema.
Mensagem: "Vou encaminhar para o comprador responsável."

# GUARDRAILS
- Nunca invente dados. Nunca pule a Etapa 3. Nunca use "resolvido_n1" sem confirmação.
- Nunca repita uma pergunta já respondida. NUNCA trave a conversa por um detalhe —
  registre como observação e siga.

# COTAÇÃO ORIGINAL (use os nomes e as quantidades EXATAS)
${originalQuote || "(cotação original indisponível)"}`;
}

/** Parser robusto do output do agente → { message, tag, reasoning }. */
export function parseAgentOutput(raw: string): AgentOutput {
  let data = extractJson(raw);
  if (Array.isArray(data)) data = data[0];

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const message = String(obj.message ?? obj.mensagem ?? "").trim();
    let tag = String(obj.tag_chatwoot ?? obj.tag ?? "atendimento_ia") as AgentTag;
    if (!VALID_TAGS.has(tag)) tag = "atendimento_ia";
    const rawStatus = String(obj.status ?? "").trim().toLowerCase();
    const status = STATUS_CANONICAL.get(rawStatus) ?? deriveStatus(tag);
    const reasoning = String(obj.reasoning ?? "");
    return { message, tag, status, reasoning };
  }

  // Falha de parsing: transfere para humano (defensivo, como no n8n).
  return {
    message: "",
    tag: "atendimento_n2",
    status: "aguardando humano",
    reasoning: "Erro de parsing da resposta do agente",
  };
}

export interface HistoryTurn {
  author: string; // 'supplier' | 'system' | ...
  content: string | null;
}

/** Monta o contexto e chama o modelo, devolvendo a resposta já parseada. */
export async function generateReply(
  originalQuote: string,
  history: HistoryTurn[],
): Promise<AgentOutput> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(originalQuote) },
  ];
  for (const turn of history) {
    if (!turn.content || !turn.content.trim()) continue;
    messages.push({
      role: turn.author === "supplier" ? "user" : "assistant",
      content: turn.content,
    });
  }

  const raw = await chatCompleteMessages(messages);
  return parseAgentOutput(raw);
}
