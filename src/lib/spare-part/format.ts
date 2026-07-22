import { todayInDoha, formatDdMmm as _fmtShort, formatDdMmmYyyy } from "@/lib/time/doha";

/** Short display: dd-MMM (backwards-compat name). */
export function formatDdMmm(v: string | null | undefined): string {
  return _fmtShort(v);
}

/** Long display: dd-MMM-yyyy. */
export function formatDdMmmLong(v: string | null | undefined): string {
  return formatDdMmmYyyy(v);
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