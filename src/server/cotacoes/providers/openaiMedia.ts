/**
 * Providers OpenAI de mídia (usados pelo agente inbound):
 *   - transcribeAudio: áudio -> texto (transcrição)
 *   - describeImage:   imagem -> descrição em uma frase
 *   - extractPdfText:  PDF de orçamento -> texto estruturado
 * Todos recebem a mídia em base64 (baixada da Evolution).
 */
import { config } from "../../config";
import { httpJson } from "./http";

function apiKey(): string {
  const k = config.cotacao.openaiApiKey;
  if (!k) throw new Error("OPENAI_API_KEY não configurada.");
  return k;
}

/** Áudio (base64) -> transcrição, via /v1/audio/transcriptions (multipart). */
export async function transcribeAudio(
  base64: string,
  mimetype: string,
): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const ext = mimetype.includes("mp4")
    ? "mp4"
    : mimetype.includes("mpeg") || mimetype.includes("mp3")
      ? "mp3"
      : mimetype.includes("wav")
        ? "wav"
        : "ogg";

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: mimetype || "audio/ogg" }),
    `audio.${ext}`,
  );
  form.append("model", config.cotacao.transcriptionModel);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Transcrição (${res.status}): ${text.slice(0, 300)}`);
    }
    return (JSON.parse(text).text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

const IMAGE_SYSTEM = `Você interpreta imagens enviadas por fornecedores de insumos de agronegócio (cotações, notas fiscais, produtos, listas, prints). Descreva DIRETAMENTE o conteúdo em uma frase objetiva. Se houver texto, transcreva-o EXATAMENTE. Não use prefixos como "recebi/vejo". Nunca faça perguntas.`;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/** Imagem (base64) -> descrição em uma frase, via visão (gpt-4o). */
export async function describeImage(
  base64: string,
  mimetype: string,
): Promise<string> {
  const dataUri = `data:${mimetype || "image/jpeg"};base64,${base64}`;
  const data = await httpJson<ChatResponse>(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: {
        model: config.cotacao.visionModel,
        messages: [
          { role: "system", content: IMAGE_SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Descreva o conteúdo desta imagem." },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      },
      retries: 2,
    },
  );
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

const PDF_PROMPT = `Extraia deste PDF de orçamento, em texto corrido e objetivo (pt-BR): os itens (descrição EXATA, quantidade, unidade, preço unitário e total), os valores totais e as condições comerciais (forma de pagamento, prazo de entrega, validade, frete). Se não for um orçamento, diga o que é.`;

/** Junta os textos de saída da Responses API. */
function extractResponsesText(data: unknown): string {
  const d = data as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (typeof d?.output_text === "string") return d.output_text.trim();
  const parts: string[] = [];
  for (const item of d?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n").trim();
}

/** PDF (base64) -> texto estruturado do orçamento, via /v1/responses. */
export async function extractPdfText(base64: string): Promise<string> {
  const dataUri = `data:application/pdf;base64,${base64}`;
  const data = await httpJson<unknown>("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: {
      model: config.cotacao.openaiModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: PDF_PROMPT },
            {
              type: "input_file",
              filename: "orcamento.pdf",
              file_data: dataUri,
            },
          ],
        },
      ],
    },
    retries: 1,
  });
  return extractResponsesText(data);
}
