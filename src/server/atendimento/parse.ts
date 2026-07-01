/**
 * Parser do evento `messages.upsert` da Evolution → forma normalizada.
 * Identifica telefone, id da mensagem, nome e o tipo de mídia (texto agora;
 * áudio/imagem/PDF entram na Etapa 5).
 */
import { normalizePhone } from "../cotacoes/pipeline/phone";

export type InboundMediaType = "text" | "audio" | "image" | "pdf" | "unsupported";

export interface ParsedInbound {
  phone: string;
  waMessageId: string | null;
  senderName: string | null;
  mediaType: InboundMediaType;
  text: string | null;
  /** Evento original — usado na Etapa 5 para baixar a mídia. */
  raw: unknown;
}

interface RawEvent {
  data?: {
    key?: { remoteJid?: string; id?: string };
    pushName?: string;
    messageType?: string;
    message?: Record<string, unknown>;
  };
}

export function parseEvolutionMessage(event: unknown): ParsedInbound | null {
  const data = (event as RawEvent)?.data;
  if (!data?.key) return null;

  const remoteJid = String(data.key.remoteJid ?? "");
  // Ignora grupos e status (broadcast).
  if (remoteJid.includes("@g.us") || remoteJid.includes("status@")) return null;

  const phone = normalizePhone(remoteJid.split("@")[0]);
  if (!phone) return null;

  const msg = (data.message ?? {}) as Record<string, any>;
  const type = data.messageType ?? "";

  let mediaType: InboundMediaType = "unsupported";
  let text: string | null = null;

  if (typeof msg.conversation === "string") {
    mediaType = "text";
    text = msg.conversation;
  } else if (typeof msg.extendedTextMessage?.text === "string") {
    mediaType = "text";
    text = msg.extendedTextMessage.text;
  } else if (msg.audioMessage || type === "audioMessage") {
    mediaType = "audio";
  } else if (msg.imageMessage || type === "imageMessage") {
    mediaType = "image";
    text =
      typeof msg.imageMessage?.caption === "string"
        ? msg.imageMessage.caption
        : null;
  } else if (msg.documentMessage || type === "documentMessage") {
    const mime = String(msg.documentMessage?.mimetype ?? "").toLowerCase();
    mediaType = mime.includes("pdf") ? "pdf" : "unsupported";
  }

  return {
    phone,
    waMessageId: data.key.id ?? null,
    senderName: data.pushName ?? null,
    mediaType,
    text,
    raw: event,
  };
}
