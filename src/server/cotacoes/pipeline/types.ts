/** Um fornecedor candidato encontrado por alguma fonte de descoberta. */
export interface SupplierCandidate {
  name: string;
  /** Telefone normalizado (só dígitos, com prefixo 55). */
  phone: string;
  address: string | null;
  city: string;
  state: string;
  source: "google_places" | "perplexity";
  /** Preenchido após a verificação de WhatsApp (jid da Evolution). */
  whatsappJid?: string;
}
