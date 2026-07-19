import {
  ALL_TASK_STAGE_KEYS,
  addDays,
  daysBetween,
  getTaskStagePlannedDate,
  isTaskStageActualUpTo,
  isTaskStageDelayedAsOf,
  isTaskStageDone,
  isTaskStagePlannedUpTo,
  weekStartIso,
  type TaskItem,
  type TaskScheduleStage,
} from "./schedule-utils";

export type OwnerDim = "team" | "hdec_pic_name" | "hdec_eng_name";

export interface DelayTopItem {
  id: string;
  taskNo: string;
  taskName: string;
  discipline: string;
  team: string;
  hdecPic: string;
  hdecEng: string;
  stage: TaskScheduleStage;
  plannedDate: string;
  daysLate: number;
  judgment: string | null;
  actualProgress: number;
}

export function computeDelayTopN(
  items: TaskItem[],
  asOfDate: string,
  limit = 20,
): DelayTopItem[] {
  const out: DelayTopItem[] = [];
  for (const it of items) {
    for (const st of ALL_TASK_STAGE_KEYS) {
      if (!isTaskStageDelayedAsOf(it, st, asOfDate)) continue;
      const planned = getTaskStagePlannedDate(it, st)!;
      out.push({
        id: it.id,
        taskNo: it.task_no ?? "",
        taskName: it.task_name ?? "",
        discipline: it.discipline ?? "",
        team: it.team ?? "",
        hdecPic: it.hdec_pic_name ?? "",
        hdecEng: it.hdec_eng_name ?? "",
        stage: st,
        plannedDate: planned,
        daysLate: daysBetween(planned, asOfDate),
        judgment: it.auto_judgment ?? it.status_manual ?? null,
        actualProgress: Number(it.actual_progress ?? 0),
      });
    }
  }
  out.sort((a, b) => b.daysLate - a.daysLate);
  return out.slice(0, limit);
}

export interface OwnerLeaderboardRow {
  key: string;
  totalStages: number;
  doneStages: number;
  delayedStages: number;
  plannedStages: number; // 계획상 asOf 시점까지 도달해야 할 스테이지 수
  planPct: number; // plannedStages / totalStages
  actualPct: number; // doneStages / totalStages
  diffPp: number; // (actualPct - planPct) * 100
  taskCount: number;
  delayedTaskIds: Set<string>;
}

export function computeOwnerLeaderboard(
  items: TaskItem[],
  asOfDate: string,
  dim: OwnerDim,
): OwnerLeaderboardRow[] {
  const map = new Map<string, OwnerLeaderboardRow>();
  const NONE = "(미지정)";
  for (const it of items) {
    const raw = (it as any)[dim];
    const key = raw ? String(raw).trim() || NONE : NONE;
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        totalStages: 0,
        doneStages: 0,
        delayedStages: 0,
        plannedStages: 0,
        planPct: 0,
        actualPct: 0,
        diffPp: 0,
        taskCount: 0,
        delayedTaskIds: new Set<string>(),
      };
      map.set(key, row);
    }
    row.taskCount++;
    let delayed = false;
    for (const st of ALL_TASK_STAGE_KEYS) {
      row.totalStages++;
      if (isTaskStagePlannedUpTo(it, st, asOfDate)) row.plannedStages++;
      if (isTaskStageActualUpTo(it, st, asOfDate)) row.doneStages++;
      if (isTaskStageDelayedAsOf(it, st, asOfDate)) {
        row.delayedStages++;
        delayed = true;
      }
    }
    if (delayed) row.delayedTaskIds.add(it.id);
  }
  const rows = Array.from(map.values());
  for (const r of rows) {
    r.planPct = r.totalStages > 0 ? (r.plannedStages / r.totalStages) * 100 : 0;
    r.actualPct = r.totalStages > 0 ? (r.doneStages / r.totalStages) * 100 : 0;
    r.diffPp = r.actualPct - r.planPct;
  }
  rows.sort((a, b) => a.diffPp - b.diffPp); // 가장 뒤처진 담당자 상단
  return rows;
}

