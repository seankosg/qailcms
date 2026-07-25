// ABD Progress S-Curve 시리즈 빌더.
// round==='all' 인 경우 R1/R2/R3 각각의 cells 배열을 받아 라운드별 시리즈를 생성.
// 단일 라운드일 때는 rounds.length===1.

import type { CellRaw, Stage, RoundKey } from "./progress-utils";

export interface SCurveRoundStageSeries {
  round: Exclude<RoundKey, "all">;
  stage: Stage;
  dailyPlan: number[];
  dailyActual: (number | null)[];
  cumPlan: number[];
  cumActual: (number | null)[];
}

export interface AbdSCurveResult {
  buckets: string[];
  bucketLabels: string[];
  todayIndex: number;
  /** (round, stage) → series */
  series: SCurveRoundStageSeries[];
}

function labelDdMmm(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()}-${month}`;
}

export function buildAbdSCurve(opts: {
  cellsByRound: Partial<Record<Exclude<RoundKey, "all">, CellRaw[]>>;
  buckets: string[];
  stages: Stage[];
  today: string;
}): AbdSCurveResult {
  const { cellsByRound, buckets, stages, today } = opts;
  const n = buckets.length;
  const idx = new Map<string, number>();
  buckets.forEach((b, i) => idx.set(b, i));

  let todayIndex = -1;
  for (let i = 0; i < n; i++) {
    if (buckets[i] >= today) { todayIndex = i; break; }
  }

  const series: SCurveRoundStageSeries[] = [];
  const rounds: Array<Exclude<RoundKey, "all">> = ["R1", "R2", "R3"];
  for (const r of rounds) {
    const cells = cellsByRound[r];
    if (!cells) continue;
    // 스테이지별 일일 카운트 집계
    const daily: Record<Stage, { p: number[]; a: number[] }> = {
      draft_start:  { p: new Array(n).fill(0), a: new Array(n).fill(0) },
      draft_finish: { p: new Array(n).fill(0), a: new Array(n).fill(0) },
      submission:   { p: new Array(n).fill(0), a: new Array(n).fill(0) },
      dar:          { p: new Array(n).fill(0), a: new Array(n).fill(0) },
    };
    for (const c of cells) {
      if (!c.bucket_iso) continue;
      const i = idx.get(c.bucket_iso);
      if (i === undefined) continue;
      const d = daily[c.stage];
      if (!d) continue;
      d.p[i] += c.plan_cnt;
      d.a[i] += c.actual_cnt;
    }
    for (const st of stages) {
      const d = daily[st];
      const dailyPlan = d.p.slice();
      const dailyActual: (number | null)[] = d.a.slice();
      const cumPlan: number[] = new Array(n).fill(0);
      const cumActual: (number | null)[] = new Array(n).fill(0);
      let cP = 0;
      let cA = 0;
      for (let i = 0; i < n; i++) {
        cP += dailyPlan[i];
        cumPlan[i] = cP;
        const isFuture = todayIndex >= 0 && i > todayIndex;
        if (isFuture) {
          dailyActual[i] = null;
          cumActual[i] = null;
        } else {
          cA += (dailyActual[i] as number) ?? 0;
          cumActual[i] = cA;
        }
      }
      series.push({ round: r, stage: st, dailyPlan, dailyActual, cumPlan, cumActual });
    }
  }

  return {
    buckets,
    bucketLabels: buckets.map(labelDdMmm),
    todayIndex,
    series,
  };
}

export const ABD_STAGE_COLORS: Record<Stage, { line: string; bar: string }> = {
  draft_start:  { line: "hsl(217, 91%, 60%)", bar: "hsla(217, 91%, 60%, 0.45)" },
  draft_finish: { line: "hsl(262, 83%, 58%)", bar: "hsla(262, 83%, 58%, 0.45)" },
  submission:   { line: "hsl(38, 92%, 50%)",  bar: "hsla(38, 92%, 50%, 0.45)" },
  dar:          { line: "hsl(160, 60%, 45%)", bar: "hsla(160, 60%, 45%, 0.45)" },
};

/** 라운드별 대시 패턴 (색상은 stage로 결정) */
export const ROUND_DASH: Record<Exclude<RoundKey, "all">, string | undefined> = {
  R1: undefined,      // solid
  R2: "6 3",          // long dash
  R3: "2 3",          // dotted
};

export const ROUND_PLAN_DASH: Record<Exclude<RoundKey, "all">, string> = {
  R1: "5 3",
  R2: "8 3 2 3",
  R3: "3 2",
};