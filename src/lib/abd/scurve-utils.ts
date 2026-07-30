// ABD Progress S-Curve 시리즈 빌더 (단일 세트).
// 라운드별 3세트 구성은 폐지되었다 — Progress 페이지는 항상 전 라운드 통합(컬럼 UNION)
// 집계를 사용하므로 스테이지별 단일 곡선만 생성한다.

import type { CellRaw, Stage } from "./progress-utils";

export type SCurveBaselines = Partial<Record<Stage, { plan: number; actual: number }>>;

/** 서버 정본 누적(기간 내 문서 distinct). stage → 버킷 정렬 배열 */
export type SCurveCum = Partial<Record<Stage, { plan: number[]; actual: number[] }>>;

export interface SCurveStageSeries {
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
  series: SCurveStageSeries[];
}

function labelDdMmm(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()}-${month}`;
}

export function buildAbdSCurve(opts: {
  cells: CellRaw[];
  buckets: string[];
  stages: Stage[];
  today: string;
  /** stage 별 range 시작 직전(rangeStart-1) 시점의 누계 오프셋 */
  baselines?: SCurveBaselines;
  /**
   * 서버 정본 누적(abd_progress_cum_json). 주어지면 누적 곡선은 이 값을 사용하고
   * 일별 증분은 누적 차분으로 산출한다(= 문서 distinct 기준, 종점 = 행 totals).
   */
  cum?: SCurveCum;
}): AbdSCurveResult {
  const { cells, buckets, stages, today, baselines, cum } = opts;
  const n = buckets.length;
  const idx = new Map<string, number>();
  buckets.forEach((b, i) => idx.set(b, i));

  let todayIndex = -1;
  for (let i = 0; i < n; i++) {
    if (buckets[i] >= today) { todayIndex = i; break; }
  }

  const daily = new Map<Stage, { p: number[]; a: number[] }>();
  for (const st of stages) {
    daily.set(st, { p: new Array(n).fill(0), a: new Array(n).fill(0) });
  }
  for (const c of cells) {
    if (!c.bucket_iso) continue;
    const i = idx.get(c.bucket_iso);
    if (i === undefined) continue;
    const d = daily.get(c.stage);
    if (!d) continue;
    d.p[i] += c.plan_cnt;
    d.a[i] += c.actual_cnt;
  }

  const series: SCurveStageSeries[] = [];
  for (const st of stages) {
    const d = daily.get(st)!;
    const serverCum = cum?.[st];
    if (serverCum && serverCum.plan.length === n) {
      const cumPlan = serverCum.plan.slice();
      const cumActualRaw = serverCum.actual.slice();
      const basePlan = baselines?.[st]?.plan ?? 0;
      const baseActual = baselines?.[st]?.actual ?? 0;
      const dailyPlan: number[] = new Array(n).fill(0);
      const dailyActual: (number | null)[] = new Array(n).fill(0);
      const cumActual: (number | null)[] = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        dailyPlan[i] = cumPlan[i] - (i === 0 ? basePlan : cumPlan[i - 1]);
        const isFuture = todayIndex >= 0 && i > todayIndex;
        if (isFuture) {
          dailyActual[i] = null;
          cumActual[i] = null;
        } else {
          dailyActual[i] = cumActualRaw[i] - (i === 0 ? baseActual : cumActualRaw[i - 1]);
          cumActual[i] = cumActualRaw[i];
        }
      }
      series.push({ stage: st, dailyPlan, dailyActual, cumPlan, cumActual });
      continue;
    }
    const dailyPlan = d.p.slice();
    const dailyActual: (number | null)[] = d.a.slice();
    const cumPlan: number[] = new Array(n).fill(0);
    const cumActual: (number | null)[] = new Array(n).fill(0);
    let cP = baselines?.[st]?.plan ?? 0;
    let cA = baselines?.[st]?.actual ?? 0;
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
    series.push({ stage: st, dailyPlan, dailyActual, cumPlan, cumActual });
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
  approval:     { line: "hsl(142, 71%, 36%)", bar: "hsla(142, 71%, 36%, 0.45)" },
};

/** 계획 곡선 대시 패턴 (단일 세트) */
export const PLAN_DASH = "5 3";
