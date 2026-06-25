/** Formata uma data ISO para o formato brasileiro (dd/mm/aaaa). */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Formata só a hora (HH:mm) de um timestamp ISO. */
export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Rótulo de dia para separadores do chat: "Hoje", "Ontem" ou dd/mm/aaaa. */
export function formatDayLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (sameDay(d, hoje)) return "Hoje";
  if (sameDay(d, ontem)) return "Ontem";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Formata a quantidade de um produto (pg devolve NUMERIC como string). */
export function formatQty(q: number | string | null): string {
  if (q === null || q === "") return "";
  const n = typeof q === "number" ? q : parseFloat(q);
  if (!Number.isFinite(n)) return String(q);
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
