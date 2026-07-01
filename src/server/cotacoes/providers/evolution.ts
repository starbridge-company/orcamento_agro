/**
 * Provider Evolution API (WhatsApp). A MESMA instância serve à verificação de
 * número e (Etapa 4) ao envio de mensagem. Base URL, api key e instância vêm
 * do .env (config.cotacao.evolution).
 */
import { config } from "../../config";
import { httpJson } from "./http";

function creds(): { apiUrl: string; apiKey: string; instance: string } {
  const { apiUrl, apiKey, instance } = config.cotacao.evolution;
  if (!apiUrl) throw new Error("EVOLUTION_API_URL não configurada.");
  if (!apiKey) throw new Error("EVOLUTION_API_KEY não configurada.");
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey, instance };
}

const onlyDigits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

interface WhatsappNumberStatus {
  exists?: boolean;
  jid?: string;
  number?: string;
}

export interface WaCheck {
  number: string; // número consultado (normalizado)
  exists: boolean;
  jid: string | null;
}

/**
 * Verifica quais números têm WhatsApp (POST /chat/whatsappNumbers/{instance}).
 * Retorna um resultado por número consultado, na mesma ordem da entrada.
 */
export async function checkWhatsappNumbers(
  numbers: string[],
): Promise<WaCheck[]> {
  if (numbers.length === 0) return [];
  const { apiUrl, apiKey, instance } = creds();

  const data = await httpJson<WhatsappNumberStatus[]>(
    `${apiUrl}/chat/whatsappNumbers/${instance}`,
    { method: "POST", headers: { apikey: apiKey }, body: { numbers }, retries: 2 },
  );
  const arr = Array.isArray(data) ? data : [];

  // A Evolution devolve um item por número, na mesma ordem. Casamos por índice
  // e, se o número não bater, caímos para busca pelo valor (robustez).
  return numbers.map((num, i) => {
    let item: WhatsappNumberStatus | undefined = arr[i];
    if (!item || onlyDigits(item.number) !== num) {
      item = arr.find((a) => onlyDigits(a.number) === num) ?? item;
    }
    return { number: num, exists: !!item?.exists, jid: item?.jid ?? null };
  });
}

interface SendTextResponse {
  key?: { id?: string };
  [key: string]: unknown;
}

/**
 * Envia uma mensagem de texto (POST /message/sendText/{instance}).
 * Formato do corpo segue a Evolution API v2 ({ number, text }). Retorna o id
 * da mensagem no WhatsApp (key.id), quando disponível.
 */
export async function sendText(
  number: string,
  text: string,
): Promise<{ waMessageId: string | null }> {
  const { apiUrl, apiKey, instance } = creds();
  const data = await httpJson<SendTextResponse>(
    `${apiUrl}/message/sendText/${instance}`,
    { method: "POST", headers: { apikey: apiKey }, body: { number, text } },
  );
  return { waMessageId: data.key?.id ?? null };
}

interface MediaBase64Response {
  base64?: string;
  mimetype?: string;
}

/**
 * Baixa a mídia de uma mensagem recebida em base64
 * (POST /chat/getBase64FromMediaMessage/{instance}). `messageKey` é o
 * `data.key` do evento messages.upsert.
 */
export async function getMediaBase64(
  messageKey: unknown,
): Promise<{ base64: string; mimetype: string }> {
  const { apiUrl, apiKey, instance } = creds();
  const data = await httpJson<MediaBase64Response>(
    `${apiUrl}/chat/getBase64FromMediaMessage/${instance}`,
    {
      method: "POST",
      headers: { apikey: apiKey },
      body: { message: { key: messageKey }, convertToMp4: false },
      retries: 2,
    },
  );
  if (!data.base64) throw new Error("Evolution não retornou base64 da mídia.");
  return {
    base64: data.base64,
    mimetype: data.mimetype ?? "application/octet-stream",
  };
}
