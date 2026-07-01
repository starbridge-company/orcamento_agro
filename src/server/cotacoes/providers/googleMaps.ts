/**
 * Provider Google Maps: Places Text Search + Place Details + Geocoding.
 * Réplica das chamadas do fluxo n8n. A API devolve HTTP 200 mesmo em erro
 * lógico, então checamos sempre o campo `status`.
 */
import { config } from "../../config";
import { httpJson } from "./http";

function apiKey(): string {
  const k = config.cotacao.googleMapsApiKey;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY não configurada.");
  return k;
}

interface TextSearchResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    place_id: string;
    name?: string;
    formatted_address?: string;
  }>;
}

interface DetailsResponse {
  status: string;
  error_message?: string;
  result?: {
    name?: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    formatted_address?: string;
  };
}

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    geometry?: { location?: { lat: number; lng: number } };
    formatted_address?: string;
  }>;
}

export interface PlaceRef {
  placeId: string;
  name: string;
  address: string | null;
}

export async function placesTextSearch(query: string): Promise<PlaceRef[]> {
  const data = await httpJson<TextSearchResponse>(
    "https://maps.googleapis.com/maps/api/place/textsearch/json",
    { query: { query, key: apiKey(), language: "pt-BR" }, retries: 2 },
  );
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") {
    throw new Error(
      `Places TextSearch: ${data.status} ${data.error_message ?? ""}`.trim(),
    );
  }
  return (data.results ?? []).map((r) => ({
    placeId: r.place_id,
    name: r.name ?? "",
    address: r.formatted_address ?? null,
  }));
}

export interface PlaceDetail {
  name: string;
  phone: string | null;
  address: string | null;
}

export async function placeDetails(placeId: string): Promise<PlaceDetail | null> {
  const data = await httpJson<DetailsResponse>(
    "https://maps.googleapis.com/maps/api/place/details/json",
    {
      query: {
        place_id: placeId,
        fields:
          "formatted_phone_number,international_phone_number,name,formatted_address",
        key: apiKey(),
        language: "pt-BR",
      },
      retries: 2,
    },
  );
  if (data.status === "ZERO_RESULTS" || data.status === "NOT_FOUND") return null;
  if (data.status !== "OK") {
    throw new Error(
      `Place Details: ${data.status} ${data.error_message ?? ""}`.trim(),
    );
  }
  const r = data.result;
  if (!r) return null;
  return {
    name: r.name ?? "",
    phone: r.formatted_phone_number ?? r.international_phone_number ?? null,
    address: r.formatted_address ?? null,
  };
}

export interface GeoLocation {
  lat: number;
  lng: number;
  formattedAddress: string | null;
}

export async function geocode(
  city: string,
  state: string,
): Promise<GeoLocation | null> {
  const data = await httpJson<GeocodeResponse>(
    "https://maps.googleapis.com/maps/api/geocode/json",
    {
      query: {
        address: `${city}, ${state}, Brasil`,
        key: apiKey(),
        language: "pt-BR",
      },
      retries: 2,
    },
  );
  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") {
    throw new Error(`Geocode: ${data.status} ${data.error_message ?? ""}`.trim());
  }
  const loc = data.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: data.results?.[0]?.formatted_address ?? null,
  };
}