export interface WeeklyDelayPoint {
  weekStart: string;
  newDelays: number;
  recovered: number;
  net: number;
  openDelays: number;
}

/**
 * 주별 신규 지연 vs 회복 트렌드.
 * - 각 주말(주 시작+6일)을 asOf로 보고 스테이지별 지연 상태 스냅샷.
 * - 이전 주에는 지연이 아니었다가 이번 주에 지연 → newDelays.
 * - 이전 주에는 지연이었다가 이번 주에 완료 → recovered.
 * - 이번 주에 여전히 지연 상태 → openDelays.
 */
export function computeWeeklyDelayTrend(
  items: TaskItem[],
  today: string,
  weeks = 12,
): WeeklyDelayPoint[] {
  const thisWeek = weekStartIso(today);
  const points: WeeklyDelayPoint[] = [];
  const stateBefore = new Map<string, boolean>(); // key = id::stage, value: was delayed prev week
  const stateBeforeDone = new Map<string, boolean>();
  const startWeek = addDays(thisWeek, -7 * (weeks - 1));
  let cursor = startWeek;
  for (let w = 0; w < weeks; w++) {
    const asOf = addDays(cursor, 6);
    let newDelays = 0;
    let recovered = 0;
    let open = 0;
    for (const it of items) {
      for (const st of ALL_TASK_STAGE_KEYS) {
        const key = it.id + "::" + st;
        const delayed = isTaskStageDelayedAsOf(it, st, asOf);
        const done = isTaskStageActualUpTo(it, st, asOf);
        const prevDelayed = stateBefore.get(key) ?? false;
        const prevDone = stateBeforeDone.get(key) ?? false;
        if (delayed && !prevDelayed) newDelays++;
        if (!prevDone && done && prevDelayed) recovered++;
        if (delayed) open++;
        stateBefore.set(key, delayed);
        stateBeforeDone.set(key, done);
      }
    }
    points.push({
      weekStart: cursor,
      newDelays,
      recovered,
      net: newDelays - recovered,
      openDelays: open,
    });
    cursor = addDays(cursor, 7);
  }
  return points;
}

export interface JudgmentStageBreakdown {
  judgmentCounts: Record<string, number>;
  stageJudgment: Array<{
    stage: TaskScheduleStage;
    counts: Record<string, number>;
    total: number;
  }>;
}

const JUDGMENT_KEYS = ["완료", "정상", "주의", "지연", "위험"] as const;

export function computeJudgmentStageBreakdown(
  items: TaskItem[],
  asOfDate: string,
): JudgmentStageBreakdown {
  const judgmentCounts: Record<string, number> = {
    완료: 0,
    정상: 0,
    주의: 0,
    지연: 0,
    위험: 0,
  };
  for (const it of items) {
    const j = String(it.auto_judgment ?? "").trim();
    if (j in judgmentCounts) judgmentCounts[j]++;
  }
  const stageJudgment = ALL_TASK_STAGE_KEYS.map((stage) => {
    const counts: Record<string, number> = {
      완료: 0,
      정상: 0,
      주의: 0,
      지연: 0,
      위험: 0,
    };
    let total = 0;
    for (const it of items) {
      const planned = isTaskStagePlannedUpTo(it, stage, asOfDate);
      const done = isTaskStageDone(it, stage);
      const delayed = isTaskStageDelayedAsOf(it, stage, asOfDate);
      if (done) counts["완료"]++;
      else if (delayed) {
        // Stage-level delay severity — use auto_judgment for row-level 위험/지연 색
        const j = String(it.auto_judgment ?? "").trim();
        if (j === "위험") counts["위험"]++;
        else counts["지연"]++;
      } else if (planned) counts["주의"]++;
      else counts["정상"]++;
      total++;
    }
    return { stage, counts, total };
  });
  return { judgmentCounts, stageJudgment };
}

export const JUDGMENT_KEY_ORDER = JUDGMENT_KEYS;