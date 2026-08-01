// SM Progress S-Curve 시리즈 빌더.
// 기존 getSnagProgressCells RPC 결과(스테이지×버킷 plan/actual 카운트)를
// 그대로 이용해 스테이지별 누적/일일 시리즈를 만든다.
//
// planMode(baseline/remaining) 처리는 RPC 측에서 이미 반영되어 있어
// 여기서는 카운트를 단순 집계만 하면 된다.

import type { CellRaw, Stage } from "./progress-utils";

export interface SCurveStageSeries {
  stage: Stage;
  dailyPlan: number[];
  dailyActual: (number | null)[];
  cumPlan: number[];
  cumActual: (number | null)[];
}

export interface SCurveResult {
  buckets: string[];
  bucketLabels: string[];
  todayIndex: number;
  series: Record<Stage, SCurveStageSeries>;
}

function labelDdMmm(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()}-${month}`;
}

function emptyStage(stage: Stage, n: number): SCurveStageSeries {
  return {
    stage,
    dailyPlan: new Array(n).fill(0),
    dailyActual: new Array(n).fill(0),
    cumPlan: new Array(n).fill(0),
    cumActual: new Array(n).fill(0),
  };
}

export function buildSnagSCurve(opts: {
  cells: CellRaw[];
  buckets: string[];
  stages: Stage[];
  today: string;
}): SCurveResult {
  const { cells, buckets, stages, today } = opts;
  const n = buckets.length;
  const idx = new Map<string, number>();
  buckets.forEach((b, i) => idx.set(b, i));

  const series: Record<Stage, SCurveStageSeries> = {
    start: emptyStage("start", n),
    rectified: emptyStage("rectified", n),
    closure: emptyStage("closure", n),
  };

  for (const c of cells) {
    if (!c.bucket_iso) continue;
    const i = idx.get(c.bucket_iso);
    if (i === undefined) continue;
    // 서버 집계행 토큰(`all|...`)은 S-커브에서 사용하지 않는다(스테이지별 계열만 누적).
    const s = series[c.stage as Stage];
    if (!s) continue;
    s.dailyPlan[i] += c.plan_cnt;
    s.dailyActual[i] = (s.dailyActual[i] as number) + c.actual_cnt;
  }

  // todayIndex: 첫 bucket >= today
  let todayIndex = -1;
  for (let i = 0; i < n; i++) {
    if (buckets[i] >= today) { todayIndex = i; break; }
  }

  // 누적 계산 + 미래 actual null 처리 (선택된 stages만 계산)
  for (const st of stages) {
    const s = series[st];
    let cP = 0;
    let cA = 0;
    for (let i = 0; i < n; i++) {
      cP += s.dailyPlan[i];
      s.cumPlan[i] = cP;
      const isFuture = todayIndex >= 0 && i > todayIndex;
      if (isFuture) {
        s.dailyActual[i] = null;
        s.cumActual[i] = null;
      } else {
        cA += (s.dailyActual[i] as number) ?? 0;
        s.cumActual[i] = cA;
      }
    }
  }

  return {
    buckets,
    bucketLabels: buckets.map(labelDdMmm),
    todayIndex,
    series,
  };
}

export const SNAG_STAGE_COLORS: Record<Stage, { line: string; bar: string }> = {
  start: { line: "hsl(217, 91%, 60%)", bar: "hsla(217, 91%, 60%, 0.45)" },
  rectified: { line: "hsl(38, 92%, 50%)", bar: "hsla(38, 92%, 50%, 0.45)" },
  closure: { line: "hsl(160, 60%, 45%)", bar: "hsla(160, 60%, 45%, 0.45)" },
};