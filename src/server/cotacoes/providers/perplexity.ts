/**
 * Provider Perplexity (sonar-pro): fonte alternativa de fornecedores.
 * Réplica do prompt do n8n + o parser robusto que extrai o JSON de uma
 * resposta que pode vir com markdown/texto ao redor.
 */
import { config } from "../../config";
import { httpJson } from "./http";
import { extractJson } from "../util/json";

interface PerplexityResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface RawSupplier {
  nome_empresa?: string;
  nome?: string;
  name?: string;
  endereco?: string;
  address?: string;
  numero_telefone?: string;
  telefone?: string;
  phone?: string;
  [key: string]: unknown;
}

export async function searchSuppliers(
  group: string,
  city: string,
  state: string,
): Promise<RawSupplier[]> {
  const key = config.cotacao.perplexityApiKey;
  if (!key) throw new Error("PERPLEXITY_API_KEY não configurada.");

  const userContent = `# INSTRUÇÕES
Pesquise fornecedores de insumos para agronegócio para os produtos solicitados. VALIDE cada dado em pelo menos 2 fontes.

# INFORMAÇÕES DA COMPRA
- Cidade: ${city}
- Estado: ${state}
- Grupo de Produtos: ${group}

# REQUISITOS
- APENAS empresas com telefone confirmado
- Endereço completo (rua + número + bairro + cidade + estado)
- Máximo 10 empresas reais

# FORMATO OBRIGATÓRIO - JSON ARRAY SIMPLES
[
  {
    "nome_empresa": "Nome Completo",
    "endereco": "Rua X, 123, Bairro, Cidade, MG",
    "numero_telefone": "5511987654321",
    "reasoning_categoria_guardrail": "Validação dos dados",
    "fontes": "url1 url2"
  }
]

**RETORNE APENAS O JSON PURO**`;

  const data = await httpJson<PerplexityResponse>(
    "https://api.perplexity.ai/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model: config.cotacao.perplexityModel,
        messages: [
          {
            role: "system",
            content:
              "Você é um assistente especializado em encontrar fornecedores REAIS de insumos para agronegócio em cidades brasileiras. Sempre retorne APENAS JSON válido.",
          },
          { role: "user", content: userContent },
        ],
        max_tokens: 2500,
        web_search_options: { search_context_size: "medium" },
      },
      retries: 2,
    },
  );

  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content);
  if (!parsed) return [];
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.filter(
    (x): x is RawSupplier => !!x && typeof x === "object",
  );
}
