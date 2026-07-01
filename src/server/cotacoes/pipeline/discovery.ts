/**
 * Fase C — descoberta de fornecedores COM WhatsApp para uma cidade.
 *
 * Reúne o que no n8n eram DOIS caminhos quase idênticos (Google Places e
 * Perplexity) numa única função reutilizável: busca -> dedup -> verifica
 * WhatsApp. As fontes rodam em cascata: só chama a Perplexity se o Places não
 * bastou. Cada fonte é isolada em try/catch para que uma falha (ex.: chave
 * inválida) não derrube a descoberta inteira.
 */
import {
  placesTextSearch,
  placeDetails,
} from "../providers/googleMaps";
import { searchSuppliers as perplexitySearch } from "../providers/perplexity";
import { checkWhatsappNumbers } from "../providers/evolution";
import { normalizePhone } from "./phone";
import type { SupplierCandidate } from "./types";

/** Google Places: Text Search + Details, já com telefone normalizado. */
async function fromPlaces(
  group: string,
  city: string,
  state: string,
): Promise<SupplierCandidate[]> {
  const query = `Lojas, Fornecedores, Estabelecimentos que tenham ${group} em ${city}, ${state}, Brasil.`;
  const places = await placesTextSearch(query);

  const out: SupplierCandidate[] = [];
  for (const place of places) {
    let detail;
    try {
      detail = await placeDetails(place.placeId);
    } catch (error) {
      console.warn(
        `[discovery] Place Details falhou (${place.name}):`,
        (error as Error).message,
      );
      continue;
    }
    if (!detail) continue;
    const phone = normalizePhone(detail.phone);
    if (!phone) continue;
    out.push({
      name: detail.name || place.name,
      phone,
      address: detail.address ?? place.address,
      city,
      state,
      source: "google_places",
    });
  }
  return out;
}

/** Perplexity: fornecedores em JSON, já com telefone normalizado. */
async function fromPerplexity(
  group: string,
  city: string,
  state: string,
): Promise<SupplierCandidate[]> {
  const raw = await perplexitySearch(group, city, state);
  const out: SupplierCandidate[] = [];
  for (const r of raw) {
    const name = String(r.nome_empresa ?? r.nome ?? r.name ?? "").trim();
    if (!name) continue;
    const phone = normalizePhone(
      String(r.numero_telefone ?? r.telefone ?? r.phone ?? ""),
    );
    if (!phone) continue;
    const address = (r.endereco ?? r.address ?? null) as string | null;
    out.push({ name, phone, address, city, state, source: "perplexity" });
  }
  return out;
}

/** Mantém só quem tem WhatsApp confirmado, anexando o jid. */
async function verifyWhatsapp(
  candidates: SupplierCandidate[],
): Promise<SupplierCandidate[]> {
  if (candidates.length === 0) return [];
  const checks = await checkWhatsappNumbers(candidates.map((c) => c.phone));
  const byNumber = new Map(checks.map((c) => [c.number, c]));

  const verified: SupplierCandidate[] = [];
  for (const c of candidates) {
    const check = byNumber.get(c.phone);
    if (check?.exists) {
      verified.push({ ...c, whatsappJid: check.jid ?? undefined });
    }
  }
  return verified;
}

function dedupeByPhone(candidates: SupplierCandidate[]): SupplierCandidate[] {
  const seen = new Set<string>();
  const out: SupplierCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.phone)) continue;
    seen.add(c.phone);
    out.push(c);
  }
  return out;
}

/**
 * Coleta até `needed` fornecedores COM WhatsApp na cidade, em cascata
 * (Places -> Perplexity). `seenPhones` é compartilhado entre chamadas (ex.:
 * loop de cidades vizinhas) para dedup GLOBAL. Muta `seenPhones`.
 */
export async function collectFromCity(
  group: string,
  city: string,
  state: string,
  needed: number,
  seenPhones: Set<string> = new Set(),
): Promise<SupplierCandidate[]> {
  const found: SupplierCandidate[] = [];

  const addUnique = (list: SupplierCandidate[]) => {
    for (const c of list) {
      if (found.length >= needed) break;
      if (seenPhones.has(c.phone)) continue;
      seenPhones.add(c.phone);
      found.push(c);
    }
  };

  // Fonte 1: Google Places
  try {
    const verified = await verifyWhatsapp(dedupeByPhone(await fromPlaces(group, city, state)));
    addUnique(verified);
  } catch (error) {
    console.warn(
      `[discovery] Places falhou em ${city}/${state}:`,
      (error as Error).message,
    );
  }

  // Fonte 2: Perplexity (só se ainda faltam fornecedores)
  if (found.length < needed) {
    try {
      const verified = await verifyWhatsapp(dedupeByPhone(await fromPerplexity(group, city, state)));
      addUnique(verified);
    } catch (error) {
      console.warn(
        `[discovery] Perplexity falhou em ${city}/${state}:`,
        (error as Error).message,
      );
    }
  }

  return found;
}
