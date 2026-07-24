// TM Dashboard KPI 계산 유틸 — SHAW PunchDashboard 산식을 TM 컬럼에 매핑
import type { TaskItem } from "./schedule-utils";
import type { TaskThresholds } from "./derived";
import { cumPlanProgress, cumActualProgress, isTaskDelayed, computeJudgment, computeVariance } from "./derived";

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

/** asOfDate 기준 누계 계획 진도율 (Cum. Plan, 0..1) — plan_progress 우선, NULL 시 computeTPlan 폴백. */
export function expectedProgressAt(row: TaskItem, asOf: string): number {
  return cumPlanProgress(row, asOf);
}

/** Cum. Diff = Actual% − Cum. Plan%. Variance/Alarm/KPI 판정과 동일 소스. */
export function gapAt(row: TaskItem, asOf: string): number {
  return computeVariance(row, asOf) ?? (cumActualProgress(row) - cumPlanProgress(row, asOf));
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
  return computeJudgment(row, thresholds, asOf) === "위험";
}

export function isInDelay(row: TaskItem, asOf: string): boolean {
  if (isCompleted(row)) return false;
  return isTaskDelayed(row, undefined, asOf);
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
    sumPlan += cumPlanProgress(r, asOf);
    sumActual += cumActualProgress(r);
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
    // In Delay 우산 상위 KPI. 아래 4개 카드는 In Delay ∩ <원자 조건> 으로 종속.
    const inDelayFlag = isInDelay(r, asOf);
    if (inDelayFlag) inDelay++;
    if (inDelayFlag && isStartDelayed(r, asOf)) startDelayed++;
    if (inDelayFlag && isCompletionOverdue(r, asOf)) completionOverdue++;
    if (isCriticalDelay(r, asOf, thresholds)) criticalDelay++; // Critical ⊂ In Delay by 정의
    if (inDelayFlag && isBehindSchedule(r, asOf)) behindSchedule++;
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

/** 팀별 breakdown 계산 결과 항목 */
export interface KpiTeamBreakdownEntry {
  team: string;
  isNull: boolean;
  count: number;
}

export interface KpiTeamBreakdown {
  inDelay: KpiTeamBreakdownEntry[];
  startDelayed: KpiTeamBreakdownEntry[];
  completionOverdue: KpiTeamBreakdownEntry[];
  criticalDelay: KpiTeamBreakdownEntry[];
  behindSchedule: KpiTeamBreakdownEntry[];
}

function teamKey(row: TaskItem): { key: string; isNull: boolean } {
  const raw = String((row as any).team ?? "").trim();
  if (!raw) return { key: "미지정", isNull: true };
  return { key: raw, isNull: false };
}

function bumpTeam(
  map: Map<string, KpiTeamBreakdownEntry>,
  row: TaskItem,
): void {
  const { key, isNull } = teamKey(row);
  const cur = map.get(key);
  if (cur) cur.count += 1;
  else map.set(key, { team: key, isNull, count: 1 });
}

function sortEntries(map: Map<string, KpiTeamBreakdownEntry>): KpiTeamBreakdownEntry[] {
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.team.localeCompare(b.team);
  });
}

export function computeKpiBreakdownByTeam(
  rows: TaskItem[],
  asOf: string,
  thresholds: TaskThresholds,
): KpiTeamBreakdown {
  const inDelay = new Map<string, KpiTeamBreakdownEntry>();
  const startDelayed = new Map<string, KpiTeamBreakdownEntry>();
  const completionOverdue = new Map<string, KpiTeamBreakdownEntry>();
  const criticalDelay = new Map<string, KpiTeamBreakdownEntry>();
  const behindSchedule = new Map<string, KpiTeamBreakdownEntry>();
  for (const r of rows) {
    const inDelayFlag = isInDelay(r, asOf);
    if (inDelayFlag) bumpTeam(inDelay, r);
    if (inDelayFlag && isStartDelayed(r, asOf)) bumpTeam(startDelayed, r);
    if (inDelayFlag && isCompletionOverdue(r, asOf)) bumpTeam(completionOverdue, r);
    if (isCriticalDelay(r, asOf, thresholds)) bumpTeam(criticalDelay, r);
    if (inDelayFlag && isBehindSchedule(r, asOf)) bumpTeam(behindSchedule, r);
  }
  return {
    inDelay: sortEntries(inDelay),
    startDelayed: sortEntries(startDelayed),
    completionOverdue: sortEntries(completionOverdue),
    criticalDelay: sortEntries(criticalDelay),
    behindSchedule: sortEntries(behindSchedule),
  };
}