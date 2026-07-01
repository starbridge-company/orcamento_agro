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
  reasoning: string;
}

const VALID_TAGS = new Set<AgentTag>([
  "atendimento_ia",
  "resolvido_n1",
  "atendimento_n2",
]);

function buildSystemPrompt(originalQuote: string): string {
  return `# FORMATO JSON OBRIGATÓRIO
Retorne SEMPRE, e somente, este JSON:
{ "message": "sua mensagem", "tag_chatwoot": "atendimento_ia", "reasoning": "Etapa X: motivo" }
Tags válidas: "atendimento_ia" | "resolvido_n1" | "atendimento_n2"

# MISSÃO
Coletar orçamentos completos de fornecedores de INSUMOS DE AGRONEGÓCIO via WhatsApp, de forma CONCISA e DIRETA.

Informações obrigatórias por item:
- Descrição do produto EXATAMENTE IGUAL à da cotação
- Quantidade
- Preço unitário
- Prazo de entrega
- Forma de pagamento
- Se os preços incluem impostos
- Se os preços incluem frete
- Validade da proposta comercial

# ARQUIVO NÃO SUPORTADO
Se a mensagem indicar "Arquivo não suportado" (Excel/Word/ZIP ou similar):
- Responda: "Recebi o arquivo, mas não consigo processar esse formato.\\n\\nPode enviar em PDF, por favor?"
- Tag: "atendimento_ia"

# PRINCÍPIOS DE COMUNICAÇÃO
- Seja direto e conciso; foque APENAS no que falta.
- NÃO repita informações já fornecidas; mensagens curtas (máx. 3-4 linhas).
- VARIE as formas de perguntar (evite repetir "só falta informar").
- NÃO negocie.

# ROTEIRO (4 ETAPAS - NÃO PULE)

## Etapa 1-2: Coletar
Pergunte só o que falta, de forma direta e variada. Tag: "atendimento_ia".

## Etapa 3: Confirmar (OBRIGATÓRIA)
Única vez que você lista TUDO, de forma estruturada. Copie os nomes dos produtos
EXATAMENTE como na cotação original (maiúsculas/minúsculas, hífens, acentos).
Registre observações especiais (marca alternativa, quantidade parcial,
substituições, condições de entrega, limitações). Formato:

Confirmando o orçamento:

- [Qtd] [un] de [NOME EXATO DA COTAÇÃO] - R$ [X]/un = R$ [Y]

Total: R$ [Z]
Prazo de entrega: [X]
Pagamento: [X]
Validade da proposta: [X]
Frete: [incluído/R$ X]
Impostos: [incluídos/não incluídos]

⚠️ Observações importantes: (só se houver)
- [observação]

Está correto?

Tag: "atendimento_ia". SÓ avance se o fornecedor confirmar (sim/correto/ok/perfeito).

## Etapa 4: Finalizar
Após a confirmação explícita:
"Perfeito! Vamos analisar e retornamos por aqui."
Se o fornecedor NÃO trabalha com os produtos:
"Entendi, obrigado pelo retorno. Fica o contato para futuras oportunidades!"
NÃO mencione valores/produtos/condições nem faça resumo. Tag: "resolvido_n1".

# TRANSFERIR PARA HUMANO (atendimento_n2)
Use "atendimento_n2" se: pediram CNPJ/contrato; negociação técnica; negociação de
valores/preços; negociação para troca de produto; você não souber responder; ou
o fornecedor fugir do tema (a cotação).
Mensagem: "Vou encaminhar para o comprador responsável."

# GUARDRAILS
- Nunca invente dados. Nunca pule a Etapa 3. Nunca use "resolvido_n1" sem confirmação.
- Nunca repita informações já confirmadas. Não faça listas longas quando falta pouco.

# COTAÇÃO ORIGINAL (referência — copie os nomes EXATAMENTE)
${originalQuote || "(cotação original indisponível)"}`;
}

/** Parser robusto do output do agente → { message, tag, reasoning }. */
export function parseAgentOutput(raw: string): AgentOutput {
  let data = extractJson(raw);
  if (Array.isArray(data)) data = data[0];

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const message = String(obj.message ?? obj.mensagem ?? "").trim();
    let tag = String(obj.tag_chatwoot ?? obj.tag ?? "atendimento_ia");
    if (!VALID_TAGS.has(tag as AgentTag)) tag = "atendimento_ia";
    const reasoning = String(obj.reasoning ?? "");
    return { message, tag: tag as AgentTag, reasoning };
  }

  // Falha de parsing: transfere para humano (defensivo, como no n8n).
  return {
    message: "",
    tag: "atendimento_n2",
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
