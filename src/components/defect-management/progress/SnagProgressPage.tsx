import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DeSnagToolbar } from "@/components/defect-management/dashboard/DeSnagToolbar";
import { DeSnagRoomGroupFilterBar } from "@/components/defect-management/dashboard/DeSnagRoomGroupFilterBar";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { useDefectLatestDataDate } from "@/hooks/useDefectLatestDataDate";
import { useSnagAsOf } from "@/hooks/useSnagAsOf";
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
  ALL_STAGES,
  GROUP_LABELS,
  STAGE_LABELS,
  type Bucket,
  type GroupBy,
  type PlanMode,
  type Stage,
  addDays,
  assembleMatrix,
  buildBucketRange,
  groupKeyToRawParams,
  stageDateField,
  todayIso,
  weekStartIso,
} from "@/lib/defect-management/progress-utils";
import {
  getSnagProgressCells,
  getSnagProgressTotals,
} from "@/lib/defect-management/progress.functions";
import { SnagScheduleMatrix } from "./SnagScheduleMatrix";
import { Route } from "@/routes/_authenticated/closure/snag-management/progress";
import { SnagPlanVsActualCard } from "./SnagPlanVsActualCard";
import { ChevronDown, ChevronRight, LayoutGrid } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CardHeader, CardTitle } from "@/components/ui/card";

