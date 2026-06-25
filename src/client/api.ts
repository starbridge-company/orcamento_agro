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

const API_BASE = import.meta.env.VITE_API_URL ?? "";

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
