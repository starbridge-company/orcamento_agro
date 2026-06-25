export interface ProdutoPayload {
  material: string;
  quantidade: number;
  unidade: string;
  marca?: string;
}

export interface CotacaoPayload {
  nome: string;
  email: string;
  cidade: string;
  estado: string;
  produtos: ProdutoPayload[];
}

/** Um material solicitado dentro de uma cotação (quote_products). */
export interface ProdutoCotacao {
  id: number;
  material: string;
  quantity: number | string | null;
  unit: string | null;
  brand: string | null;
}

/** Uma cotação (quote) com seus materiais e a contagem de respostas. */
export interface Cotacao {
  id: number;
  buyer_name: string;
  email: string;
  city: string;
  state: string;
  supply_group: string | null;
  created_at: string;
  products: ProdutoCotacao[];
  conversation_count: number;
}

/** Quem está conduzindo a conversa com o fornecedor. */
export type Responsavel = "Agente" | "Humano";

/** Uma conversa de cotação (quote_conversations) com dados do fornecedor/cotação. */
export interface Conversa {
  id: number;
  quote_id: number;
  buyer_name: string | null;
  responsible: Responsavel;
  dispatch_number: number;
  supplier_name: string | null;
  supplier_city: string | null;
  phone: string | null;
  initial_message: string | null;
  status: string;
  delivery_time: string | null;
  payment_method: string | null;
  shipping: string | null;
  taxes: string | null;
  volume: string | null;
  proposal_validity: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** Uma mensagem trocada na conversa (quote_conversation_messages). */
export interface Mensagem {
  id: number;
  conversation_id: number;
  author: string; // 'supplier' | 'system' | 'buyer' | ...
  content: string | null;
  message_type: string; // 'text' | 'image' | 'audio' | 'document' | ...
  wa_message_id: string | null;
  media_url: string | null;
  sent_at: string | null;
  created_at: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** Busca a lista de cotações (visão mestre da aba "Cotações"). */
export async function listarCotacoes(): Promise<Cotacao[]> {
  const response = await fetch(`${API_BASE}/api/cotacoes`);

  const data = (await response.json().catch(() => ({}))) as {
    cotacoes?: Cotacao[];
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? "Não foi possível carregar as cotações. Tente novamente.",
    );
  }

  return data.cotacoes ?? [];
}

/** Busca o detalhe de uma cotação pelo id. Retorna null se não existir. */
export async function obterCotacao(id: number): Promise<Cotacao | null> {
  const response = await fetch(`${API_BASE}/api/cotacoes/${id}`);

  if (response.status === 404) return null;

  const data = (await response.json().catch(() => ({}))) as {
    cotacao?: Cotacao;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? "Não foi possível carregar a cotação. Tente novamente.",
    );
  }

  return data.cotacao ?? null;
}

/** Busca as conversas (respostas dos fornecedores) de uma cotação específica. */
export async function listarConversas(quoteId: number): Promise<Conversa[]> {
  const response = await fetch(
    `${API_BASE}/api/cotacoes/conversas?quote_id=${quoteId}`,
  );

  const data = (await response.json().catch(() => ({}))) as {
    conversas?: Conversa[];
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? "Não foi possível carregar as conversas. Tente novamente.",
    );
  }

  return data.conversas ?? [];
}

/** Busca as mensagens de uma conversa, em ordem cronológica. */
export async function listarMensagens(
  conversationId: number,
): Promise<Mensagem[]> {
  const response = await fetch(
    `${API_BASE}/api/cotacoes/conversas/${conversationId}/mensagens`,
  );

  const data = (await response.json().catch(() => ({}))) as {
    mensagens?: Mensagem[];
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? "Não foi possível carregar as mensagens. Tente novamente.",
    );
  }

  return data.mensagens ?? [];
}

/** Atualiza o responsável (Agente | Humano) de uma conversa. */
export async function atualizarResponsavel(
  id: number,
  responsible: Responsavel,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/cotacoes/conversas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ responsible }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(
      data.message ?? "Não foi possível atualizar o responsável.",
    );
  }
}

/** Envia a cotação ao backend, que repassa ao webhook dos fornecedores. */
export async function enviarCotacao(
  payload: CotacaoPayload,
): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/api/cotacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as {
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      data.message ?? "Não foi possível enviar a cotação. Tente novamente.",
    );
  }

  return { message: data.message ?? "Cotação enviada com sucesso!" };
}
