// Doha (Qatar) standard time utilities.
// The app's canonical timezone is Asia/Qatar (UTC+03:00, no DST).
// Use these helpers for anything user-facing: "today", data-date defaults,
// filename stamps, and display formatting. DB audit timestamps
// (created_at / updated_at / started_at / finished_at) remain UTC.

export const DOHA_TZ = "Asia/Qatar";
export const DOHA_OFFSET_MIN = 3 * 60; // +03:00, no DST

function shiftToDoha(d: Date): Date {
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
export function toDohaDateKey(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return shiftToDoha(d).toISOString().slice(0, 10);
}

/** Doha timestamp for filenames: `YYYYMMDD-HHmm`. */
export function dohaStampCompact(): string {
  const s = shiftToDoha(new Date()).toISOString();
  return s.slice(0, 16).replace(/[-:T]/g, "");
}

/** Doha timestamp for display: `YYYY-MM-DD HH:mm:ss`. */
export function dohaStamp(input?: string | Date): string {
  const d = input ? (typeof input === "string" ? new Date(input) : input) : new Date();
  return shiftToDoha(d).toISOString().slice(0, 19).replace("T", " ");
}

/** Doha date-time for display: `YYYY-MM-DD HH:mm`. */
export function dohaDateTime(input?: string | Date): string {
  const d = input ? (typeof input === "string" ? new Date(input) : input) : new Date();
  return shiftToDoha(d).toISOString().slice(0, 16).replace("T", " ");
}

/** Convert a Doha calendar date-key + local wall time to the equivalent UTC ISO. */
export function dohaDateKeyToUtcIso(dateKey: string, wallTime = "00:00:00"): string {
  return new Date(`${dateKey}T${wallTime}+03:00`).toISOString();
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
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mi = String(min).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return new Date(`${y}-${mm}-${dd}T${hh}:${mi}:${ss}+03:00`).toISOString();
}

/** Convert a Date to YYYY-MM-DD read as Doha wall-clock (regardless of runtime TZ). */
export function dohaDateOnly(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return shiftToDoha(d).toISOString().slice(0, 10);
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
