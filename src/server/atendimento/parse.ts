/**
 * Parser do evento `messages.upsert` da Evolution → forma normalizada.
 * Identifica telefone, id da mensagem, nome e o tipo de mídia (texto, áudio,
 * imagem, PDF, contato compartilhado ou não suportado).
 */
import { normalizePhone } from "../cotacoes/pipeline/phone";

export type InboundMediaType =
  | "text"
  | "audio"
  | "image"
  | "pdf"
  | "contact"
  | "unsupported";

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

/** Nome (FN) de um vCard, se houver. */
function vcardName(vcard?: string): string {
  if (!vcard) return "";
  const m = vcard.match(/(?:^|\n)FN[^:]*:(.+)/);
  return m ? m[1].trim() : "";
}

/** Telefone de um vCard (prefere o waid; senão o TEL). */
function vcardPhone(vcard?: string): string {
  if (!vcard) return "";
  const wa = vcard.match(/waid=(\d+)/);
  if (wa) return wa[1];
  const tel = vcard.match(/(?:^|\n)TEL[^:]*:(.+)/);
  return tel ? tel[1].trim() : "";
}

/**
 * Descrição legível de um contato compartilhado (vCard único ou lista):
 * "Nome - Telefone; Nome2 - Telefone2". Serve para o agente ENTENDER que é uma
 * indicação de terceiro (não um documento) e agir conforme a triagem.
 */
function describeContacts(msg: Record<string, any>): string {
  const items: Array<{ displayName?: string; vcard?: string }> = [];
  if (msg.contactMessage) items.push(msg.contactMessage);
  const arr = msg.contactsArrayMessage;
  if (Array.isArray(arr?.contacts)) items.push(...arr.contacts);
  else if (arr) items.push(arr);

  const parts: string[] = [];
  for (const it of items) {
    const name = (it?.displayName || vcardName(it?.vcard) || "").trim();
    const phone = vcardPhone(it?.vcard).trim();
    const label = [name, phone].filter(Boolean).join(" - ");
    if (label) parts.push(label);
  }
  return parts.join("; ");
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
  } else if (
    msg.contactMessage ||
    msg.contactsArrayMessage ||
    type === "contactMessage" ||
    type === "contactsArrayMessage"
  ) {
    // Cartão de contato compartilhado = indicação de terceiro, não documento.
    mediaType = "contact";
    text = describeContacts(msg) || null;
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
