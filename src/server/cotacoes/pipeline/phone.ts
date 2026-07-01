/**
 * Normalização de telefone (réplica do `limparNumero` do n8n):
 * só dígitos, remove zeros à esquerda e garante o prefixo do Brasil (55).
 * Retorna "" quando não há número aproveitável.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return digits;
}
