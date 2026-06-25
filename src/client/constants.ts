/**
 * Unidades de medida comuns para insumos do agronegócio.
 * `value` é o que vai para o banco/webhook (limpo); `label` é o que aparece
 * no dropdown (polido). Agrupadas: peso · área · volume · embalagem/contagem.
 */
export const UNIDADES = [
  // Peso
  { value: "kg", label: "Quilograma (kg)" },
  { value: "saca", label: "Saca" }, // saca de 50/60 kg (sementes, fertilizantes)
  { value: "t", label: "Tonelada (t)" }, // granel
  { value: "big bag", label: "Big bag (~1.000 kg)" },
  // Área
  { value: "ha", label: "Hectare (ha)" }, // dosagem por área
  // Volume
  { value: "L", label: "Litro (L)" }, // defensivos líquidos
  { value: "mL", label: "Mililitro (mL)" },
  { value: "bombona", label: "Bombona (~20 L)" },
  { value: "galão", label: "Galão" },
  { value: "frasco", label: "Frasco" },
  // Embalagem / contagem
  { value: "dose", label: "Dose" }, // sementes tratadas / inoculantes
  { value: "balde", label: "Balde" },
  { value: "caixa", label: "Caixa" },
  { value: "pacote", label: "Pacote" },
  { value: "un", label: "Unidade (un)" },
] as const;

/** Unidades federativas do Brasil (sigla). */
export const ESTADOS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;
