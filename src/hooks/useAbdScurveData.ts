import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { AbdTeam } from "@/lib/abd/columns";
import {
  addDays,
  buildBucketRange,
  todayIso,
  weekStartIso,
  ALL_STAGES,
  STAGE_LABELS,
  type Bucket,
  type GroupBy,
  type PlanMode,
  type Stage,
} from "@/lib/abd/progress-utils";
import {
  getAbdProgressCells,
  getAbdProgressCum,
  getAbdProgressTotals,
} from "@/lib/abd/progress.functions";
import type { SCurveBaselines, SCurveCum } from "@/lib/abd/scurve-utils";

/**
 * ABD S-Curve · KPI 정본 데이터.
 * AbdProgressPage 의 cells/totals/baseline/cum 질의를 그대로 옮긴 것이다(계산식 변경 없음).
 * Progress 화면과 프로젝트 대시보드가 같은 훅을 쓴다.
 */
export interface AbdScurveParams {
  plot: "all" | "C" | "D";
  teams: AbdTeam[];
  groupBy: GroupBy[];
  bucket: Bucket;
  planMode: PlanMode;
  asOfDate: string;
  rangeDays: number;
  /** S-Curve 전용 질의(baseline·cum) 활성화 여부 */
  scurveEnabled: boolean;
  /** 차트에 표시할 스테이지(필터 요약용). 비어 있으면 전체 */
  stages?: Stage[];
  /** 차트 시작일(ISO). 없으면 오늘 −14일(기존 동작) */
  startDate?: string | null;
}

export function useAbdScurveData(params: AbdScurveParams) {
  const { plot, teams, groupBy, bucket, planMode, asOfDate, rangeDays, scurveEnabled, startDate } = params;

  // Round 필터 제거 — 항상 전 라운드(컬럼 UNION) 집계.
  const round = "all" as const;
  const today = todayIso();

  const rangeStart = useMemo(() => startDate ?? addDays(today, -14), [today, startDate]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);
  const rpcStart = bucket === "week" ? weekStartIso(rangeStart) : rangeStart;
  const rpcEnd = rangeEnd;
  const baselineAsOf = useMemo(() => addDays(rpcStart, -1), [rpcStart]);

  const cellsFn = useServerFn(getAbdProgressCells);
  const totalsFn = useServerFn(getAbdProgressTotals);
  const cumFn = useServerFn(getAbdProgressCum);

  const teamsKey = [...teams].sort().join(",");
  const groupKey = groupBy.join(",");
  const roundKey = round;
  const plots = plot === "all" ? [] : [plot];

  const cellsQ = useQuery({
    queryKey: [
      "abd-progress-cells",
      plot,
      teamsKey,
      roundKey,
      groupKey,
      bucket,
      rpcStart,
      rpcEnd,
      asOfDate,
      planMode,
    ],
    queryFn: () =>
      cellsFn({
        data: {
          plots,
          teams,
          groupBy,
          bucket,
          rangeStart: rpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
          round,
        },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const totalsQ = useQuery({
    queryKey: ["abd-progress-totals", plot, teamsKey, roundKey, groupKey, asOfDate, planMode],
    queryFn: () =>
      totalsFn({
        data: { plots, teams, groupBy, asOfDate, planMode, round },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const buckets = useMemo(() => buildBucketRange(rpcStart, rpcEnd, bucket), [rpcStart, rpcEnd, bucket]);

  // S-Curve: 메인 cellsQ(전 라운드 통합) 재사용 + baseline totals 1회.
  const baselineQ = useQuery({
    queryKey: ["abd-progress-totals-baseline", plot, teamsKey, groupKey, baselineAsOf, planMode],
    queryFn: () =>
      totalsFn({
        data: { plots, teams, groupBy, asOfDate: baselineAsOf, planMode, round },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    enabled: scurveEnabled,
  });

  const baselines: SCurveBaselines = useMemo(() => {
    const out: SCurveBaselines = {};
    for (const row of (baselineQ.data ?? []) as Array<{
      stage: Stage; plan_upto: number; actual_upto: number;
    }>) {
      const prev = out[row.stage] ?? { plan: 0, actual: 0 };
      out[row.stage] = {
        plan: prev.plan + (Number(row.plan_upto) || 0),
        actual: prev.actual + (Number(row.actual_upto) || 0),
      };
    }
    return out;
  }, [baselineQ.data]);

  // S-커브 누적 정본: 기간 내 문서 distinct(서버). 종점 = 행 totals.
  const cumQ = useQuery({
    queryKey: ["abd-progress-cum", plot, teamsKey, roundKey, bucket, rpcStart, rpcEnd, asOfDate, planMode],
    queryFn: () =>
      cumFn({
        data: {
          plots,
          teams,
          bucket,
          rangeStart: rpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
          round,
        },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    enabled: scurveEnabled,
  });

  const cum: SCurveCum = useMemo(() => {
    const rows = (cumQ.data ?? []) as Array<{
      bucket_iso: string; stage: Stage; cum_plan: number; cum_actual: number;
    }>;
    if (rows.length === 0) return {};
    const idx = new Map<string, number>();
    buckets.forEach((b, i) => idx.set(b, i));
    const out: SCurveCum = {};
    for (const r of rows) {
      const i = idx.get(r.bucket_iso);
      if (i === undefined) continue;
      let slot = out[r.stage];
      if (!slot) {
        slot = { plan: new Array(buckets.length).fill(0), actual: new Array(buckets.length).fill(0) };
        out[r.stage] = slot;
      }
      slot.plan[i] = r.cum_plan;
      slot.actual[i] = r.cum_actual;
    }
    return out;
  }, [cumQ.data, buckets]);

  // 스테이지별 문서 모수(분모) — 누적곡선 진도율 % 산출용
  const denomByStage = useMemo(() => {
    const out: Partial<Record<Stage, number>> = {};
    for (const row of (totalsQ.data ?? []) as Array<{ stage: Stage; total: number }>) {
      out[row.stage] = (out[row.stage] ?? 0) + (Number(row.total) || 0);
    }
    return out;
  }, [totalsQ.data]);

  return {
    today,
    buckets,
    cellsQ,
    totalsQ,
    cells: cellsQ.data ?? [],
    totals: totalsQ.data ?? [],
    baselines,
    cum,
    denomByStage,
    loading: cellsQ.isPending || totalsQ.isPending,
    error: cellsQ.error || totalsQ.error,
  };
}
