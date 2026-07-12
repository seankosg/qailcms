// Lightweight stage helpers used by Defect Raw Data UI (overdue tinting, stage progress).

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Row = Record<string, any>;

export function isStageDone(row: Row, stage: "start" | "completion" | "closure"): boolean {
  if (stage === "closure") return Boolean(row.actual_closure_date);
  if (stage === "completion") {
    if (row.actual_completion_date) return true;
    const p = Number(row.actual_progress_pct ?? 0);
    if ((p > 1 ? p : p * 100) >= 100) return true;
    return Boolean(row.actual_closure_date);
  }
  // start
  if (row.actual_start_date) return true;
  const p = Number(row.actual_progress_pct ?? 0);
  if (p > 0) return true;
  return Boolean(row.actual_completion_date || row.actual_closure_date);
}

export function isStageDelayedAsOf(row: Row, stage: "start" | "completion" | "closure", asOf: string | null | undefined): boolean {
  if (!asOf) return false;
  const planned =
    stage === "start" ? row.planned_start_date :
    stage === "completion" ? row.planned_completion_date :
    row.planned_closure_date;
  if (!planned) return false;
  if (String(planned).slice(0, 10) > asOf) return false;
  return !isStageDone(row, stage);
}

export function isActualComplete(row: Row): boolean {
  return isStageDone(row, "completion");
}

export function isClosureComplete(row: Row): boolean {
  return isStageDone(row, "closure");
}

export function isOverdueDefect(row: Row, asOf: string | null | undefined): boolean {
  if (!asOf) return false;
  return (
    isStageDelayedAsOf(row, "start", asOf) ||
    isStageDelayedAsOf(row, "completion", asOf) ||
    isStageDelayedAsOf(row, "closure", asOf)
  );
}

export function classifyDefectStage(row: Row, asOf: string | null | undefined): "Not Started" | "In Progress" | "Completed" | "Closed" | "Delayed" {
  const d = asOf ?? todayIso();
  if (isStageDelayedAsOf(row, "start", d) || isStageDelayedAsOf(row, "completion", d) || isStageDelayedAsOf(row, "closure", d)) return "Delayed";
  if (isStageDone(row, "closure")) return "Closed";
  if (isStageDone(row, "completion")) return "Completed";
  if (isStageDone(row, "start")) return "In Progress";
  return "Not Started";
}

export function formatDdMmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const [, m, d] = s.split("-");
  if (!m || !d) return s;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return s;
  return `${d} ${MONTHS[idx]}`;
}