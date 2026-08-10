import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { DeSnagRoomGroupFilterBar } from "@/components/defect-management/dashboard/DeSnagRoomGroupFilterBar";
import { useDefectLatestDataDate } from "@/hooks/useDefectLatestDataDate";
import { useSnagAsOf } from "@/hooks/useSnagAsOf";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
import {
  ALL_TEAMS,
  ROOM_GROUP_ORDER,
  planGroupsForPlot,
  type PlotKey,
  type RoomGroupCol,
  type TeamKey,
} from "@/lib/defect-management/dashboard-shape";
import {
  ALL_GROUP_BY,
  GROUP_LABELS,
  GROUP_QUERY_PARAM,
  STAGE_LABELS,
  addDays,
  buildBucketRange,
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
import {
  SnagKpiPlanVsActualCard,
  type SnagCurveUnit,
} from "./SnagKpiPlanVsActualCard";
import { SnagGroupProgressChart } from "./SnagGroupProgressChart";

const routeApi = getRouteApi("/_authenticated/closure/snag-management/kpi-analysis");

/** 이 화면이 지원하는 단일 스테이지 (RPC totals 반환 스테이지) */
const STAGE_OPTIONS: Stage[] = ["start", "rectified", "closure"];

function parseCsv<T extends string>(v: string, allowed: readonly T[]): T[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

export function SnagKpiAnalysisPage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate({ from: "/closure/snag-management/kpi-analysis" });

  const setSearch = (patch: Record<string, unknown>) =>
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) as any, replace: true });

  const plot: PlotKey = search.plot as PlotKey;
  const teams = parseCsv<TeamKey>(search.teams, ALL_TEAMS);
  const roomGroups = parseCsv<RoomGroupCol>(search.roomGroups, ROOM_GROUP_ORDER);
  const bucket: Bucket = search.bucket as Bucket;
  const planMode: PlanMode = search.planMode as PlanMode;
  const stage: Stage = (STAGE_OPTIONS.includes(search.stageView as Stage)
    ? (search.stageView as Stage)
    : "closure") as Stage;
  const groupBy: GroupBy = (ALL_GROUP_BY.includes(search.groupBy as GroupBy)
    ? (search.groupBy as GroupBy)
    : "team") as GroupBy;
  const unit: SnagCurveUnit = search.unit === "pct" ? "pct" : "cnt";
  const rangeDays = search.range as number;

  const today = todayIso();
  const { options: dataDateOptions, latest: latestDataDate } = useDefectLatestDataDate();
  const [sharedAsOf, setSharedAsOf] = useSnagAsOf();
  const asOfDate = (search.dataDate as string) || sharedAsOf || today;
  useEffect(() => {
    const v = (search.dataDate as string) || "";
    if (v !== sharedAsOf) setSharedAsOf(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.dataDate]);

  // Progress 화면과 동일한 구간 규칙(수치 대조를 위해 그대로 복제)
  const rangeStart = useMemo(() => addDays(today, -14), [today]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);
  const rpcStart = bucket === "week" ? weekStartIso(rangeStart) : rangeStart;
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

  const cellsQ = useQuery({
    queryKey: [
      "snag-kpi-cells",
      plot,
      teamsKey,
      roomKey,
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
          groupBy: ["team"],
          bucket,
          rangeStart: effectiveRpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const totalsQ = useQuery({
    queryKey: ["snag-kpi-totals", plot, teamsKey, roomKey, groupBy, asOfDate, planMode],
    queryFn: () =>
      totalsFn({
        data: {
          planGroups,
          teams,
          roomGroups,
          groupBy: [groupBy],
          asOfDate,
          planMode,
        },
      }),
    staleTime: 60_000,
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
    let spanPlan = 0;
    let spanActual = 0;
    for (const c of (cellsQ.data ?? []) as any[]) {
      // 서버 집계행(`all|...`)은 제외 — 선택 스테이지 행만 센다.
      if (c.stage !== stage || !c.bucket_iso || !bucketSet.has(c.bucket_iso)) continue;
      // as-of 이후(미래) 버킷은 누계(plan_upto/actual_upto)에 없으므로 빼지 않는다.
      if (c.bucket_iso > asOfDate) continue;
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
    return { plan: Math.max(0, plan), actual: Math.max(0, actual) };
  }, [totalsQ.data, cellsQ.data, buckets, stage, asOfDate]);

  const [curveOpen, setCurveOpen] = useState(true);

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
      { label: "Plan", value: planMode === "remaining" ? "Remaining" : "Baseline" },
      { label: "As of", value: asOfDate },
    ],
    [plot, teams, roomGroups, stage, planMode, asOfDate],
  );

  const handleGroupClick = (dim: GroupBy, key: string) => {
    const params = new URLSearchParams();
    params.set("source", "kpi-analysis");
    params.set("tab", "all");
    params.set("plan_group", planGroups.join(","));
    if (teams.length) params.set("team", teams.join(","));
    if (roomGroups.length) params.set("roomGroup", roomGroups.join(","));
    params.set(GROUP_QUERY_PARAM[dim], key);
    params.set("stage", stage);
    params.set("asOf", asOfDate);
    window.location.assign(`/closure/snag-management/raw-data?${params.toString()}`);
  };

  const loading = cellsQ.isPending || totalsQ.isPending;
  const error = cellsQ.error || totalsQ.error;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="sticky top-0 z-30 -mx-4 -mt-4 flex flex-col gap-3 border-b bg-background px-4 pt-4 pb-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/closure/snag-management/dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="truncate text-xl font-semibold tracking-tight">
              Snag Management KPI Analysis
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {asOfHeaderLabel(asOfDate, today)}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              Week starts Monday
            </span>
          </div>
        </div>

        <Card className="bg-background">
          <CardContent className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <DataDatePicker
                showDataDateChip
                value={asOfDate}
                latest={latestDataDate ?? ""}
                options={dataDateOptions}
                onChange={(v) => setSearch({ dataDate: v === today ? "" : v })}
                onReset={() => setSearch({ dataDate: "" })}
              />

              <span className="h-5 w-px bg-border" aria-hidden />

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Plot
                </span>
                <ToggleGroup
                  type="single"
                  value={plot}
                  onValueChange={(v) => v && setSearch({ plot: v })}
                  className="gap-1"
                >
                  {(["C", "D"] as PlotKey[]).map((p) => (
                    <ToggleGroupItem
                      key={p}
                      value={p}
                      className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      Plot {p}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Team
                </span>
                <ToggleGroup
                  type="multiple"
                  value={teams}
                  onValueChange={(v) => setSearch({ teams: (v as string[]).join(",") })}
                  className="gap-1"
                >
                  {ALL_TEAMS.map((t) => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {t}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <span className="h-5 w-px bg-border" aria-hidden />

              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Stage
                </span>
                <Tabs value={stage} onValueChange={(v) => v && setSearch({ stageView: v })}>
                  <TabsList className="h-8">
                    {STAGE_OPTIONS.map((s) => (
                      <TabsTrigger key={s} value={s} className="h-6 px-2 text-xs">
                        {STAGE_LABELS[s]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              <span className="h-5 w-px bg-border" aria-hidden />

              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Group: {GROUP_LABELS[groupBy]}
              </span>
            </div>

            <DeSnagRoomGroupFilterBar
              selected={roomGroups}
              onChange={(next) => setSearch({ roomGroups: next.join(",") })}
            />
          </CardContent>
        </Card>
      </div>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-sm text-destructive">
            <AlertTriangle className="h-6 w-6" />
            {(error as Error).message}
          </CardContent>
        </Card>
      ) : loading ? (
        <Skeleton className="h-[600px] w-full" />
      ) : (
        <>
          <SnagGroupProgressChart
            totals={totalsQ.data ?? []}
            stage={stage}
            dim={groupBy}
            unit={unit}
            asOfDate={asOfDate}
            onDimChange={(d) => setSearch({ groupBy: d })}
            onGroupClick={(dim, key) => handleGroupClick(dim, key)}
          />
          <SnagKpiPlanVsActualCard
            cells={cellsQ.data ?? []}
            buckets={buckets}
            stage={stage}
            today={today}
            asOfDate={asOfDate}
            bucket={bucket}
            onBucketChange={(b) => setSearch({ bucket: b })}
            unit={unit}
            onUnitChange={(u) => setSearch({ unit: u })}
            filterSummary={filterSummary}
            baselinePlan={baseline.plan}
            baselineActual={baseline.actual}
            stageTotal={stageTotal}
            open={curveOpen}
            onOpenChange={setCurveOpen}
          />
        </>
      )}
    </div>
  );
}