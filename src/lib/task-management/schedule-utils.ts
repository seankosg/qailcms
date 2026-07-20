// Task Management Progress 스케줄 유틸 — SHAW Defect schedule-utils 를 참고하여
// Task 도메인(Start / Completion 2-stage, actual_progress 연속값)에 맞게 재구성.

import type { TaskThresholds } from "./derived";
import { DEFAULT_THRESHOLDS } from "./derived";

// ───── types ─────
// 3-스테이지 판정: Start / WIP / Finish.
// (기존 "completion" 참조는 "finish" 로 리네임 — TIMELINE 집계에서는 wip 를 제외한다.)
export type TaskScheduleStage = "start" | "wip" | "finish";
export type TaskScheduleStageFilter = "all" | TaskScheduleStage | TaskScheduleStage[];
export type TaskScheduleBucket = "day" | "week";
export type TaskScheduleGroupBy =
  | "discipline"
  | "team"
  | "plot"
  | "hdec_pic_name"
  | "hdec_eng_name"
  | "category"
  | "floor_level";

/** 판정용 3-스테이지 키. */
export const ALL_TASK_STAGE_KEYS: TaskScheduleStage[] = ["start", "wip", "finish"];
/** 타임라인 집계(스케줄 매트릭스/크리티컬)에서 사용하는 날짜 스테이지 키. WIP 는 시점 개념이 없어 제외. */
export const ALL_TASK_TIMELINE_STAGE_KEYS: Array<"start" | "finish"> = ["start", "finish"];

export const ALL_TASK_GROUP_KEYS: TaskScheduleGroupBy[] = [
  "discipline",
  "team",
  "plot",
  "hdec_pic_name",
  "hdec_eng_name",
  "category",
  "floor_level",
];

export type TaskGroupBySpec = TaskScheduleGroupBy | TaskScheduleGroupBy[];

const GROUP_KEY_SEP = " · ";

function toGroupArray(by: TaskGroupBySpec): TaskScheduleGroupBy[] {
  return Array.isArray(by) ? by : [by];
}

export function getPrimaryTaskGroup(by: TaskGroupBySpec): TaskScheduleGroupBy {
  const arr = toGroupArray(by);
  return arr[0] ?? "discipline";
}

export const TASK_STAGE_LABELS: Record<TaskScheduleStage, string> = {
  start: "Start",
  wip: "WIP",
  finish: "Finish",
};

export const TASK_GROUP_LABELS: Record<TaskScheduleGroupBy, string> = {
  discipline: "공종",
  team: "Team",
  plot: "Plot",
  hdec_pic_name: "HDEC PIC",
  hdec_eng_name: "HDEC ENG",
  category: "Category",
  floor_level: "층",
};

/** Raw Data 페이지로 딥링크할 때 사용하는 쿼리 파라미터 이름. */
export const TASK_GROUP_QUERY_PARAM: Record<TaskScheduleGroupBy, string> = {
  discipline: "discipline",
  team: "team",
  plot: "plot",
  hdec_pic_name: "hdec_pic_name",
  hdec_eng_name: "hdec_eng_name",
  category: "category",
  floor_level: "floor_level",
};

export interface TaskItem {
  id: string;
  task_no: string | null;
  task_name: string | null;
  discipline: string | null;
  team: string | null;
  plot: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  category: string | null;
  floor_level: string | null;
  risk: string | null;
  level: string | null;
  status_manual: string | null;
  auto_judgment: string | null;
  plan_start: string | null;
  plan_end: string | null;
  plan_days: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  actual_progress: number | null;
  slip_days: number | null;
  data_date: string | null;
}

export interface BucketCell {
  bucket: string;
  plan: number;
  actual: number;
}

export interface TaskStageRow {
  stage: TaskScheduleStage;
  cells: BucketCell[];
  totalPlan: number;
  totalActual: number;
  totalDone: number;
  total: number;
  cumPlan: number;
  cumActual: number;
}

export interface TaskGroupRow {
  key: string;
  label: string;
  total: number;
  doneCount: number;
  cumPlan: number;
  cumActual: number;
  stages: Record<TaskScheduleStage, TaskStageRow>;
  combined: BucketCell[];
}

