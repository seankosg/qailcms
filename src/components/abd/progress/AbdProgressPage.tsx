import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
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
import { ABD_TEAMS, type AbdTeam } from "@/lib/abd/columns";
import {
  ALL_GROUP_BY,
  ALL_STAGES,
  GROUP_LABELS,
  STAGE_SHORT_LABELS,
  type Bucket,
  type GroupBy,
  type PlanMode,
  type Stage,
  type RoundKey,
  addDays,
  assembleMatrix,
  buildBucketRange,
  groupKeyToRawParams,
  stageDateField,
  todayIso,
  weekStartIso,
} from "@/lib/abd/progress-utils";
import {
  getAbdProgressCells,
  getAbdProgressTotals,
} from "@/lib/abd/progress.functions";
import { AbdStageGroupStrip } from "@/components/abd/progress/AbdStageGroupStrip";
import { AbdScheduleMatrix } from "./AbdScheduleMatrix";
import { Route } from "@/routes/_authenticated/closure/abd/progress";
import { AbdPlanVsActualCard } from "./AbdPlanVsActualCard";
import type { CellRaw } from "@/lib/abd/progress-utils";
import type { SCurveBaselines } from "@/lib/abd/scurve-utils";
import { ChevronDown, ChevronRight, LayoutGrid } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { useQueries } from "@tanstack/react-query";

const TEAM_VALUES = ABD_TEAMS.map((t) => t.value);

function parseCsv<T extends string>(v: string, allowed: readonly T[]): T[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
}

