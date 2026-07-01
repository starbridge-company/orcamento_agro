/**
 * Fase C (expansão) — lista cidades para ampliar a busca de fornecedores.
 *
 * Recebe a abrangência escolhida na cotação:
 *   - maxRadiusKm = número  -> cidades dentro daquele raio (km).
 *   - maxRadiusKm = null    -> "todo o Brasil": começa pelas mais próximas e
 *                              expande para os polos do agronegócio nacional.
 *
 * Simplificação do n8n: geocodificamos a origem de forma determinística
 * (Google Geocoding) e passamos as coordenadas ao LLM, que devolve os
 * municípios em JSON. Uma única chamada, sem tool-calling.
 */
import { chatComplete } from "../providers/openai";
import { geocode } from "../providers/googleMaps";
import { extractJson } from "../util/json";

export interface NearbyCity {
  city: string;
  state: string;
  radius: string; // ex.: "10km", "40km"
}

const radiusKm = (r: string): number => {
  const n = parseInt(String(r).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

function parseCities(output: string): NearbyCity[] {
  const parsed = extractJson(output);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((c) => {
      const obj = (c ?? {}) as Record<string, unknown>;
      return {
        city: String(obj.cidade ?? obj.city ?? "").trim(),
        state: String(obj.estado ?? obj.state ?? "").trim(),
        radius: String(obj.raio ?? obj.radius ?? "").trim(),
      };
    })
    .filter((c) => c.city && c.state)
    .sort((a, b) => radiusKm(a.radius) - radiusKm(b.radius));
}

export async function findNearbyCities(
  city: string,
  state: string,
  maxRadiusKm: number | null,
): Promise<NearbyCity[]> {
  const nationwide = maxRadiusKm === null;

  // Coordenadas de referência (best-effort; segue sem elas se falhar).
  let coordsLine = "";
  try {
    const geo = await geocode(city, state);
    if (geo) {
      coordsLine = `Coordenadas de referência de ${city}/${state}: latitude ${geo.lat}, longitude ${geo.lng}.`;
    }
  } catch (error) {
    console.warn(
      `[nearbyCities] geocoding falhou p/ ${city}/${state}:`,
      (error as Error).message,
    );
  }

  const system =
    "Você é um assistente especializado em geografia brasileira. Conhece os municípios do Brasil e sabe estimar distâncias aproximadas entre eles.";

  const user = nationwide
    ? `Liste municípios oficiais do Brasil relevantes para a compra de insumos de agronegócio, começando pelos MAIS PRÓXIMOS de ${city}, ${state} e expandindo para os principais polos do agronegócio nacional.
${coordsLine}

REGRAS:
- Apenas municípios oficiais (não bairros/distritos).
- Comece pelos mais próximos e vá aumentando a distância; depois inclua grandes polos agro do país.
- Até 30 cidades, ordenadas da mais próxima para a mais distante.
- Em "raio", coloque a distância aproximada em km até ${city}.

FORMATO — retorne SOMENTE o array JSON puro, sem markdown nem texto:
[
  {"cidade": "Nome", "estado": "UF", "raio": "10km"},
  {"cidade": "Nome", "estado": "UF", "raio": "250km"}
]`
    : `Liste municípios oficiais do Brasil PRÓXIMOS de ${city}, ${state}, dentro de um raio de até ${maxRadiusKm}km, ordenados por distância crescente.
${coordsLine}

REGRAS:
- Apenas municípios oficiais (não bairros/distritos).
- Priorize os mais próximos e os de maior população.
- NÃO inclua cidades além de ${maxRadiusKm}km.
- Em "raio", coloque a distância aproximada em km até ${city}.

FORMATO — retorne SOMENTE o array JSON puro, sem markdown nem texto:
[
  {"cidade": "Nome", "estado": "UF", "raio": "10km"},
  {"cidade": "Nome", "estado": "UF", "raio": "40km"}
]`;

  const output = await chatComplete({ system, user });
  const cities = parseCities(output);

  // Com raio definido, descarta o que o modelo estimou além do limite.
  if (!nationwide) {
    return cities.filter((c) => radiusKm(c.radius) <= maxRadiusKm);
  }
  return cities;
}