function parseCsv<T extends string>(v: string, allowed: readonly T[]): T[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

export function SnagProgressPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const plot: PlotKey = search.plot;
  const teams = parseCsv<TeamKey>(search.teams, ALL_TEAMS);
  const roomGroups = parseCsv<RoomGroupCol>(search.roomGroups, ROOM_GROUP_ORDER);
  const bucket: Bucket = search.bucket;
  const groupBy = parseCsv<GroupBy>(search.groupBy, ALL_GROUP_BY);
  const effectiveGroupBy: GroupBy[] = groupBy.length > 0 ? groupBy : ["team"];
  const stageView = parseCsv<Stage>(search.stageView, ALL_STAGES);
  const effectiveStages: Stage[] = stageView.length > 0 ? stageView : ["start", "rectified"];
  const rangeDays = search.range;
  const hidePast = search.hidePast === 1;
  const planMode: PlanMode = search.planMode;
  const matrixOpen = search.matrixOpen === 1;
  const scurveOpen = search.scurveOpen === 1;

  const today = todayIso();
  const { options: dataDateOptions, latest: latestDataDate } = useDefectLatestDataDate();
  // As-of 단일 규칙: 선택값 없으면 오늘(Asia/Qatar). data_date 폴백 금지.
  // (구 asofMode 파라미터는 URL 수용 후 무시)
  const [sharedAsOf, setSharedAsOf] = useSnagAsOf();
  const asOfDate = (search.dataDate as string) || sharedAsOf || today;
  const asOfLabel = asOfDate;
  useEffect(() => {
    const v = (search.dataDate as string) || "";
    if (v !== sharedAsOf) setSharedAsOf(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.dataDate]);

  const rangeStart = useMemo(() => addDays(today, -14), [today]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);
  const rpcStart = bucket === "week" ? weekStartIso(rangeStart) : rangeStart;
  const rpcEnd = rangeEnd;

  const planGroups = useMemo(() => planGroupsForPlot(plot), [plot]);

  const cellsFn = useServerFn(getSnagProgressCells);
  const totalsFn = useServerFn(getSnagProgressTotals);

  const teamsKey = [...teams].sort().join(",");
  const roomKey = [...roomGroups].sort().join(",");
  const groupKey = effectiveGroupBy.join(",");

  const cellsQ = useQuery({
    queryKey: [
      "snag-progress-cells",
      plot,
      teamsKey,
      roomKey,
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
          planGroups,
          teams,
          roomGroups,
          groupBy: effectiveGroupBy,
          bucket,
          rangeStart: rpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const totalsQ = useQuery({
    queryKey: ["snag-progress-totals", plot, teamsKey, roomKey, groupKey, asOfDate, planMode],
    queryFn: () =>
      totalsFn({
        data: {
          planGroups,
          teams,
          roomGroups,
          groupBy: effectiveGroupBy,
          asOfDate,
          planMode,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Day 뷰 좌측 누계 컬럼: 표시 구간 시작 하루 전까지의 누계를 서버 값으로 사용.
  // (하드코딩 날짜 제거 — 구간에서 파생)
  const cumIso = useMemo(() => addDays(rangeStart, -1), [rangeStart]);
  const totalsCumQ = useQuery({
    queryKey: ["snag-progress-totals-cum", plot, teamsKey, roomKey, groupKey, planMode, cumIso],
    queryFn: () =>
      totalsFn({
        data: {
          planGroups,
          teams,
          roomGroups,
          groupBy: effectiveGroupBy,
          asOfDate: cumIso,
          planMode,
        },
      }),
    enabled: bucket === "day",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Day 뷰 셀 RPC 범위는 표시 구간 시작일부터. 그 이전 누계는 totalsCumQ 가 제공.
  const effectiveRpcStart = bucket === "day" && rpcStart < rangeStart ? rangeStart : rpcStart;
  const buckets = useMemo(
    () => buildBucketRange(effectiveRpcStart, rpcEnd, bucket),
    [effectiveRpcStart, rpcEnd, bucket],
  );

  const matrix = useMemo(() => {
    const cells = cellsQ.data ?? [];
    const totals = totalsQ.data ?? [];
    const result = assembleMatrix({
      cells,
      totals,
      buckets,
      stagesToShow: effectiveStages,
    });
    // Day 뷰: 서버가 계산한 구간 이전 누계를 별도 컬럼으로 prepend
    if (bucket === "day") {
      const CUM_ISO = cumIso;
      let visStart = 0;
      if (hidePast) {
        const t = result.buckets.findIndex((b) => b >= today);
        if (t > visStart) visStart = t;
      }
      // 그룹키/스테이지별 7/21 누계 조회 맵
      const cumRows = totalsCumQ.data ?? [];
      const cumMap = new Map<string, Record<Stage, { plan: number; actual: number }>>();
      const emptyStages = (): Record<Stage, { plan: number; actual: number }> => ({
        start: { plan: 0, actual: 0 },
        rectified: { plan: 0, actual: 0 },
        closure: { plan: 0, actual: 0 },
      });
      for (const t of cumRows) {
        const k = JSON.stringify(t.group_key ?? []);
        if (!cumMap.has(k)) cumMap.set(k, emptyStages());
        cumMap.get(k)![t.stage as Stage] = { plan: t.plan_upto, actual: t.actual_upto };
      }
      const cellFor = (groupKeyRaw: string[], stage: Stage) => {
        const s = cumMap.get(JSON.stringify(groupKeyRaw))?.[stage] ?? { plan: 0, actual: 0 };
        return { bucket: CUM_ISO, plan: s.plan, actual: s.actual };
      };
      const combinedFor = (groupKeyRaw: string[]) => {
        let p = 0;
        let a = 0;
        for (const st of effectiveStages) {
          const c = cellFor(groupKeyRaw, st);
          p += c.plan;
          a += c.actual;
        }
        return { bucket: CUM_ISO, plan: p, actual: a };
      };
      const newBuckets = [CUM_ISO, ...result.buckets.slice(visStart)];
      const rows = result.rows.map((r) => ({
        ...r,
        combined: [combinedFor(r.groupKeyRaw), ...r.combined.slice(visStart)],
        stages: {
          start: { ...r.stages.start, cells: [cellFor(r.groupKeyRaw, "start"), ...r.stages.start.cells.slice(visStart)] },
          rectified: { ...r.stages.rectified, cells: [cellFor(r.groupKeyRaw, "rectified"), ...r.stages.rectified.cells.slice(visStart)] },
          closure: { ...r.stages.closure, cells: [cellFor(r.groupKeyRaw, "closure"), ...r.stages.closure.cells.slice(visStart)] },
        },
      }));
      return { buckets: newBuckets, rows };
    }
    // Week 뷰: 기존 hidePast 슬라이스만 유지
    if (!hidePast) return result;
    const startIdx = result.buckets.findIndex((b) => b >= today);
    if (startIdx <= 0) return result;
    const newBuckets = result.buckets.slice(startIdx);
    const rows = result.rows.map((r) => ({
      ...r,
      combined: r.combined.slice(startIdx),
      stages: {
        start: { ...r.stages.start, cells: r.stages.start.cells.slice(startIdx) },
        rectified: { ...r.stages.rectified, cells: r.stages.rectified.cells.slice(startIdx) },
        closure: { ...r.stages.closure, cells: r.stages.closure.cells.slice(startIdx) },
      },
    }));
    return { buckets: newBuckets, rows };
  }, [cellsQ.data, totalsQ.data, totalsCumQ.data, buckets, effectiveStages, hidePast, today, bucket]);

  const kpis = useMemo(() => {
    const byStage: Record<Stage, { plan: number; actual: number; done: number; total: number; noPlan: number }> = {
      start: { plan: 0, actual: 0, done: 0, total: 0, noPlan: 0 },
      rectified: { plan: 0, actual: 0, done: 0, total: 0, noPlan: 0 },
      closure: { plan: 0, actual: 0, done: 0, total: 0, noPlan: 0 },
    };
    for (const t of (totalsQ.data ?? []) as Array<{
      stage: Stage;
      plan_upto: number;
      actual_upto: number;
      done_upto: number;
      total: number;
      no_plan: number;
    }>) {
      if (!effectiveStages.includes(t.stage)) continue;
      byStage[t.stage].plan += t.plan_upto;
      byStage[t.stage].actual += t.actual_upto;
      byStage[t.stage].done += t.done_upto;
      byStage[t.stage].total += t.total;
      byStage[t.stage].noPlan += t.no_plan;
    }
    let cumPlan = 0, cumActual = 0, doneStages = 0, totalStages = 0;
    for (const s of effectiveStages) {
      cumPlan += byStage[s].plan;
      cumActual += byStage[s].actual;
      doneStages += byStage[s].done;
      totalStages += byStage[s].total;
    }
    const diffAbs = cumActual - cumPlan;
    const variance = cumPlan > 0 ? (diffAbs / cumPlan) * 100 : null;
    const progressPct = totalStages > 0 ? (doneStages / totalStages) * 100 : 0;
    const planPct = totalStages > 0 ? (cumPlan / totalStages) * 100 : 0;
    const totalPct = totalStages > 0 ? 100 : 0;
    const planPctOfTotal = totalStages > 0 ? (cumPlan / totalStages) * 100 : 0;
    const actualPctOfTotal = totalStages > 0 ? (cumActual / totalStages) * 100 : 0;
    const noPlanTotal = effectiveStages.reduce((s, st) => s + byStage[st].noPlan, 0);
    return { byStage, cumPlan, cumActual, diffAbs, variance, doneStages, totalStages, progressPct, planPct, totalPct, planPctOfTotal, actualPctOfTotal, noPlanTotal };
  }, [totalsQ.data, effectiveStages]);

  const groupHeader = effectiveGroupBy.map((g) => GROUP_LABELS[g]).join(" · ");

  const setSearch = (patch: Partial<typeof search>) => {
    navigate({
      search: (prev: typeof search) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  const handleCellClick = (
    groupKeyRaw: string[],
    bucketIso: string,
    stage: Stage | "all",
    field: "planned" | "actual",
  ) => {
    const params = new URLSearchParams();
    params.set("source", "progress");
    params.set("plan_group", planGroups.join(","));
    if (teams.length) params.set("team", teams.join(","));
    if (roomGroups.length) params.set("roomGroup", roomGroups.join(","));
    const g = groupKeyToRawParams(effectiveGroupBy, groupKeyRaw);
    for (const [k, v] of Object.entries(g)) params.set(k, v);
    const dateFrom = bucketIso;
    const dateTo = bucket === "week" ? addDays(bucketIso, 6) : bucketIso;
    params.set("dateStart", dateFrom);
    params.set("dateEnd", dateTo);
    params.set("dateField", stageDateField(stage, field));
    if (stage !== "all") params.set("stage", stage);
    window.location.assign(`/closure/snag-management/raw-data?${params.toString()}`);
  };

  const handleKpiClick = (
    kind: "plan" | "actual" | "done",
    stage: Stage | "all",
  ) => {
    const params = new URLSearchParams();
    params.set("source", "progress-kpi");
    params.set("plan_group", planGroups.join(","));
    if (teams.length) params.set("team", teams.join(","));
    if (roomGroups.length) params.set("roomGroup", roomGroups.join(","));
    if (stage !== "all") params.set("stage", stage);
    if (kind === "plan") {
      params.set("dateField", stageDateField(stage, "planned"));
      params.set("dateEnd", asOfDate);
    } else if (kind === "actual") {
      params.set("dateField", stageDateField(stage, "actual"));
      params.set("dateEnd", asOfDate);
    }
    // 'done' 카드 총계 클릭 시: 활성 전체 리스트 (dateField 미지정)
    window.location.assign(`/closure/snag-management/raw-data?${params.toString()}`);
  };

  const isAllGroups = effectiveGroupBy.length === ALL_GROUP_BY.length;
  const isAllStages = effectiveStages.length === ALL_STAGES.length;

  const loading = cellsQ.isPending || totalsQ.isPending;
  const error = cellsQ.error || totalsQ.error;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <CalendarDays className="h-5 w-5 text-primary" />
              Snag Progress Status
            </h1>
            {latestDataDate && (
              <DataDatePicker
                mode="datadate"
                value={effectiveDataDate}
                latest={latestDataDate}
                options={dataDateOptions}
                onChange={(v) =>
                  setSearch({ dataDate: v === latestDataDate ? "" : v })
                }
                onReset={() => setSearch({ dataDate: "" })}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Plot {plot} · {groupHeader} · {bucket === "day" ? "Daily" : "Weekly"} · As-of {asOfLabel} ({asOfDate}) ·
            Plan: {planMode === "remaining" ? "Remaining" : "Baseline"} · Range {rangeDays}d
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <ToolbarGroup label="Plot">
              <ToggleGroup
                type="single"
                value={plot}
                onValueChange={(v) => v && setSearch({ plot: v as PlotKey })}
                className="gap-1"
              >
                <ToggleGroupItem value="C" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Plot C
                </ToggleGroupItem>
                <ToggleGroupItem value="D" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Plot D
                </ToggleGroupItem>
              </ToggleGroup>
            </ToolbarGroup>

            <DeSnagToolbar teams={teams} onChange={(t) => setSearch({ teams: t.join(",") })} />
          </div>

          <DeSnagRoomGroupFilterBar
            selected={roomGroups}
            onChange={(r) => setSearch({ roomGroups: r.join(",") })}
          />

          <div className="flex flex-wrap items-center gap-3">
            <ToolbarGroup label="Group">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={isAllGroups ? "default" : "outline"}
                  className="h-8 px-2 text-xs"
                  onClick={() => setSearch({ groupBy: ALL_GROUP_BY.join(",") })}
                >
                  All
                </Button>
                <ToggleGroup
                  type="multiple"
                  value={isAllGroups ? [] : effectiveGroupBy}
                  onValueChange={(v) => {
                    const next = (v as GroupBy[]).filter((x) => (ALL_GROUP_BY as string[]).includes(x));
                    if (next.length === 0) {
                      setSearch({ groupBy: "team" });
                      return;
                    }
                    // 표준 순서 유지
                    const sorted = ALL_GROUP_BY.filter((k) => next.includes(k));
                    setSearch({ groupBy: sorted.join(",") });
                  }}
                  className="gap-1 flex-wrap"
                >
                  {ALL_GROUP_BY.map((k) => (
                    <ToggleGroupItem
                      key={k}
                      value={k}
                      className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {GROUP_LABELS[k]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </ToolbarGroup>

            <ToolbarGroup label="Stage">
              <ToggleGroup
                type="multiple"
                value={isAllStages ? ["start", "rectified", "closure"] : effectiveStages}
                onValueChange={(v) => {
                  const next = (v as Stage[]).filter((x) => (ALL_STAGES as string[]).includes(x));
                  if (next.length === 0) return;
                  const sorted = ALL_STAGES.filter((k) => next.includes(k));
                  setSearch({ stageView: sorted.join(",") });
                }}
                className="gap-1"
              >
                {ALL_STAGES.map((s) => (
                  <ToggleGroupItem
                    key={s}
                    value={s}
                    className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {STAGE_LABELS[s]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ToolbarGroup>

            <ToolbarGroup label="Bucket">
              <ToggleGroup
                type="single"
                value={bucket}
                onValueChange={(v) => v && setSearch({ bucket: v as Bucket })}
                className="gap-1"
              >
                <ToggleGroupItem value="day" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Day
                </ToggleGroupItem>
                <ToggleGroupItem value="week" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Week
                </ToggleGroupItem>
              </ToggleGroup>
            </ToolbarGroup>

            <ToolbarGroup label="Range">
              <Select value={String(rangeDays)} onValueChange={(v) => setSearch({ range: Number(v) })}>
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[30, 60, 90, 180].map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n} days
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ToolbarGroup>

            <div className="flex items-center gap-2">
              <Switch
                id="hidepast"
                checked={hidePast}
                onCheckedChange={(c) => setSearch({ hidePast: c ? 1 : 0 })}
              />
              <Label htmlFor="hidepast" className="text-xs">
                Hide past
              </Label>
            </div>

            <ToolbarGroup label="As-of">
              <ToggleGroup
                type="single"
                value={asofMode}
                onValueChange={(v) => v && setSearch({ asofMode: v as "dataDate" | "today" })}
                className="gap-1"
              >
                <ToggleGroupItem value="dataDate" className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Data Date
                </ToggleGroupItem>
                <ToggleGroupItem value="today" className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Today
                </ToggleGroupItem>
              </ToggleGroup>
            </ToolbarGroup>

            <ToolbarGroup label="Plan">
              <ToggleGroup
                type="single"
                value={planMode}
                onValueChange={(v) => v && setSearch({ planMode: v as PlanMode })}
                className="gap-1"
              >
                <ToggleGroupItem value="baseline" className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Baseline
                </ToggleGroupItem>
                <ToggleGroupItem value="remaining" className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Remaining
                </ToggleGroupItem>
              </ToggleGroup>
            </ToolbarGroup>
          </div>
        </CardContent>
      </Card>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="TOTAL"
          value={kpis.totalStages.toLocaleString()}
          onClick={() => handleKpiClick("done", "all")}
          tone="info"
          suffix={
            <span className="text-[10px] tabular-nums text-muted-foreground">
              ({kpis.totalPct.toFixed(1)}%)
            </span>
          }
          stageBreakdown={effectiveStages.map((s) => ({
            stage: s,
            value: kpis.byStage[s].total.toLocaleString(),
            suffix: `(${kpis.byStage[s].total > 0 ? 100.0.toFixed(1) : "—"}%)`,
            onClick: () => handleKpiClick("done", s),
          }))}
        />
        <KpiCard
          label="PLAN"
          value={kpis.cumPlan.toLocaleString()}
          onClick={() => handleKpiClick("plan", "all")}
          tone="neutral"
          suffix={
            <span className="text-[10px] tabular-nums text-muted-foreground">
              ({kpis.planPctOfTotal.toFixed(1)}%)
            </span>
          }
          stageBreakdown={effectiveStages.map((s) => {
            const total = kpis.byStage[s].total;
            const pct = total > 0 ? (kpis.byStage[s].plan / total) * 100 : null;
            return {
              stage: s,
              value: kpis.byStage[s].plan.toLocaleString(),
              suffix: `(${pct === null ? "—" : `${pct.toFixed(1)}%`})`,
              onClick: () => handleKpiClick("plan", s),
            };
          })}
        />
        <KpiCard
          label="ACTUAL"
          value={kpis.cumActual.toLocaleString()}
          onClick={() => handleKpiClick("actual", "all")}
          tone="emerald"
          suffix={
            <span className="text-[10px] tabular-nums text-muted-foreground">
              ({kpis.actualPctOfTotal.toFixed(1)}%)
            </span>
          }
          stageBreakdown={effectiveStages.map((s) => {
            const total = kpis.byStage[s].total;
            const pct = total > 0 ? (kpis.byStage[s].actual / total) * 100 : null;
            return {
              stage: s,
              value: kpis.byStage[s].actual.toLocaleString(),
              suffix: `(${pct === null ? "—" : `${pct.toFixed(1)}%`})`,
              onClick: () => handleKpiClick("actual", s),
            };
          })}
        />
        <KpiCard
          label="DIFFERENCE"
          value={`${kpis.diffAbs > 0 ? "+" : ""}${kpis.diffAbs.toLocaleString()}`}
          accent={kpis.diffAbs < 0 ? "text-schedule-short" : kpis.diffAbs > 0 ? "text-schedule-over" : ""}
          tone="neutral"
          suffix={
            kpis.variance === null ? (
              <span className="text-[10px] text-muted-foreground">—</span>
            ) : (
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  kpis.variance < 0
                    ? "text-schedule-short"
                    : kpis.variance > 0
                      ? "text-schedule-over"
                      : "text-muted-foreground",
                )}
              >
                ({kpis.variance > 0 ? "+" : ""}
                {kpis.variance.toFixed(1)}%)
              </span>
            )
          }
          onClick={() => handleKpiClick("actual", "all")}
          stageBreakdown={effectiveStages.map((s) => {
            const d = kpis.byStage[s].actual - kpis.byStage[s].plan;
            return {
              stage: s,
              value: `${d > 0 ? "+" : ""}${d.toLocaleString()}`,
              tone: d < 0 ? "short" : d > 0 ? "over" : undefined,
              onClick: () => handleKpiClick("actual", s),
            };
          })}
        />
        <KpiCard
          label="NO PLAN"
          value={kpis.noPlanTotal.toLocaleString()}
          tone="danger"
          stageBreakdown={effectiveStages.map((s) => ({
            stage: s,
            label: s === "start" ? "No Start" : s === "rectified" ? "No Rect" : "No Closure",
            value: kpis.byStage[s].noPlan.toLocaleString(),
          }))}
        />
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            데이터 로딩 실패: {String((error as Error).message)}
          </CardContent>
        </Card>
      ) : loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Card>
            <Collapsible open={matrixOpen} onOpenChange={(v) => setSearch({ matrixOpen: v ? 1 : 0 })}>
              <CardHeader className="pb-2">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left hover:opacity-80"
                    aria-expanded={matrixOpen}
                  >
                    {matrixOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <LayoutGrid className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm">Progress Matrix</CardTitle>
                  </button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <SnagScheduleMatrix
                    data={matrix}
                    bucket={bucket}
                    stagesToShow={effectiveStages}
                    today={today}
                    asOfLabel={asOfLabel}
                    groupHeader={groupHeader}
                    onCellClick={handleCellClick}
                    cumBucketIso={bucket === "day" ? "2026-07-21" : undefined}
                  />
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
          <SnagPlanVsActualCard
            cells={cellsQ.data ?? []}
            buckets={buckets}
            stages={effectiveStages}
            today={today}
            open={scurveOpen}
            onOpenChange={(v) => setSearch({ scurveOpen: v ? 1 : 0 })}
          />
        </>
      )}
    </div>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon: Icon,
  onClick,
  suffix,
  stageBreakdown,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  accent?: string;
  icon?: typeof TrendingUp;
  onClick?: () => void;
  suffix?: React.ReactNode;
  stageBreakdown?: Array<{
    stage: Stage;
    label?: string;
    value: string;
    suffix?: string;
    tone?: "short" | "over";
    onClick?: () => void;
  }>;
  tone?: "neutral" | "info" | "emerald" | "danger" | "warn";
}) {
  const TONE_CLASSES: Record<NonNullable<typeof tone>, string> = {
    neutral: "",
    info: "text-blue-600 dark:text-blue-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    danger: "text-red-600 dark:text-red-400",
    warn: "text-amber-600 dark:text-amber-400",
  };
  return (
    <Card
      onClick={onClick}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-primary/10")}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {Icon ? <Icon className="h-3 w-3" /> : null}
              {label}
            </div>
            <div className="flex flex-col gap-0">
              <div
                className={cn(
                  "text-3xl font-bold tabular-nums leading-tight",
                  TONE_CLASSES[tone],
                  accent,
                )}
              >
                {value}
              </div>
              {suffix}
            </div>
          </div>
          {stageBreakdown && stageBreakdown.length > 0 && (
            <div
              className="flex max-h-36 min-w-[112px] shrink-0 flex-col gap-1 overflow-y-auto border-l pl-2"
              onClick={(e) => e.stopPropagation()}
            >
              {stageBreakdown.map((b) => (
                <button
                  key={b.stage}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    b.onClick?.();
                  }}
                  className={cn(
                    "flex h-auto min-h-[28px] flex-col justify-center rounded px-1 py-0.5 text-[11px] tabular-nums transition-colors",
                    b.onClick && "cursor-pointer hover:bg-primary/10",
                    !b.onClick && "cursor-default",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate", tone === "danger" ? TONE_CLASSES.danger : "text-muted-foreground")}>
                      {b.label ?? STAGE_LABELS[b.stage]}
                    </span>
                    <span
                      className={cn(
                        "font-medium",
                        b.tone === "short" && "text-schedule-short",
                        b.tone === "over" && "text-schedule-over",
                        !b.tone && TONE_CLASSES[tone],
                      )}
                    >
                      {b.value}
                    </span>
                  </div>
                  {b.suffix && (
                    <div className="self-end text-[10px] text-muted-foreground">
                      {b.suffix}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}