export function AbdProgressPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const plot = search.plot;
  const teams = parseCsv<AbdTeam>(search.teams, TEAM_VALUES);
  const round: RoundKey = search.round;
  const bucket: Bucket = search.bucket;
  const groupBy = parseCsv<GroupBy>(search.groupBy, ALL_GROUP_BY);
  const effectiveGroupBy: GroupBy[] = groupBy.length > 0 ? groupBy : ["team"];
  const stageView = parseCsv<Stage>(search.stageView, ALL_STAGES);
  const effectiveStages: Stage[] = stageView.length > 0 ? stageView : [...ALL_STAGES];
  const rangeDays = search.range;
  const hidePast = search.hidePast === 1;
  const asofMode = search.asofMode;
  const planMode: PlanMode = search.planMode;
  const matrixOpen = search.matrixOpen === 1;
  const scurveOpen = search.scurveOpen === 1;

  const today = todayIso();

  // Data Date 옵션 로드 (distinct data_date DESC)
  const dataDatesQ = useQuery<string[]>({
    queryKey: ["abd-data-dates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("abd_items_raw")
        .select("data_date")
        .not("data_date", "is", null)
        .order("data_date", { ascending: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      const set = new Set<string>();
      for (const r of (data ?? []) as any[]) {
        if (r.data_date) set.add(String(r.data_date).slice(0, 10));
      }
      return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
    },
    staleTime: 60_000,
  });
  const dataDateOptions = dataDatesQ.data ?? [];
  const latestDataDate = dataDateOptions[0] ?? "";
  const effectiveDataDate = search.dataDate || latestDataDate;
  const asOfDate = asofMode === "today" || !effectiveDataDate ? today : effectiveDataDate;
  const asOfLabel = asofMode === "today" ? "Today" : "Data Date";

  const rangeStart = useMemo(() => addDays(today, -14), [today]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);
  const rpcStart = bucket === "week" ? weekStartIso(rangeStart) : rangeStart;
  const rpcEnd = rangeEnd;
  const baselineAsOf = useMemo(() => addDays(rpcStart, -1), [rpcStart]);

  const cellsFn = useServerFn(getAbdProgressCells);
  const totalsFn = useServerFn(getAbdProgressTotals);

  const teamsKey = [...teams].sort().join(",");
  const groupKey = effectiveGroupBy.join(",");
  const roundKey = round;

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
          plots: plot === "all" ? [] : [plot],
          teams,
          groupBy: effectiveGroupBy,
          bucket,
          rangeStart: rpcStart,
          rangeEnd: rpcEnd,
          asOfDate,
          planMode,
          round,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const totalsQ = useQuery({
    queryKey: ["abd-progress-totals", plot, teamsKey, roundKey, groupKey, asOfDate, planMode],
    queryFn: () =>
      totalsFn({
        data: {
          plots: plot === "all" ? [] : [plot],
          teams,
          groupBy: effectiveGroupBy,
          asOfDate,
          planMode,
          round,
        },
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const buckets = useMemo(() => buildBucketRange(rpcStart, rpcEnd, bucket), [rpcStart, rpcEnd, bucket]);

  // S-Curve: R1/R2/R3 각각의 cells 를 별도로 로드.
  const activeRounds: Array<"R1" | "R2" | "R3"> = ["R1", "R2", "R3"];
  const perRoundQueries = useQueries({
    queries: (["R1", "R2", "R3"] as const).map((r) => ({
      queryKey: [
        "abd-progress-cells",
        plot,
        teamsKey,
        r,
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
            plots: plot === "all" ? [] : [plot],
            teams,
            groupBy: effectiveGroupBy,
            bucket,
            rangeStart: rpcStart,
            rangeEnd: rpcEnd,
            asOfDate,
            planMode,
            round: r,
          },
        }),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      enabled: scurveOpen,
    })),
  });
  const cellsByRound: Partial<Record<"R1" | "R2" | "R3", CellRaw[]>> = useMemo(() => {
    const out: Partial<Record<"R1" | "R2" | "R3", CellRaw[]>> = {};
    (["R1", "R2", "R3"] as const).forEach((r, i) => {
      out[r] = (perRoundQueries[i]?.data ?? []) as CellRaw[];
    });
    return out;
  }, [perRoundQueries]);

  // S-Curve 누적 시작 오프셋: rangeStart-1 시점의 totals 를 라운드별로 로드하여
  // cumPlan/cumActual 의 초기값으로 깔아 KPI 누계와 곡선 끝값이 일치하도록 한다.
  const baselineQueries = useQueries({
    queries: (["R1", "R2", "R3"] as const).map((r) => ({
      queryKey: [
        "abd-progress-totals-baseline",
        plot,
        teamsKey,
        r,
        groupKey,
        baselineAsOf,
        planMode,
      ],
      queryFn: () =>
        totalsFn({
          data: {
            plots: plot === "all" ? [] : [plot],
            teams,
            groupBy: effectiveGroupBy,
            asOfDate: baselineAsOf,
            planMode,
            round: r,
          },
        }),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      enabled: scurveOpen,
    })),
  });
  const baselinesByRound: SCurveBaselines = useMemo(() => {
    const out: SCurveBaselines = {};
    (["R1", "R2", "R3"] as const).forEach((r, i) => {
      const rows = (baselineQueries[i]?.data ?? []) as Array<{
        stage: Stage; plan_upto: number; actual_upto: number;
      }>;
      const perStage: Partial<Record<Stage, { plan: number; actual: number }>> = {};
      for (const row of rows) {
        const prev = perStage[row.stage] ?? { plan: 0, actual: 0 };
        perStage[row.stage] = {
          plan: prev.plan + (Number(row.plan_upto) || 0),
          actual: prev.actual + (Number(row.actual_upto) || 0),
        };
      }
      out[r] = perStage;
    });
    return out;
  }, [baselineQueries]);

  const matrix = useMemo(() => {
    const cells = cellsQ.data ?? [];
    const totals = totalsQ.data ?? [];
    const result = assembleMatrix({
      cells,
      totals,
      buckets,
      stagesToShow: effectiveStages,
    });
    if (!hidePast) return result;
    const startIdx = result.buckets.findIndex((b) => b >= today);
    if (startIdx <= 0) return result;
    const newBuckets = result.buckets.slice(startIdx);
    const rows = result.rows.map((r) => ({
      ...r,
      combined: r.combined.slice(startIdx),
      stages: {
        draft_start:  { ...r.stages.draft_start,  cells: r.stages.draft_start.cells.slice(startIdx) },
        draft_finish: { ...r.stages.draft_finish, cells: r.stages.draft_finish.cells.slice(startIdx) },
        submission:   { ...r.stages.submission,   cells: r.stages.submission.cells.slice(startIdx) },
        dar:          { ...r.stages.dar,          cells: r.stages.dar.cells.slice(startIdx) },
      },
    }));
    return { buckets: newBuckets, rows };
  }, [cellsQ.data, totalsQ.data, buckets, effectiveStages, hidePast, today]);

  // KPI 스트립은 stage_group 정본(abd_stage_group_counts)으로 전환됨.
  // 매트릭스 하단 요약 등 파생 계산은 유지.
  void useMemo(() => {
    let cumPlan = 0;
    let cumActual = 0;
    let doneStages = 0;
    let totalStages = 0;
    for (const t of totalsQ.data ?? []) {
      if (!effectiveStages.includes(t.stage)) continue;
      cumPlan += t.plan_upto;
      cumActual += t.actual_upto;
      doneStages += t.done_upto;
      totalStages += t.total;
    }
    const planPct = totalStages > 0 ? (cumPlan / totalStages) * 100 : 0;
    const progressPct = totalStages > 0 ? (doneStages / totalStages) * 100 : 0;
    const gapPct = progressPct - planPct;
    const behindCount = Math.max(0, cumPlan - cumActual);
    const onTrackCount = Math.max(0, cumActual);
    return {
      cumPlan,
      cumActual,
      doneStages,
      totalStages,
      progressPct,
      planPct,
      gapPct,
      behindCount,
      onTrackCount,
    };
  }, [totalsQ.data, effectiveStages]);

  const groupHeader = effectiveGroupBy.map((g) => GROUP_LABELS[g]).join(" · ");

  const plotsForDash = plot === "all" ? [] : [plot];

  const openRaw = (params: Record<string, string> = {}) => {
    const s: Record<string, string> = { source: "progress", ...params };
    if (plot !== "all" && !("plot" in s)) s.plot = plot;
    if (!("tab" in s)) s.tab = teams.length > 0 ? teams.join(",") : "MECH,ELEC,ARCH";
    // Progress 모집단(Terminated 포함)과 동일하게 맞춘다.
    if (!("excluded" in s)) s.excluded = "all";
    navigate({ to: "/closure/abd/raw-data", search: s as any });
  };

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
    const filterObj: Record<string, any> = {};
    const g = groupKeyToRawParams(effectiveGroupBy, groupKeyRaw);
    for (const [k, v] of Object.entries(g)) {
      if (k === "team" || k === "plot") continue;
      filterObj[k] = v === "__EMPTY__" ? ["__EMPTY__"] : [v];
    }
    const dateFrom = bucketIso;
    const dateTo = bucket === "week" ? addDays(bucketIso, 6) : bucketIso;

    const params = new URLSearchParams();
    params.set("source", "progress");
    // 팀 미지정 시 전 팀 포함(대시보드 openRawData 와 동일 패턴).
    // 지정 시 선택 팀 전체 전달.
    params.set("tab", teams.length > 0 ? teams.join(",") : "MECH,ELEC,ARCH");
    params.set("plot", plot);
    // Progress 집계는 Terminated 포함이 업무 규칙. Raw 기본은 hide 라 모집단이
    // 어긋나므로 명시적으로 all 을 지정한다.
    params.set("excluded", "all");
    // round='all' 이면 R1·R2·R3 동일 스테이지 날짜 컬럼을 date_range_or 로 묶어 전달.
    // 단일 라운드는 기존 dateField 단수 경로(하위호환) 유지.
    if (round === "all") {
      const cols = (["R1", "R2", "R3"] as const).map((r) => stageDateField(stage, field, r));
      params.set("dateStart", dateFrom);
      params.set("dateEnd", dateTo);
      params.set("dateFields", cols.join(","));
    } else {
      const dateField = stageDateField(stage, field, round);
      filterObj[dateField] = { from: dateFrom, to: dateTo };
    }
    // Raw Data 페이지에서 JSON 파싱 문제를 피하고자 필터는 개별 파라미터로 전달
    for (const [k, v] of Object.entries(filterObj)) {
      if (v == null) continue;
      if (typeof v === "object" && v.from && v.to) {
        params.set("dateStart", v.from);
        params.set("dateEnd", v.to);
        params.set("dateField", k);
      } else if (Array.isArray(v)) {
        params.set(k, v.join(","));
      }
    }
    params.set("round", round);
    if (stage !== "all") params.set("stage", stage);
    window.location.assign(`/closure/abd/raw-data?${params.toString()}`);
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
              ABD Progress Status
            </h1>
            <DataDatePicker
              value={effectiveDataDate}
              latest={latestDataDate}
              options={dataDateOptions}
              onChange={(v) =>
                setSearch({
                  dataDate: v === latestDataDate ? "" : v,
                  asofMode: "dataDate",
                })
              }
              onReset={() => setSearch({ dataDate: "" })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Plot {plot} · {groupHeader} · {bucket === "day" ? "Daily" : "Weekly"} ·
            As-of {asOfLabel} ({asOfDate}) · Plan: {planMode === "remaining" ? "Remaining" : "Baseline"} · Range {rangeDays}d
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
                onValueChange={(v) => v && setSearch({ plot: v as "all" | "C" | "D" })}
                className="gap-1"
              >
                <ToggleGroupItem value="all" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem value="C" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Plot C
                </ToggleGroupItem>
                <ToggleGroupItem value="D" className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Plot D
                </ToggleGroupItem>
              </ToggleGroup>
            </ToolbarGroup>

            <ToolbarGroup label="Team">
              <div className="flex items-center gap-3">
                <ToggleGroup
                  type="multiple"
                  value={teams}
                  onValueChange={(v) => {
                    const next = (v as AbdTeam[]).filter((x) => TEAM_VALUES.includes(x));
                    setSearch({ teams: next.join(",") });
                  }}
                  className="gap-1"
                >
                  {ABD_TEAMS.map((t) => (
                    <ToggleGroupItem
                      key={t.value}
                      value={t.value}
                      className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {t.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {teams.length === 0 && <span className="text-[11px] text-muted-foreground">(전체)</span>}
              </div>
            </ToolbarGroup>

            <ToolbarGroup label="Stage">
              <ToggleGroup
                type="multiple"
                value={isAllStages ? [...ALL_STAGES] : effectiveStages}
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
                    {STAGE_SHORT_LABELS[s]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ToolbarGroup>
          </div>

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

            <ToolbarGroup label="Round">
              <ToggleGroup
                type="single"
                value={round}
                onValueChange={(v) => v && setSearch({ round: v as RoundKey })}
                className="gap-1"
              >
                {(["all", "R1", "R2", "R3"] as const).map((r) => (
                  <ToggleGroupItem
                    key={r}
                    value={r}
                    className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {r === "all" ? "All" : r}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ToolbarGroup>

            <div className="flex items-center gap-2">
              <Switch
                id="hidepast-abd"
                checked={hidePast}
                onCheckedChange={(c) => setSearch({ hidePast: c ? 1 : 0 })}
              />
              <Label htmlFor="hidepast-abd" className="text-xs">
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

      {/* KPI Strip — stage_group 7카드 (재고 · 지연 · 팀 분해) */}
      <AbdStageGroupStrip
        plots={plotsForDash}
        teams={teams}
        onOpenRaw={({ status, team }) =>
          openRaw(team ? { status, tab: team } : { status })
        }
      />

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
                  <AbdScheduleMatrix
                    data={matrix}
                    bucket={bucket}
                    stagesToShow={effectiveStages}
                    today={today}
                    asOfLabel={asOfLabel}
                    groupHeader={groupHeader}
                    onCellClick={handleCellClick}
                  />
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
          <AbdPlanVsActualCard
            cellsByRound={cellsByRound}
            activeRounds={activeRounds}
            buckets={buckets}
            stages={effectiveStages}
            today={today}
            open={scurveOpen}
            onOpenChange={(v) => setSearch({ scurveOpen: v ? 1 : 0 })}
            baselinesByRound={baselinesByRound}
          />
        </>
      )}
    </div>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-l pl-3 first:border-l-0 first:pl-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
