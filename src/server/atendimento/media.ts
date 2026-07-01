/**
 * Converte a mídia recebida do fornecedor em TEXTO para o agente:
 *   áudio  -> transcrição
 *   imagem -> descrição (+ legenda, se houver)
 *   pdf    -> extração do orçamento (+ legenda, se houver)
 *   outros -> "Arquivo não suportado" (o agente pede reenvio em PDF)
 */
import type { ParsedInbound } from "./parse";
import { getMediaBase64 } from "../cotacoes/providers/evolution";
import {
  describeImage,
  extractPdfText,
  transcribeAudio,
} from "../cotacoes/providers/openaiMedia";

function messageKey(raw: unknown): unknown {
  return (raw as { data?: { key?: unknown } })?.data?.key;
}

export async function resolveMediaText(parsed: ParsedInbound): Promise<string> {
  if (parsed.mediaType === "text") return parsed.text ?? "";
  if (parsed.mediaType === "unsupported") return "Arquivo não suportado";

  const { base64, mimetype } = await getMediaBase64(messageKey(parsed.raw));

  if (parsed.mediaType === "audio") {
    return await transcribeAudio(base64, mimetype);
  }
  if (parsed.mediaType === "image") {
    const desc = await describeImage(base64, mimetype);
    return parsed.text ? `${desc} ${parsed.text}` : desc;
  }
  if (parsed.mediaType === "pdf") {
    const extracted = await extractPdfText(base64);
    return parsed.text ? `${extracted} ${parsed.text}` : extracted;
  }
  return parsed.text ?? "";
}
