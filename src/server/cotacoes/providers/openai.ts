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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Chat completion multi-turn (usado pelo agente conversacional). */
export async function chatCompleteMessages(
  messages: ChatMessage[],
): Promise<string> {
  const key = config.cotacao.openaiApiKey;
  if (!key) throw new Error("OPENAI_API_KEY não configurada.");

  const data = await httpJson<ChatResponse>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: { model: config.cotacao.openaiModel, messages },
      retries: 2,
    },
  );

  return (data.choices?.[0]?.message?.content ?? "").trim();
}

/** Atalho single-turn (system + user). */
export async function chatComplete(params: {
  system: string;
  user: string;
}): Promise<string> {
  return chatCompleteMessages([
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ]);
}
