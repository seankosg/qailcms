// Doha (Qatar) standard time utilities.
// The app's canonical timezone is Asia/Qatar (UTC+03:00, no DST).
// Use these helpers for anything user-facing: "today", data-date defaults,
// filename stamps, and display formatting. DB audit timestamps
// (created_at / updated_at / started_at / finished_at) remain UTC.

export const DOHA_TZ = "Asia/Qatar";
export const DOHA_OFFSET_MIN = 3 * 60; // +03:00, no DST

function shiftToDoha(d: Date): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    return new Date(NaN);
  }
  return new Date(d.getTime() + DOHA_OFFSET_MIN * 60_000);
}

/** Current wall-clock in Doha as a Date whose UTC components equal Doha local. */
export function nowInDoha(): Date {
  return shiftToDoha(new Date());
}

/** Today's calendar date in Doha, as `YYYY-MM-DD`. */
export function todayInDoha(): string {
  return shiftToDoha(new Date()).toISOString().slice(0, 10);
}

/** Convert any ISO/Date to the Doha calendar date key (`YYYY-MM-DD`). */
export function toDohaDateKey(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "";
  const d = typeof input === "string" ? new Date(input) : input;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const shifted = shiftToDoha(d);
  if (Number.isNaN(shifted.getTime())) return "";
  return shifted.toISOString().slice(0, 10);
}

/** Doha timestamp for filenames: `YYYYMMDD-HHmm`. */
export function dohaStampCompact(): string {
  const s = shiftToDoha(new Date()).toISOString();
  return s.slice(0, 16).replace(/[-:T]/g, "");
}

/** Doha timestamp for display: `YYYY-MM-DD HH:mm:ss`. */
export function dohaStamp(input?: string | Date): string {
  const d = input ? (typeof input === "string" ? new Date(input) : input) : new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const shifted = shiftToDoha(d);
  if (Number.isNaN(shifted.getTime())) return "";
  return shifted.toISOString().slice(0, 19).replace("T", " ");
}

/** Doha date-time for display: `YYYY-MM-DD HH:mm`. */
export function dohaDateTime(input?: string | Date): string {
  const d = input ? (typeof input === "string" ? new Date(input) : input) : new Date();
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const shifted = shiftToDoha(d);
  if (Number.isNaN(shifted.getTime())) return "";
  return shifted.toISOString().slice(0, 16).replace("T", " ");
}

// ── User-facing date display formatters ──────────────────────────
// Canonical formats:
//   Long  : dd-MMM-yyyy  (e.g. 22-Jul-2026)
//   Short : dd-MMM       (e.g. 22-Jul)
//   Short w/ year : dd-MMM-yy (e.g. 22-Jul-26)
//   Date+Time     : dd-MMM-yyyy HH:mm
// All inputs are interpreted per Doha wall-clock. Invalid inputs → "".

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toDohaParts(input: string | number | Date | null | undefined):
  | { d: string; m: string; y: string; hh: string; mm: string }
  | null {
  if (input == null || input === "") return null;
  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === "number") {
    date = new Date(input);
  } else {
    const s = String(input).trim();
    if (!s) return null;
    // Bare YYYY-MM-DD → treat as Doha calendar date (no TZ shift needed).
    const bareIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (bareIso) {
      const [, y, m, d] = bareIso;
      const mi = Number(m) - 1;
      if (mi < 0 || mi > 11) return null;
      return { d, m: MONTHS_SHORT[mi], y, hh: "00", mm: "00" };
    }
    date = new Date(s);
  }
  if (Number.isNaN(date.getTime())) return null;
  const shifted = shiftToDoha(date);
  const iso = shifted.toISOString();
  const y = iso.slice(0, 4);
  const mIdx = Number(iso.slice(5, 7)) - 1;
  const d = iso.slice(8, 10);
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  if (mIdx < 0 || mIdx > 11) return null;
  return { d, m: MONTHS_SHORT[mIdx], y, hh, mm };
}

/** dd-MMM-yyyy (long, canonical single-date display). */
export function formatDdMmmYyyy(input: string | number | Date | null | undefined): string {
  const p = toDohaParts(input);
  return p ? `${p.d}-${p.m}-${p.y}` : "";
}

/** dd-MMM (compact, no year). */
export function formatDdMmm(input: string | number | Date | null | undefined): string {
  const p = toDohaParts(input);
  return p ? `${p.d}-${p.m}` : "";
}

/** dd-MMM-yy (compact w/ 2-digit year). */
export function formatDdMmmYy(input: string | number | Date | null | undefined): string {
  const p = toDohaParts(input);
  return p ? `${p.d}-${p.m}-${p.y.slice(2)}` : "";
}

/** dd-MMM-yyyy HH:mm (single date-time display). */
export function formatDdMmmYyyyHm(input: string | number | Date | null | undefined): string {
  const p = toDohaParts(input);
  return p ? `${p.d}-${p.m}-${p.y} ${p.hh}:${p.mm}` : "";
}

/** Convert a Doha calendar date-key + local wall time to the equivalent UTC ISO. */
export function dohaDateKeyToUtcIso(dateKey: string, wallTime = "00:00:00"): string {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const d = new Date(`${dateKey}T${wallTime}+03:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/** Convert wall-clock (Y/M/D/h/m/s, no timezone) interpreted as Doha (+03:00) to UTC ISO. */
export function dohaWallToUtcIso(
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
  s = 0,
): string {
  if (
    !Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) ||
    y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31 ||
    h < 0 || h > 23 || min < 0 || min > 59 || s < 0 || s > 59
  ) {
    return "";
  }
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mi = String(min).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const parsed = new Date(`${y}-${mm}-${dd}T${hh}:${mi}:${ss}+03:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

/** Read a Date's local wall-clock components as `YYYY-MM-DD` (Doha semantics). */
export function dohaDateOnly(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Convert any Date to UTC ISO by re-interpreting its *local* wall-clock
 * components as Doha (+03:00). Use for Date objects produced by user input
 * (date pickers, XLSX cellDates:true) where the wall-clock is authoritative.
 */
export function dohaLocalDateToUtcIso(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return dohaWallToUtcIso(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
}
