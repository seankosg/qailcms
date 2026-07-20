// TM Dashboard KPI 계산 유틸 — SHAW PunchDashboard 산식을 TM 컬럼에 매핑
import type { TaskItem } from "./schedule-utils";
import type { TaskThresholds } from "./derived";

function parseDate(v: unknown): number | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00Z`);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function asOfMs(asOf: string): number {
  return parseDate(asOf) ?? Date.now();
}

/** asOfDate 기준 계획 진도율 (0..1). derived.expectedProgressToday의 asOf 파라미터화 버전. */
export function expectedProgressAt(
  row: { plan_start?: string | null; plan_end?: string | null },
  asOf: string,
): number {
  const start = parseDate(row.plan_start);
  const end = parseDate(row.plan_end);
  if (!start || !end) return 0;
  const t = asOfMs(asOf);
  const total = end - start;
  if (total <= 0) return t >= end ? 1 : 0;
  const elapsed = t - start;
  return Math.max(0, Math.min(1, elapsed / total));
}

export function gapAt(row: TaskItem, asOf: string): number {
  const actual = Number(row.actual_progress ?? 0);
  return actual - expectedProgressAt(row, asOf);
}

export type TaskScope = "all" | "main" | "sub";

export function scopeItems(items: TaskItem[], scope: TaskScope): TaskItem[] {
  if (scope === "all") return items;
  const target = scope === "main" ? "main" : "sub";
  return items.filter((it) => String(it.level ?? "").toLowerCase() === target);
}

export function isCompleted(row: TaskItem): boolean {
  return (Number(row.actual_progress ?? 0) >= 1) || row.auto_judgment === "완료";
}

export function isStarted(row: TaskItem): boolean {
  return !!row.actual_start;
}

export function isPlannedStartedBy(row: TaskItem, asOf: string): boolean {
  const s = parseDate(row.plan_start);
  return s != null && s <= asOfMs(asOf);
}

export function isStartDelayed(row: TaskItem, asOf: string): boolean {
  return isPlannedStartedBy(row, asOf) && !isStarted(row) && !isCompleted(row);
}

export function isCompletionOverdue(row: TaskItem, asOf: string): boolean {
  const e = parseDate(row.plan_end);
  return e != null && e < asOfMs(asOf) && !isCompleted(row);
}

export function isBehindSchedule(row: TaskItem, asOf: string): boolean {
  if (isCompleted(row)) return false;
  return gapAt(row, asOf) < 0;
}

export function isCriticalDelay(
  row: TaskItem,
  asOf: string,
  thresholds: TaskThresholds,
): boolean {
  if (isCompleted(row)) return false;
  const slip = Number(row.slip_days ?? 0);
  if (slip > thresholds.slip_late_days) return true;
  if (gapAt(row, asOf) < thresholds.behind_late_gap) return true;
  return row.auto_judgment === "위험";
}

export function isInDelay(row: TaskItem, asOf: string): boolean {
  if (isCompleted(row)) return false;
  if (row.auto_judgment === "지연" || row.auto_judgment === "위험") return true;
  return isStartDelayed(row, asOf) || isCompletionOverdue(row, asOf) || isBehindSchedule(row, asOf);
}

export function statusOf(row: TaskItem): "completed" | "wip" | "not_started" {
  if (isCompleted(row)) return "completed";
  if (isStarted(row)) return "wip";
  return "not_started";
}

export interface WeightedProgress {
  planned: number; // 0..100
  actual: number; // 0..100
}

export function weightedProgress(rows: TaskItem[], asOf: string): WeightedProgress {
  if (rows.length === 0) return { planned: 0, actual: 0 };
  let sumPlan = 0;
  let sumActual = 0;
  for (const r of rows) {
    sumPlan += expectedProgressAt(r, asOf);
    sumActual += Math.max(0, Math.min(1, Number(r.actual_progress ?? 0)));
  }
  return {
    planned: (sumPlan / rows.length) * 100,
    actual: (sumActual / rows.length) * 100,
  };
}

export interface KpiSummary {
  total: number;
  completed: number;
  wip: number;
  notStarted: number;
  plannedStartedByAsOf: number;
  actuallyStarted: number;
  weighted: WeightedProgress;
  inDelay: number;
  startDelayed: number;
  completionOverdue: number;
  criticalDelay: number;
  behindSchedule: number;
}

export function computeKpi(
  rows: TaskItem[],
  asOf: string,
  thresholds: TaskThresholds,
): KpiSummary {
  let completed = 0;
  let wip = 0;
  let notStarted = 0;
  let plannedStartedByAsOf = 0;
  let actuallyStarted = 0;
  let inDelay = 0;
  let startDelayed = 0;
  let completionOverdue = 0;
  let criticalDelay = 0;
  let behindSchedule = 0;
  for (const r of rows) {
    const s = statusOf(r);
    if (s === "completed") completed++;
    else if (s === "wip") wip++;
    else notStarted++;
    if (isPlannedStartedBy(r, asOf)) plannedStartedByAsOf++;
    if (isStarted(r)) actuallyStarted++;
    if (isInDelay(r, asOf)) inDelay++;
    if (isStartDelayed(r, asOf)) startDelayed++;
    if (isCompletionOverdue(r, asOf)) completionOverdue++;
    if (isCriticalDelay(r, asOf, thresholds)) criticalDelay++;
    if (isBehindSchedule(r, asOf)) behindSchedule++;
  }
  return {
    total: rows.length,
    completed,
    wip,
    notStarted,
    plannedStartedByAsOf,
    actuallyStarted,
    weighted: weightedProgress(rows, asOf),
    inDelay,
    startDelayed,
    completionOverdue,
    criticalDelay,
    behindSchedule,
  };
}

export function pctNum(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

/** Raw Data 딥링크에 사용하는 mode 키 목록 */
export type TmKpiMode =
  | "completed"
  | "wip"
  | "not_started"
  | "planned_started"
  | "actual_started"
  | "in_delay"
  | "start_delayed"
  | "completion_overdue"
  | "critical"
  | "behind";