/**
 * Status em que o atendimento da IA está ENCERRADO (ela não deve mais responder):
 * proposta fechada, fornecedor sem o produto, ou já em mãos do humano.
 * ("resolvido" fica por compatibilidade com dados antigos.)
 */
const TERMINAL_STATUSES = new Set([
  "proposta recebida",
  "fornecedor sem o produto",
  "aguardando humano",
  "resolvido",
]);

/**
 * Gate do agente: a IA só responde quando a conversa está sob o Agente e não
 * está num status terminal. Equivale à regra do n8n (label `atendimento_ia`):
 *   - responsible='Humano'   => humano assumiu, IA cala.
 *   - status terminal        => atendimento encerrado, IA cala.
 */
export function agentShouldHandle(conv: {
  responsible: string;
  status: string;
}): boolean {
  return (
    conv.responsible === "Agente" && !TERMINAL_STATUSES.has(conv.status)
  );
}
