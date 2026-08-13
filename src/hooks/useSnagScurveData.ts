import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  planGroupsForPlot,
  type PlotKey,
  type RoomGroupCol,
  type TeamKey,
} from "@/lib/defect-management/dashboard-shape";
import {
  STAGE_LABELS,
  addDays,
  buildBucketRange,
  monthStartIso,
  todayIso,
  weekStartIso,
  type Bucket,
  type GroupBy,
  type PlanMode,
  type Stage,
} from "@/lib/defect-management/progress-utils";
import {
  getSnagProgressCells,
  getSnagProgressTotals,
} from "@/lib/defect-management/progress.functions";

/**
 * SM S-Curve · KPI 정본 데이터.
 * SnagKpiAnalysisPage 에 있던 cells/totals 질의와 baseline useMemo 를 그대로 옮긴 것이다
 * (계산식 변경 없음). KPI Analysis 화면과 프로젝트 대시보드가 같은 훅을 쓴다.
 */
export interface SnagScurveParams {
  plot: PlotKey;
  teams: TeamKey[];
  roomGroups: RoomGroupCol[];
  buildings: string[];
  bucket: Bucket;
  planMode: PlanMode;
  stage: Stage;
  groupBy: GroupBy;
  asOfDate: string;
  rangeDays: number;
  /** 차트 시작일(ISO). 없으면 오늘 −14일(기존 동작) */
  startDate?: string | null;
}

export function useSnagScurveData(params: SnagScurveParams) {
  const { plot, teams, roomGroups, buildings, bucket, planMode, stage, groupBy, asOfDate, rangeDays, startDate } =
    params;

  const today = todayIso();

  // Progress 화면과 동일한 구간 규칙(수치 대조를 위해 그대로 복제)
  const rangeStart = useMemo(() => startDate ?? addDays(today, -14), [today, startDate]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);
  const rpcStart =
    bucket === "week" ? weekStartIso(rangeStart) : bucket === "month" ? monthStartIso(rangeStart) : rangeStart;
  const rpcEnd = rangeEnd;
  const effectiveRpcStart = bucket === "day" && rpcStart < rangeStart ? rangeStart : rpcStart;
  const buckets = useMemo(
    () => buildBucketRange(effectiveRpcStart, rpcEnd, bucket),
    [effectiveRpcStart, rpcEnd, bucket],
  );

  const planGroups = useMemo(() => planGroupsForPlot(plot), [plot]);

  const cellsFn = useServerFn(getSnagProgressCells);
  const totalsFn = useServerFn(getSnagProgressTotals);

  const teamsKey = [...teams].sort().join(",");
  const roomKey = [...roomGroups].sort().join(",");
  const buildingKey = [...buildings].sort().join(",");

  const cellsQ = useQuery({
    queryKey: [
      "snag-kpi-cells",
      plot,
      teamsKey,
      roomKey,
      buildingKey,
      bucket,
      effectiveRpcStart,
      rpcEnd,
      asOfDate,
      planMode,
    ],
    queryFn: () =>
      cellsFn({
        data: {
          planGroups,
          teams,
          roomGroups,
          buildings,
          groupBy: ["team"],
          bucket,
          rangeStart: effectiveRpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
        },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const totalsQ = useQuery({
    queryKey: ["snag-kpi-totals", plot, teamsKey, roomKey, buildingKey, groupBy, asOfDate, planMode],
    queryFn: () =>
      totalsFn({
        data: {
          planGroups,
          teams,
          roomGroups,
          buildings,
          groupBy: [groupBy],
          asOfDate,
          planMode,
        },
      }),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const stageTotal = useMemo(
    () =>
      (totalsQ.data ?? [])
        .filter((t: any) => t.stage === stage)
        .reduce((s: number, t: any) => s + Number(t.total ?? 0), 0),
    [totalsQ.data, stage],
  );

  /**
   * baseline = (as-of 누계 정본) − (차트 구간 합).
   * 별도 질의로 과거 누계를 묻지 않는다: RPC 의 `_as_of_date` 하나가
   * "계획일 상한"과 "완료 판정 시점"을 동시에 잡아 구간 경계에서 값이 갈리기 때문.
   * 빼기 방식은 두 차트가 같은 정본(totalsQ)을 쓰므로 오차가 정의상 0 이다.
   */
  const baseline = useMemo(() => {
    const totals = (totalsQ.data ?? []).filter((t: any) => t.stage === stage);
    const planUpto = totals.reduce((s: number, t: any) => s + Number(t.plan_upto ?? 0), 0);
    const actualUpto = totals.reduce((s: number, t: any) => s + Number(t.actual_upto ?? 0), 0);
    const bucketSet = new Set(buckets);
    // 버킷 종료일 — day: 자신, week: +6일, month: 그 달 말일
    const bucketEnd = (iso: string) => {
      const d = new Date(`${iso}T00:00:00Z`);
      if (bucket === "week") d.setUTCDate(d.getUTCDate() + 6);
      else if (bucket === "month") d.setUTCMonth(d.getUTCMonth() + 1, 0);
      return d.toISOString().slice(0, 10);
    };
    let spanPlan = 0;
    let spanActual = 0;
    for (const c of (cellsQ.data ?? []) as any[]) {
      // 서버 집계행(`all|...`)은 제외 — 선택 스테이지 행만 센다.
      if (c.stage !== stage || !c.bucket_iso || !bucketSet.has(c.bucket_iso)) continue;
      // 버킷 종료일이 as-of 이후면 그 버킷은 as-of 이후 몫을 포함하므로 빼지 않는다.
      if (bucketEnd(c.bucket_iso) > asOfDate) continue;
      spanPlan += Number(c.plan_cnt ?? 0);
      spanActual += Number(c.actual_cnt ?? 0);
    }
    const plan = planUpto - spanPlan;
    const actual = actualUpto - spanActual;
    if (plan < 0 || actual < 0) {
      console.warn(
        `[SnagKPI] baseline 음수: plan=${plan}, actual=${actual} (stage=${stage}, asOf=${asOfDate}) — 구간합이 누계를 초과했습니다.`,
      );
    }
    return { plan, actual, planUpto, actualUpto };
  }, [totalsQ.data, cellsQ.data, buckets, stage, asOfDate, bucket]);

  const filterSummary = useMemo(
    () => [
      { label: "Plot", value: plot },
      { label: "Team", value: teams.length ? teams.join(", ") : "All" },
      {
        label: "Room",
        value: roomGroups.length
          ? roomGroups.length <= 3
            ? roomGroups.join(", ")
            : `${roomGroups.length} selected`
          : "All",
      },
      { label: "Stage", value: STAGE_LABELS[stage] },
      {
        label: "Building",
        value: buildings.length
          ? buildings.length <= 3
            ? buildings.join(", ")
            : `${buildings.length} selected`
          : "All",
      },
      { label: "Plan", value: planMode === "remaining" ? "Remaining" : "Baseline" },
      { label: "As of", value: asOfDate },
    ],
    [plot, teams, roomGroups, buildings, stage, planMode, asOfDate],
  );

  return {
    today,
    buckets,
    planGroups,
    cellsQ,
    totalsQ,
    cells: cellsQ.data ?? [],
    totals: totalsQ.data ?? [],
    stageTotal,
    baseline,
    filterSummary,
    loading: cellsQ.isPending || totalsQ.isPending,
    error: cellsQ.error || totalsQ.error,
  };
}
