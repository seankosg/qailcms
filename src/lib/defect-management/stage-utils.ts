// Lightweight stage helpers used by Defect Raw Data UI (overdue tinting, stage progress).
import { todayInDoha, formatDdMmmYyyy as _fmtLong } from "@/lib/time/doha";

export function todayIso(): string {
  return todayInDoha();
}

type Row = Record<string, any>;

export function isStageDone(row: Row, stage: "start" | "rectified" | "closure"): boolean {
  const sr = String(row.status_raw ?? "").trim().toLowerCase();
  const isRectifiedFamily =
    sr === "rectified" ||
    sr === "complete" ||
    sr === "completed" ||
    sr === "closed" ||
    sr === "verified";
  const isClosedFamily = sr === "closed" || sr === "verified";
  if (stage === "closure") {
    if (row.actual_closure_date) return true;
    if (isClosedFamily) return true;
    const cs = String(row.closure_status ?? "").trim().toLowerCase();
    if (cs === "closed" || cs === "verified") return true;
    return false;
  }
  if (stage === "rectified") {
    if (row.actual_rectified_date) return true;
    const p = Number(row.actual_progress_pct ?? 0);
    if ((p > 1 ? p : p * 100) >= 100) return true;
    if (row.actual_closure_date) return true;
    if (isRectifiedFamily) return true;
    const rs = String(row.rectified_status ?? "").trim().toLowerCase();
    if (rs === "rectified") return true;
    return false;
  }
  // start
  if (isRectifiedFamily) return true;
  if (row.actual_start_date) return true;
  const p = Number(row.actual_progress_pct ?? 0);
  if (p > 0) return true;
  return Boolean(row.actual_rectified_date || row.actual_closure_date);
}

export function isStageDelayedAsOf(row: Row, stage: "start" | "rectified" | "closure", asOf: string | null | undefined): boolean {
  if (!asOf) return false;
  const planned =
    stage === "start" ? row.planned_start_date :
    stage === "rectified" ? row.planned_rectified_date :
    row.planned_closure_date;
  if (!planned) return false;
  if (String(planned).slice(0, 10) > asOf) return false;
  return !isStageDone(row, stage);
}

export function isActualComplete(row: Row): boolean {
  return isStageDone(row, "rectified");
}

export function isClosureComplete(row: Row): boolean {
  return isStageDone(row, "closure");
}

export function isOverdueDefect(row: Row, asOf: string | null | undefined): boolean {
  if (!asOf) return false;
  return (
    isStageDelayedAsOf(row, "start", asOf) ||
    isStageDelayedAsOf(row, "rectified", asOf) ||
    isStageDelayedAsOf(row, "closure", asOf)
  );
}

export function classifyDefectStage(row: Row, asOf: string | null | undefined): "Not Started" | "In Progress" | "Completed" | "Closed" | "Delayed" {
  const d = asOf ?? todayIso();
  if (isStageDelayedAsOf(row, "start", d) || isStageDelayedAsOf(row, "rectified", d) || isStageDelayedAsOf(row, "closure", d)) return "Delayed";
  if (isStageDone(row, "closure")) return "Closed";
  if (isStageDone(row, "rectified")) return "Completed";
  if (isStageDone(row, "start")) return "In Progress";
  return "Not Started";
}

export function formatDdMmm(iso: string | null | undefined): string {
  return _fmtLong(iso);
}