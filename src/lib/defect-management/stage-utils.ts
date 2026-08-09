// Lightweight stage helpers used by Defect Raw Data UI (overdue tinting, stage progress).
import { todayInDoha, formatDdMmmYyyy as _fmtLong } from "@/lib/time/doha";

export function todayIso(): string {
  return todayInDoha();
}

type Row = Record<string, any>;

export type SnagStage = "start" | "rectified" | "pre_inspection" | "dar_inspection" | "closure" | "ho";
export const SNAG_STAGES: SnagStage[] = ["start", "rectified", "pre_inspection", "dar_inspection", "closure", "ho"];

export function isStageDone(row: Row, stage: SnagStage): boolean {
  // A안(2026-07-30 확정): done 은 해당 스테이지 '자기 실적일' 만 인정.
  // 캐스케이드(후행 스테이지 날짜)·상태 스칼라(status_raw / progress_pct) 인정 제거.
  if (stage === "ho") return Boolean(row.actual_ho_date);
  if (stage === "closure") return Boolean(row.actual_closure_date);
  if (stage === "dar_inspection") return Boolean(row.actual_dar_inspection_date);
  if (stage === "pre_inspection") return Boolean(row.actual_pre_inspection_date);
  if (stage === "rectified") return Boolean(row.actual_rectified_date);
  return Boolean(row.actual_start_date);
}

export function isStageDelayedAsOf(row: Row, stage: SnagStage, asOf: string | null | undefined): boolean {
  if (!asOf) return false;
  const planned =
    stage === "start" ? row.planned_start_date :
    stage === "rectified" ? row.planned_rectified_date :
    stage === "pre_inspection" ? row.planned_pre_inspection_date :
    stage === "dar_inspection" ? row.planned_dar_inspection_date :
    stage === "closure" ? row.planned_closure_date :
    row.planned_ho_date;
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
  return SNAG_STAGES.some((s) => isStageDelayedAsOf(row, s, asOf));
}

export function classifyDefectStage(row: Row, asOf: string | null | undefined): "Not Started" | "In Progress" | "Completed" | "Closed" | "Delayed" {
  const d = asOf ?? todayIso();
  if (SNAG_STAGES.some((s) => isStageDelayedAsOf(row, s, d))) return "Delayed";
  if (isStageDone(row, "ho")) return "Closed";
  if (isStageDone(row, "closure")) return "Closed";
  if (isStageDone(row, "rectified")) return "Completed";
  if (isStageDone(row, "start")) return "In Progress";
  return "Not Started";
}

export function formatDdMmm(iso: string | null | undefined): string {
  return _fmtLong(iso);
}