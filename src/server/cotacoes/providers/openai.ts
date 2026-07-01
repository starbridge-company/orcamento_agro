/**
 * Provider OpenAI (Chat Completions). Usado para classificar o grupo de
 * insumos (Etapa 2) e listar cidades vizinhas (Etapa 3). Modelo e chave vêm
 * do .env (config.cotacao.openaiModel / openaiApiKey).
 */
import { config } from "../../config";
import { httpJson } from "./http";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function chatComplete(params: {
  system: string;
  user: string;
}): Promise<string> {
  const key = config.cotacao.openaiApiKey;
  if (!key) throw new Error("OPENAI_API_KEY não configurada.");

  const data = await httpJson<ChatResponse>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model: config.cotacao.openaiModel,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
      },
      retries: 2,
    },
  );

  return (data.choices?.[0]?.message?.content ?? "").trim();
}
