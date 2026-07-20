export function formatDdMmm(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day}-${mon}`;
}

export function formatNumber(v: number | null | undefined, digits = 0): string {
  if (v == null) return "";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPct(v: unknown): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  return `${Math.round(n * 100)}%`;
}

export function isOverdue(deliveryDate: string | null | undefined, asOfIso?: string): boolean {
  if (!deliveryDate) return false;
  const asOf = asOfIso ?? todayInDoha();
  const iso = String(deliveryDate).slice(0, 10);
  return iso < asOf;
}