export interface TaskCriticalItem {
  id: string;
  taskNo: string;
  taskName: string;
  discipline: string;
  stage: TaskScheduleStage;
  daysLeft: number;
  plannedDate: string;
  status: string | null;
  group: string;
}

export interface TaskLaggingGroup {
  key: string;
  label: string;
  cumPlan: number;
  cumActual: number;
  ratio: number;
  total: number;
}

export interface TaskAggregateResult {
  buckets: string[];
  rows: TaskGroupRow[];
}

// ───── date helpers ─────
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

import { todayInDoha } from "@/lib/time/doha";
export function todayIso(): string {
  return todayInDoha();
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function weekStartIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay() || 7;
  if (dow !== 1) d.setUTCDate(d.getUTCDate() - (dow - 1));
  return toIso(d);
}

export function bucketize(iso: string, granularity: TaskScheduleBucket): string {
  return granularity === "day" ? iso : weekStartIso(iso);
}

export function buildBucketRange(
  startIso: string,
  endIso: string,
  granularity: TaskScheduleBucket,
): string[] {
  const out: string[] = [];
  let cur = granularity === "day" ? startIso : weekStartIso(startIso);
  const end = granularity === "day" ? endIso : weekStartIso(endIso);
  let safety = 0;
  while (cur <= end && safety < 1000) {
    out.push(cur);
    cur = addDays(cur, granularity === "day" ? 1 : 7);
    safety++;
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

function getIsoWeek(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function formatBucketLabel(
  iso: string,
  bucket: TaskScheduleBucket,
): { primary: string; secondary: string } {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  if (bucket === "day") {
    const dow = d.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
    return { primary: `${month} ${day}`, secondary: dow };
  }
  const week = getIsoWeek(d);
  return { primary: `W${week}`, secondary: `${month} ${day}` };
}

// ───── stage accessors ─────
export function getTaskStagePlannedDate(item: TaskItem, stage: TaskScheduleStage): string | null {
  if (stage === "start") return item.plan_start ? item.plan_start.slice(0, 10) : null;
  if (stage === "finish") return item.plan_end ? item.plan_end.slice(0, 10) : null;
  // wip 스테이지는 날짜 시점이 없음
  return null;
}

export function getTaskStageActualDate(item: TaskItem, stage: TaskScheduleStage): string | null {
  if (stage === "start") return item.actual_start ? item.actual_start.slice(0, 10) : null;
  if (stage === "finish") {
    if (item.actual_finish) return item.actual_finish.slice(0, 10);
    const done = Number(item.actual_progress ?? 0) >= 1;
    if (!done) return null;
    return item.plan_end ? item.plan_end.slice(0, 10) : todayIso();
  }
  return null;
}

export function isTaskStageDone(item: TaskItem, stage: TaskScheduleStage): boolean {
  const completed = Number(item.actual_progress ?? 0) >= 1;
  if (stage === "finish") return completed;
  if (stage === "wip") return completed;
  // start
  if (item.actual_start) return true;
  if (completed) return true;
  return false;
}

export function isTaskStagePlannedUpTo(
  item: TaskItem,
  stage: TaskScheduleStage,
  asOfDate: string,
): boolean {
  const planned = getTaskStagePlannedDate(item, stage);
  return !!planned && planned <= asOfDate;
}

export function isTaskStageActualUpTo(
  item: TaskItem,
  stage: TaskScheduleStage,
  asOfDate: string,
): boolean {
  if (!isTaskStageDone(item, stage)) return false;
  const actual = getTaskStageActualDate(item, stage);
  return !!actual && actual <= asOfDate;
}

export function isTaskStagePlannedOn(
  item: TaskItem,
  stage: TaskScheduleStage,
  date: string,
): boolean {
  return getTaskStagePlannedDate(item, stage) === date;
}

export function isTaskStageDelayedAsOf(
  item: TaskItem,
  stage: TaskScheduleStage,
  asOfDate: string,
): boolean {
  return isTaskStagePlannedUpTo(item, stage, asOfDate) && !isTaskStageDone(item, stage);
}

export function getTaskStageKeys(filter: TaskScheduleStageFilter): TaskScheduleStage[] {
  if (filter === "all") return ALL_TASK_STAGE_KEYS;
  if (Array.isArray(filter)) {
    if (filter.length === 0) return ALL_TASK_STAGE_KEYS;
    return ALL_TASK_STAGE_KEYS.filter((k) => filter.includes(k));
  }
  return [filter];
}

// ───── group accessors ─────
const NONE_LABEL = "(None)";

export function getTaskGroupKey(item: TaskItem, by: TaskScheduleGroupBy): string {
  const raw = (item as any)[by];
  const text = raw == null ? "" : String(raw).trim();
  return text ? text : NONE_LABEL;
}

export function getTaskGroupLabel(_by: TaskScheduleGroupBy, key: string): string {
  return key;
}

export function getTaskCompositeGroupKey(item: TaskItem, by: TaskGroupBySpec): string {
  const dims = toGroupArray(by);
  return dims.map((d) => getTaskGroupKey(item, d)).join(GROUP_KEY_SEP);
}

export function getTaskCompositeGroupLabel(by: TaskGroupBySpec, key: string): string {
  const dims = toGroupArray(by);
  if (dims.length === 1) return getTaskGroupLabel(dims[0], key);
  const parts = key.split(GROUP_KEY_SEP);
  return dims.map((d, i) => getTaskGroupLabel(d, parts[i] ?? NONE_LABEL)).join(GROUP_KEY_SEP);
}

export function getTaskGroupHeaderLabel(by: TaskGroupBySpec): string {
  const dims = toGroupArray(by);
  return dims.map((d) => TASK_GROUP_LABELS[d]).join(GROUP_KEY_SEP);
}

// ───── main aggregation ─────
export type TaskPlanMode = "baseline" | "remaining";

export interface TaskAggregateOptions {
  groupBy: TaskGroupBySpec;
  bucket: TaskScheduleBucket;
  stageFilter: TaskScheduleStageFilter;
  rangeStart: string;
  rangeEnd: string;
  asOfDate: string;
  planMode?: TaskPlanMode;
}

export function aggregateTaskSchedule(
  items: TaskItem[],
  opts: TaskAggregateOptions,
): TaskAggregateResult {
  const buckets = buildBucketRange(opts.rangeStart, opts.rangeEnd, opts.bucket);
  const bucketIdx = new Map<string, number>();
  buckets.forEach((b, i) => bucketIdx.set(b, i));
  const planMode: TaskPlanMode = opts.planMode ?? "baseline";

  const groupMap = new Map<string, TaskItem[]>();
  for (const it of items) {
    const k = getTaskCompositeGroupKey(it, opts.groupBy);
    const arr = groupMap.get(k) ?? [];
    arr.push(it);
    groupMap.set(k, arr);
  }

  const stagesToShow = getTaskStageKeys(opts.stageFilter);
  const rows: TaskGroupRow[] = [];

  for (const [key, groupItems] of groupMap) {
    const stageData: Record<TaskScheduleStage, TaskStageRow> = {
      start: emptyStageRow("start", buckets, groupItems.length),
      wip: emptyStageRow("wip", buckets, groupItems.length),
      finish: emptyStageRow("finish", buckets, groupItems.length),
    };

    for (const it of groupItems) {
      // 타임라인 집계는 날짜 시점이 있는 start/finish 만.
      for (const st of ALL_TASK_TIMELINE_STAGE_KEYS) {
        const plan = getTaskStagePlannedDate(it, st);
        const actual = getTaskStageActualDate(it, st);
        const stageDoneAsOf = isTaskStageActualUpTo(it, st, opts.asOfDate);
        const countPlan = !!plan && (planMode === "baseline" || !stageDoneAsOf);
        if (countPlan) {
          const b = bucketize(plan!, opts.bucket);
          const i = bucketIdx.get(b);
          if (i !== undefined) {
            stageData[st].cells[i].plan++;
            stageData[st].totalPlan++;
          }
          if (isTaskStagePlannedUpTo(it, st, opts.asOfDate)) stageData[st].cumPlan++;
        }
        if (actual) {
          const b = bucketize(actual, opts.bucket);
          const i = bucketIdx.get(b);
          if (i !== undefined) {
            stageData[st].cells[i].actual++;
            stageData[st].totalActual++;
          }
          if (stageDoneAsOf) stageData[st].cumActual++;
        }
        if (stageDoneAsOf) stageData[st].totalDone++;
      }
    }

    const combined: BucketCell[] = buckets.map((b) => ({ bucket: b, plan: 0, actual: 0 }));
    for (const st of stagesToShow) {
      if (st === "wip") continue;
      stageData[st].cells.forEach((c, i) => {
        combined[i].plan += c.plan;
        combined[i].actual += c.actual;
      });
    }

    let cumPlan = 0;
    let cumActual = 0;
    let doneCount = 0;
    for (const st of stagesToShow) {
      if (st === "wip") continue;
      cumPlan += stageData[st].cumPlan;
      cumActual += stageData[st].cumActual;
      doneCount += stageData[st].totalDone;
    }

    const timelineCount = stagesToShow.filter((s) => s !== "wip").length;
    const total = groupItems.length * (timelineCount || 1);

    rows.push({
      key,
      label: getTaskCompositeGroupLabel(opts.groupBy, key),
      total,
      doneCount,
      cumPlan,
      cumActual,
      stages: stageData,
      combined,
    });
  }

  rows.sort((a, b) => a.label.localeCompare(b.label));

  return { buckets, rows };
}

function emptyStageRow(stage: TaskScheduleStage, buckets: string[], total: number): TaskStageRow {
  return {
    stage,
    cells: buckets.map((b) => ({ bucket: b, plan: 0, actual: 0 })),
    totalPlan: 0,
    totalActual: 0,
    totalDone: 0,
    total,
    cumPlan: 0,
    cumActual: 0,
  };
}

// ───── critical detection ─────
export function findTaskCritical(
  items: TaskItem[],
  today: string,
  windowDays: number,
  groupBy: TaskScheduleGroupBy,
  _t: TaskThresholds = DEFAULT_THRESHOLDS,
): { highRisk: TaskCriticalItem[]; bottleneck: TaskCriticalItem[] } {
  const horizon = addDays(today, windowDays);
  const highRisk: TaskCriticalItem[] = [];
  const bottleneck: TaskCriticalItem[] = [];

  for (const it of items) {
    const groupLabel = getTaskGroupLabel(groupBy, getTaskGroupKey(it, groupBy));

    for (const stage of ALL_TASK_TIMELINE_STAGE_KEYS) {
      const planned = getTaskStagePlannedDate(it, stage);
      if (!planned || planned > horizon) continue;
      if (isTaskStageDone(it, stage)) continue;

      const risk: TaskCriticalItem = {
        id: it.id,
        taskNo: it.task_no ?? "",
        taskName: it.task_name ?? "",
        discipline: it.discipline ?? "",
        stage,
        daysLeft: daysBetween(today, planned),
        plannedDate: planned,
        status: it.status_manual ?? it.auto_judgment ?? null,
        group: groupLabel,
      };
      highRisk.push(risk);
    }

    // Bottleneck: 완료 예정일이 지났는데 진도율 미완료 && 진도차 큼
    const completionPlanned = getTaskStagePlannedDate(it, "finish");
    if (
      completionPlanned &&
      completionPlanned <= today &&
      !isTaskStageDone(it, "finish")
    ) {
      bottleneck.push({
        id: it.id,
        taskNo: it.task_no ?? "",
        taskName: it.task_name ?? "",
        discipline: it.discipline ?? "",
        stage: "finish",
        daysLeft: daysBetween(today, completionPlanned),
        plannedDate: completionPlanned,
        status: it.auto_judgment ?? null,
        group: getTaskGroupLabel(groupBy, getTaskGroupKey(it, groupBy)),
      });
    }
  }

  highRisk.sort((a, b) => a.daysLeft - b.daysLeft);
  bottleneck.sort((a, b) => a.daysLeft - b.daysLeft);
  return { highRisk: highRisk.slice(0, 30), bottleneck: bottleneck.slice(0, 20) };
}

export function findTaskLaggingGroups(rows: TaskGroupRow[], topN = 5): TaskLaggingGroup[] {
  return rows
    .filter((r) => r.cumPlan > 0)
    .map((r) => ({
      key: r.key,
      label: r.label,
      cumPlan: r.cumPlan,
      cumActual: r.cumActual,
      ratio: r.cumActual / r.cumPlan,
      total: r.total,
    }))
    .filter((r) => r.ratio < 1)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, topN);
}