import { useMemo } from "react";
import { Link, useNavigate, getRouteApi } from "@tanstack/react-router";
import { Calendar as CalendarIcon, ChevronsLeft, ChevronsRight, TrendingUp, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { useTaskDashboardData, getLatestDataDate } from "@/hooks/useTaskDashboardData";
import {
  ALL_TASK_GROUP_KEYS,
  ALL_TASK_STAGE_KEYS,
  TASK_GROUP_LABELS,
  TASK_GROUP_QUERY_PARAM,
  addDays,
  aggregateTaskSchedule,
  findTaskCritical,
  findTaskLaggingGroups,
  getTaskStageKeys,
  isTaskStageActualUpTo,
  isTaskStageDelayedAsOf,
  isTaskStagePlannedOn,
  isTaskStagePlannedUpTo,
  todayIso,
  type TaskCriticalItem,
  type TaskScheduleBucket,
  type TaskScheduleGroupBy,
  type TaskScheduleStage,
  type TaskScheduleStageFilter,
  type TaskPlanMode,
} from "@/lib/task-management/schedule-utils";
import { PlanVsActualMatrix } from "./PlanVsActualMatrix";
import { CriticalWatchlist } from "./CriticalWatchlist";
import { KpiStrip, ScheduleLegend } from "./KpiStrip";
import { JudgmentDonut } from "./JudgmentDonut";
import { BehindScheduleTable } from "./BehindScheduleTable";
import { DISCIPLINES, PLOTS } from "@/lib/task-management/columns";

const routeApi = getRouteApi("/_authenticated/closure/dashboard/task");

interface Props {
  compact?: boolean;
}

export function TaskDashboardPage({ compact = false }: Props) {
  const search = routeApi.useSearch();
  const navigate = useNavigate();
  const today = useMemo(() => todayIso(), []);

  const groupBy: TaskScheduleGroupBy[] = search.group.length > 0 ? search.group : ["discipline"];
  const groupBySpec = groupBy.length === 1 ? groupBy[0] : groupBy;
  const primaryGroup: TaskScheduleGroupBy = groupBy[0] ?? "discipline";
  const groupHeaderLabel = groupBy.map((g) => TASK_GROUP_LABELS[g]).join(" · ");

  const bucket: TaskScheduleBucket = search.bucket;
  const isAllGroups = groupBy.length === ALL_TASK_GROUP_KEYS.length;
  const stageFilter: TaskScheduleStage[] = search.stageView.length > 0 ? search.stageView : [...ALL_TASK_STAGE_KEYS];
  const isAllStages = stageFilter.length === ALL_TASK_STAGE_KEYS.length;
  const stageFilterArg: TaskScheduleStageFilter = isAllStages
    ? "all"
    : stageFilter.length === 1
      ? stageFilter[0]
      : stageFilter;

  const asOfMode = search.asofMode;
  const planMode: TaskPlanMode = search.planMode;
  const rangeDays = search.range;
  const hidePast = search.hidePast;
  const showRiskPanel = search.riskPanel;

  const { data: items = [], isLoading } = useTaskDashboardData({
    disciplines: search.discipline,
    plots: search.plot,
    teams: search.team,
    level: "child",
    q: search.q,
  });

  const latestDataDate = getLatestDataDate(items) ?? today;
  const asOfDate = asOfMode === "dataDate" ? latestDataDate : today;
  const asOfLabel = asOfMode === "dataDate" ? "Data Date" : "Today";

  const rangeStart = useMemo(() => addDays(today, -14), [today]);
  const rangeEnd = useMemo(() => addDays(today, rangeDays), [today, rangeDays]);

  const aggregate = useMemo(
    () =>
      aggregateTaskSchedule(items, {
        groupBy: groupBySpec,
        bucket,
        stageFilter: stageFilterArg,
        rangeStart,
        rangeEnd,
        asOfDate,
        planMode,
      }),
    [items, groupBySpec, bucket, stageFilterArg, rangeStart, rangeEnd, asOfDate, planMode],
  );

  const critical = useMemo(
    () => findTaskCritical(items, today, 7, primaryGroup),
    [items, today, primaryGroup],
  );
  const lagging = useMemo(() => findTaskLaggingGroups(aggregate.rows, 5), [aggregate.rows]);

  const visibleData = useMemo(() => {
    if (!hidePast) return aggregate;
    const startIdx = aggregate.buckets.findIndex((b) => b >= today);
    if (startIdx <= 0) return aggregate;
    const buckets = aggregate.buckets.slice(startIdx);
    const rows = aggregate.rows.map((r) => ({
      ...r,
      combined: r.combined.slice(startIdx),
      stages: {
        start: { ...r.stages.start, cells: r.stages.start.cells.slice(startIdx) },
        completion: { ...r.stages.completion, cells: r.stages.completion.cells.slice(startIdx) },
      },
    }));
    return { ...aggregate, buckets, rows };
  }, [aggregate, hidePast, today]);

  // ── KPI ──
  const kpis = useMemo(() => {
    const stages = getTaskStageKeys(stageFilterArg);
    let cumPlan = 0;
    let cumActual = 0;
    let totalStages = 0;
    let doneStages = 0;
    for (const s of items) {
      totalStages += stages.length;
      for (const st of stages) {
        const doneAsOf = isTaskStageActualUpTo(s, st, asOfDate);
        const countPlan =
          isTaskStagePlannedUpTo(s, st, asOfDate) && (planMode === "baseline" || !doneAsOf);
        if (countPlan) cumPlan++;
        if (doneAsOf) {
          cumActual++;
          doneStages++;
        }
      }
    }
    const variance = cumPlan ? ((cumActual - cumPlan) / cumPlan) * 100 : 0;
    const progressPct = totalStages ? (doneStages / totalStages) * 100 : 0;
    const overdue = items.reduce(
      (count, s) => count + stages.filter((st) => isTaskStageDelayedAsOf(s, st, asOfDate)).length,
      0,
    );
    const upcomingEnd = addDays(today, 7);
    let upcoming7Plan = 0;
    for (const s of items) {
      for (const st of stages) {
        if (planMode === "remaining" && isTaskStageActualUpTo(s, st, today)) continue;
        for (let d = today; d <= upcomingEnd; d = addDays(d, 1)) {
          if (isTaskStagePlannedOn(s, st, d)) upcoming7Plan++;
        }
      }
    }
    return {
      cumPlan,
      cumActual,
      variance,
      progressPct,
      doneStages,
      totalStages,
      overdue,
      criticalCount: critical.highRisk.length,
      upcoming7Plan,
    };
  }, [items, stageFilterArg, asOfDate, planMode, today, critical.highRisk.length]);

  const judgmentCounts = useMemo(() => {
    const out: Record<string, number> = { 완료: 0, 정상: 0, 주의: 0, 지연: 0, 위험: 0 };
    for (const r of items) {
      const j = r.auto_judgment ?? "";
      if (out[j] != null) out[j]++;
    }
    return out;
  }, [items]);

  // ── Navigation helpers ──
  const goRaw = (params: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    navigate({ to: "/closure/task-management/raw-data", search: Object.fromEntries(sp) as any });
  };

  const groupKeyToParams = (rowKey: string): Record<string, string> => {
    const parts = rowKey.split(" · ");
    const out: Record<string, string> = {};
    groupBy.forEach((dim, i) => {
      const raw = parts[i];
      if (raw && raw !== "(None)") out[TASK_GROUP_QUERY_PARAM[dim]] = raw;
    });
    return out;
  };

  const handleCellClick = (
    groupKey: string,
    bucketIso: string,
    stage: TaskScheduleStage | "all",
    field: "planned" | "actual",
  ) => {
    const params: Record<string, string> = { ...groupKeyToParams(groupKey) };
    const dateFrom = bucketIso;
    const dateTo = bucket === "week" ? addDays(bucketIso, 6) : bucketIso;
    params.dateStart = dateFrom;
    params.dateEnd = dateTo;
    if (stage !== "all") params.stage = stage;
    params.dateField = field === "planned" ? "plan_end" : "actual_start";
    goRaw(params);
  };

  const handleCriticalClick = (item: TaskCriticalItem) => {
    goRaw({ q: item.taskNo });
  };
  const handleGroupClick = (label: string) => goRaw(groupKeyToParams(label));

  // ── URL updaters ──
  const patch = (obj: Record<string, unknown>) =>
    navigate({
      to: "/closure/dashboard/task",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...obj }) as any,
    });

  if (compact) {
    // Overview 축약 뷰
    return (
      <div className="space-y-3">
        <KpiStrip
          values={kpis}
          asOfLabel={asOfLabel}
          onOverdueClick={() => navigate({ to: "/closure/dashboard/task" })}
        />
        <JudgmentDonut counts={judgmentCounts} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/closure/dashboard" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <TrendingUp className="h-5 w-5 text-primary" />
              Task Progress Dashboard
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            {groupHeaderLabel} 기준 · {bucket === "day" ? "일간" : "주간"} 뷰 · Data Date{" "}
            {latestDataDate} · Today {today} · As-of {asOfLabel} · Plan:{" "}
            {planMode === "remaining" ? "Remaining" : "Baseline"} · Rows {items.length.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <ToolbarGroup label="Group">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={isAllGroups ? "default" : "outline"}
                className="h-8 px-2 text-xs"
                onClick={() => patch({ group: [...ALL_TASK_GROUP_KEYS] })}
              >
                All
              </Button>
              <ToggleGroup
                type="multiple"
                value={isAllGroups ? [] : groupBy}
                onValueChange={(vals) => {
                  const next = (vals as TaskScheduleGroupBy[]).filter((v) =>
                    (ALL_TASK_GROUP_KEYS as string[]).includes(v),
                  );
                  if (next.length === 0) return patch({ group: ["discipline"] });
                  patch({ group: ALL_TASK_GROUP_KEYS.filter((k) => next.includes(k)) });
                }}
                className="flex-wrap gap-1"
              >
                {ALL_TASK_GROUP_KEYS.map((k) => (
                  <ToggleGroupItem
                    key={k}
                    value={k}
                    className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {TASK_GROUP_LABELS[k]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </ToolbarGroup>

          <ToolbarGroup label="공종">
            <MultiSelectChips
              options={DISCIPLINES as unknown as string[]}
              value={search.discipline}
              onChange={(v) => patch({ discipline: v })}
            />
          </ToolbarGroup>

          <ToolbarGroup label="Plot">
            <MultiSelectChips
              options={PLOTS as unknown as string[]}
              value={search.plot}
              onChange={(v) => patch({ plot: v })}
            />
          </ToolbarGroup>

          <ToolbarGroup label="Bucket">
            <Tabs value={bucket} onValueChange={(v) => patch({ bucket: v })}>
              <TabsList className="h-8">
                <TabsTrigger value="day" className="h-6 px-2 text-xs">
                  Day
                </TabsTrigger>
                <TabsTrigger value="week" className="h-6 px-2 text-xs">
                  Week
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </ToolbarGroup>

          <ToolbarGroup label="Stage">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={isAllStages ? "default" : "outline"}
                className="h-8 px-2 text-xs"
                onClick={() => patch({ stageView: [...ALL_TASK_STAGE_KEYS] })}
              >
                All
              </Button>
              <ToggleGroup
                type="multiple"
                value={isAllStages ? [] : stageFilter}
                onValueChange={(vals) => {
                  const next = (vals as TaskScheduleStage[]).filter((v) =>
                    (ALL_TASK_STAGE_KEYS as string[]).includes(v),
                  );
                  if (next.length === 0) return patch({ stageView: [...ALL_TASK_STAGE_KEYS] });
                  patch({ stageView: ALL_TASK_STAGE_KEYS.filter((k) => next.includes(k)) });
                }}
                className="gap-1"
              >
                <ToggleGroupItem
                  value="start"
                  className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  Start
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="completion"
                  className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  Comp
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </ToolbarGroup>

          <ToolbarGroup label="As-of">
            <Tabs value={asOfMode} onValueChange={(v) => patch({ asofMode: v })}>
              <TabsList className="h-8">
                <TabsTrigger value="dataDate" className="h-6 px-2 text-xs">
                  Data Date
                </TabsTrigger>
                <TabsTrigger value="today" className="h-6 px-2 text-xs">
                  Today
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </ToolbarGroup>

          <ToolbarGroup label="Range">
            <Select value={String(rangeDays)} onValueChange={(v) => patch({ range: Number(v) })}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
              </SelectContent>
            </Select>
          </ToolbarGroup>

          <ToolbarGroup label="검색">
            <Input
              value={search.q}
              placeholder="task_no / 이름 / 담당"
              className="h-8 w-48 text-xs"
              onChange={(e) => patch({ q: e.target.value })}
            />
          </ToolbarGroup>

          <div className="ml-auto flex items-center gap-3 text-xs">
            <ScheduleLegend />
          </div>
        </CardContent>
      </Card>

      {/* KPI */}
      <KpiStrip values={kpis} asOfLabel={asOfLabel} />

      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={planMode}
            onValueChange={(v) => {
              if (v === "baseline" || v === "remaining") patch({ planMode: v });
            }}
            className="gap-1"
          >
            <ToggleGroupItem
              value="remaining"
              className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Remaining
            </ToggleGroupItem>
            <ToggleGroupItem
              value="baseline"
              className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              Baseline
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-[10px] text-muted-foreground">
            {planMode === "remaining" ? "완료된 계획 제외" : "전체 계획 포함"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => patch({ hidePast: !hidePast })}
          >
            {hidePast ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
            <span className="ml-1">{hidePast ? "과거 표시" : "과거 숨김"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => patch({ riskPanel: !showRiskPanel })}
          >
            {showRiskPanel ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
            <span className="ml-1">{showRiskPanel ? "Risk 숨김" : "Risk 표시"}</span>
          </Button>
        </div>
      </div>

      {/* Matrix + Watchlist */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <Skeleton className="h-[500px] w-full" />
          ) : (
            <PlanVsActualMatrix
              data={visibleData}
              bucket={bucket}
              stageFilter={stageFilterArg}
              today={today}
              asOfLabel={asOfLabel}
              groupHeader={groupHeaderLabel}
              onCellClick={handleCellClick}
            />
          )}
        </div>
        {!isLoading && showRiskPanel && (
          <CriticalWatchlist
            highRisk={critical.highRisk}
            bottleneck={critical.bottleneck}
            lagging={lagging}
            onItemClick={handleCriticalClick}
            onGroupClick={handleGroupClick}
          />
        )}
      </div>

      {/* Supplementary widgets */}
      <div className="grid gap-4 lg:grid-cols-2">
        <JudgmentDonut counts={judgmentCounts} />
        <BehindScheduleTable items={items} />
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <CalendarIcon className="h-3 w-3" />
        모든 수치는 Raw Data 테이블과 동일한 컬럼 · 판정 규칙을 사용합니다.
      </div>
    </div>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full sm:w-auto items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function MultiSelectChips({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      value={value}
      onValueChange={(v) => onChange(v as string[])}
      className="gap-1"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}