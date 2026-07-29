// ABD Progress 매트릭스 클라이언트 유틸.
// DB 사전 집계(RPC) 결과를 UI 매트릭스 형태로 조립하는 순수 함수 모음.

export type Stage = "draft_start" | "draft_finish" | "submission" | "dar" | "approval";
export const ALL_STAGES: Stage[] = ["draft_start", "draft_finish", "submission", "dar", "approval"];
export const STAGE_LABELS: Record<Stage, string> = {
  draft_start: "DS",
  draft_finish: "DF",
  submission: "Submission",
  dar: "DAR",
  approval: "AP",
};

/** 매트릭스/툴바 전용 단축 라벨 (DS/DF/SB/RS/AP) */
export const STAGE_SHORT_LABELS: Record<Stage, string> = {
  draft_start: "DS",
  draft_finish: "DF",
  submission: "SB",
  dar: "RS",
  approval: "AP",
};

export type Bucket = "day" | "week";

export type GroupBy =
  | "team"
  | "plot"
  | "dis"
  | "service"
  | "hdec_pic_name"
  | "hdec_eng_name"
  | "doc_ax"
  | "doc_axx"
  | "batch_no";

export const ALL_GROUP_BY: GroupBy[] = [
  "team",
  "plot",
  "dis",
  "service",
  "hdec_pic_name",
  "hdec_eng_name",
  "doc_ax",
  "doc_axx",
  "batch_no",
];

export const GROUP_LABELS: Record<GroupBy, string> = {
  team: "Team",
  plot: "Plot",
  dis: "DIS",
  service: "Service",
  hdec_pic_name: "HDEC PIC",
  hdec_eng_name: "HDEC ENG",
  doc_ax: "AX",
  doc_axx: "AXX",
  batch_no: "Batch",
};

/** Raw Data 검색 파라미터 키 매핑 — 셀 클릭 시 filters JSON 생성에 사용 */
export const GROUP_QUERY_PARAM: Record<GroupBy, string> = {
  team: "team",
  plot: "plot",
  dis: "dis",
  service: "service",
  hdec_pic_name: "hdec_pic_name",
  hdec_eng_name: "hdec_eng_name",
  doc_ax: "doc_ax",
  doc_axx: "doc_axx",
  batch_no: "batch_no",
};

export type PlanMode = "baseline" | "remaining";

export type RoundKey = "R1" | "R2" | "R3" | "all";
export const ALL_ROUNDS: RoundKey[] = ["R1", "R2", "R3", "all"];
export const ROUND_LABELS: Record<RoundKey, string> = {
  R1: "R1",
  R2: "R2",
  R3: "R3",
  all: "All Rounds",
};

// ── 날짜 유틸 ────────────────────────────────────────────────────
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

/** ISO 요일 기준 월요일 주 시작 */
export function weekStartIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay() || 7;
  if (dow !== 1) d.setUTCDate(d.getUTCDate() - (dow - 1));
  return toIso(d);
}

export function bucketize(iso: string, granularity: Bucket): string {
  return granularity === "day" ? iso : weekStartIso(iso);
}

export function buildBucketRange(startIso: string, endIso: string, granularity: Bucket): string[] {
  const out: string[] = [];
  let cur = granularity === "day" ? startIso : weekStartIso(startIso);
  const end = granularity === "day" ? endIso : weekStartIso(endIso);
  let safety = 0;
  while (cur <= end && safety < 2000) {
    out.push(cur);
    cur = addDays(cur, granularity === "day" ? 1 : 7);
    safety++;
  }
  return out;
}

function getIsoWeek(d: Date): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

