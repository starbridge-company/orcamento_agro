/**
 * Gate do agente: a IA só responde quando a conversa está sob o Agente e ainda
 * não foi resolvida. Equivale à regra do n8n (label `atendimento_ia`):
 *   - responsible='Humano'  => humano assumiu, IA cala.
 *   - status='resolvido'    => atendimento encerrado, IA cala.
 */
export function agentShouldHandle(conv: {
  responsible: string;
  status: string;
}): boolean {
  return conv.responsible === "Agente" && conv.status !== "resolvido";
}