export function formatBucketLabel(iso: string, bucket: Bucket): { primary: string; secondary: string } {
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

// ── 매트릭스 조립 ─────────────────────────────────────────────────
const GROUP_SEP = " · ";
const NONE_LABEL = "(None)";

export type CellRaw = {
  group_key: string[];
  bucket_iso: string | null;
  stage: Stage;
  plan_cnt: number;
  actual_cnt: number;
};

export type TotalRaw = {
  group_key: string[];
  stage: Stage;
  total: number;
  done_upto: number;
  plan_upto: number;
  actual_upto: number;
};

export interface BucketCell {
  bucket: string;
  plan: number;
  actual: number;
}

export interface StageRow {
  stage: Stage;
  cells: BucketCell[];
  total: number;
  totalDone: number;
  cumPlan: number;
  cumActual: number;
}

export interface GroupRow {
  key: string;
  label: string;
  total: number;
  doneCount: number;
  cumPlan: number;
  cumActual: number;
  stages: Record<Stage, StageRow>;
  combined: BucketCell[];
  groupKeyRaw: string[];
}

export interface MatrixResult {
  buckets: string[];
  rows: GroupRow[];
}

function keyOf(arr: string[]): string {
  return arr.map((v) => (v && v.trim() ? v : NONE_LABEL)).join(GROUP_SEP);
}

function labelOf(arr: string[]): string {
  return arr.map((v) => (v && v.trim() ? v : NONE_LABEL)).join(GROUP_SEP);
}

function emptyStageRow(buckets: string[], stage: Stage, total: number): StageRow {
  return {
    stage,
    cells: buckets.map((b) => ({ bucket: b, plan: 0, actual: 0 })),
    total,
    totalDone: 0,
    cumPlan: 0,
    cumActual: 0,
  };
}

export function assembleMatrix(opts: {
  cells: CellRaw[];
  totals: TotalRaw[];
  buckets: string[];
  stagesToShow: Stage[];
}): MatrixResult {
  const { cells, totals, buckets, stagesToShow } = opts;
  const bucketIdx = new Map<string, number>();
  buckets.forEach((b, i) => bucketIdx.set(b, i));

  const rowMap = new Map<string, GroupRow>();

  const ensureRow = (groupKeyRaw: string[]): GroupRow => {
    const key = keyOf(groupKeyRaw);
    let row = rowMap.get(key);
    if (!row) {
      row = {
        key,
        label: labelOf(groupKeyRaw),
        total: 0,
        doneCount: 0,
        cumPlan: 0,
        cumActual: 0,
        stages: {
          draft_start: emptyStageRow(buckets, "draft_start", 0),
          draft_finish: emptyStageRow(buckets, "draft_finish", 0),
          submission: emptyStageRow(buckets, "submission", 0),
          dar: emptyStageRow(buckets, "dar", 0),
          approval: emptyStageRow(buckets, "approval", 0),
        },
        combined: buckets.map((b) => ({ bucket: b, plan: 0, actual: 0 })),
        groupKeyRaw: [...groupKeyRaw],
      };
      rowMap.set(key, row);
    }
    return row;
  };

  for (const t of totals) {
    const row = ensureRow(t.group_key ?? []);
    const sr = row.stages[t.stage];
    if (!sr) continue;
    sr.total = t.total;
    sr.totalDone = t.done_upto;
    sr.cumPlan = t.plan_upto;
    sr.cumActual = t.actual_upto;
  }

  for (const c of cells) {
    if (!c.bucket_iso) continue;
    const row = ensureRow(c.group_key ?? []);
    const i = bucketIdx.get(c.bucket_iso);
    if (i === undefined) continue;
    const sr = row.stages[c.stage];
    if (!sr) continue;
    sr.cells[i].plan += c.plan_cnt;
    sr.cells[i].actual += c.actual_cnt;
  }

  for (const row of rowMap.values()) {
    let combTotal = 0;
    let combDone = 0;
    let combCumPlan = 0;
    let combCumActual = 0;
    for (let i = 0; i < buckets.length; i++) {
      row.combined[i].plan = 0;
      row.combined[i].actual = 0;
    }
    for (const st of stagesToShow) {
      const sr = row.stages[st];
      combTotal += sr.total;
      combDone += sr.totalDone;
      combCumPlan += sr.cumPlan;
      combCumActual += sr.cumActual;
      for (let i = 0; i < buckets.length; i++) {
        row.combined[i].plan += sr.cells[i].plan;
        row.combined[i].actual += sr.cells[i].actual;
      }
    }
    row.total = combTotal;
    row.doneCount = combDone;
    row.cumPlan = combCumPlan;
    row.cumActual = combCumActual;
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  return { buckets, rows };
}

// ── URL 파라미터 도우미 ─────────────────────────────────────────────
/** 그룹 키 배열 → Raw Data 검색 필터 객체 (filters JSON용) */
export function groupKeyToRawParams(groupBy: GroupBy[], groupKeyRaw: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  groupBy.forEach((dim, i) => {
    const v = groupKeyRaw[i];
    if (v === undefined) return;
    const paramKey = GROUP_QUERY_PARAM[dim];
    out[paramKey] = v === NONE_LABEL ? "__EMPTY__" : v;
  });
  return out;
}

/** 스테이지 → dateField 매핑. round='all'이면 기본 R1 컬럼 사용 */
export function stageDateField(stage: Stage | "all", field: "planned" | "actual", round: RoundKey = "R1"): string {
  // AP(Approval)는 문서 단위 이벤트 — 라운드 컬럼이 아니라 approval_date 단일 경로.
  if (stage === "approval") return "approval_date";
  const rn = round === "all" ? "r1" : round.toLowerCase();
  if (stage === "all") {
    return `${rn}_dar_${field === "planned" ? "plan" : "actual"}`;
  }
  const map: Record<Stage, { planned: string; actual: string }> = {
    draft_start:  { planned: "draft_start_plan",  actual: "draft_start_actual" },
    draft_finish: { planned: "draft_finish_plan", actual: "draft_finish_actual" },
    submission: { planned: "submission_plan", actual: "submission_actual" },
    dar: { planned: "dar_plan", actual: "dar_actual" },
    approval: { planned: "dar_plan", actual: "dar_actual" },
  };
  return `${rn}_${map[stage][field]}`;
}
