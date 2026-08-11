import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
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
import { useAbdTeamList } from "@/hooks/useAbdTeamList";
import {
  ALL_GROUP_BY,
  ALL_STAGES,
  GROUP_LABELS,
  STAGE_SHORT_LABELS,
  type Bucket,
  type GroupBy,
  type PlanMode,
  type Stage,
  addDays,
  assembleMatrix,
  groupKeyToRawParams,
  todayIso,
} from "@/lib/abd/progress-utils";
import { useAbdScurveData } from "@/hooks/useAbdScurveData";
import { AbdStageGroupStrip } from "@/components/abd/progress/AbdStageGroupStrip";
import { AbdScheduleMatrix } from "./AbdScheduleMatrix";
import { Route } from "@/routes/_authenticated/closure/abd/progress";
import { AbdPlanVsActualCard } from "./AbdPlanVsActualCard";
import { ChevronDown, ChevronRight, LayoutGrid } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CardHeader, CardTitle } from "@/components/ui/card";

const FALLBACK_TEAMS = ABD_TEAMS.map((t) => t.value) as string[];

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
  // 팀 탭 정본: 실측 distinct(abd_team_list). 로딩 전에는 상수 폴백.
  const { data: teamList } = useAbdTeamList();
  const TEAM_VALUES = useMemo(
    () => ((teamList && teamList.length > 0 ? teamList : FALLBACK_TEAMS) as AbdTeam[]),
    [teamList],
  );
  const teams = parseCsv<AbdTeam>(search.teams, TEAM_VALUES);
  // Round 필터 제거 — 항상 전 라운드(컬럼 UNION) 집계.
  // RPC 시그니처 호환을 위해 _round 파라미터는 유지하되 항상 "all" 로 호출한다.
  const round = "all" as const;
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
  const asOfLabel = asofMode === "today" ? "Today" : "As of";

  // 데이터 정본은 훅 하나 — 프로젝트 대시보드와 동일한 계산을 쓴다.
  const {
    buckets,
    cellsQ,
    totalsQ,
    baselines: scurveBaselines,
    cum: scurveCum,
  } = useAbdScurveData({
    plot,
    teams,
    groupBy: effectiveGroupBy,
    bucket,
    planMode,
    asOfDate,
    rangeDays,
    scurveEnabled: scurveOpen,
  });


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
      stages: Object.fromEntries(
        ALL_STAGES.map((st) => [st, { ...r.stages[st], cells: r.stages[st].cells.slice(startIdx) }]),
      ) as typeof r.stages,
    }));
    return { buckets: newBuckets, rows };
  }, [cellsQ.data, totalsQ.data, buckets, effectiveStages, hidePast, today]);

  // KPI 스트립은 stage_group 정본(abd_stage_group_counts, RPC 1회)으로 전환됨.

  const groupHeader = effectiveGroupBy.map((g) => GROUP_LABELS[g]).join(" · ");

  const plotsForDash = plot === "all" ? [] : [plot];

  const openRaw = (params: Record<string, string> = {}) => {
    const s: Record<string, string> = { source: "progress", ...params };
    if (plot !== "all" && !("plot" in s)) s.plot = plot;
    if (!("tab" in s)) s.tab = teams.length > 0 ? teams.join(",") : TEAM_VALUES.join(",");
    // Progress 모집단(Terminated 포함)과 동일하게 맞춘다.
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
    // 셀의 그룹 행이 team/plot 으로 좁혀져 있으면 전역 선택값보다 행 값을 우선한다.
    // 그렇지 않으면 MECH 행 클릭도 선택된 전체 팀으로 열려 Matrix보다 과대 조회된다.
    const rowTeam = g.team && g.team !== "__EMPTY__" ? g.team : null;
    const rowPlot = g.plot === "C" || g.plot === "D" ? g.plot : null;
    params.set("tab", rowTeam ?? (teams.length > 0 ? teams.join(",") : TEAM_VALUES.join(",")));
    params.set("plot", rowPlot ?? plot);
    // Progress 집계는 Terminated 포함이 업무 규칙. Raw 기본은 hide 라 모집단이
    // 어긋나므로 명시적으로 all 을 지정한다.
    // 매트릭스가 보던 As-of 를 명시 전달(세션 공유 의존 금지).
    params.set("asOf", asOfDate);
    // AP(Approval) 실적만 approval_date + sg_approved 경로 유지.
    // 그 외(P 전부 + 라운드 스테이지 A)는 셀 술어 정본(abd_progress_events) 경유.
    if (stage === "approval" && field === "actual") {
      params.set("dateStart", dateFrom);
      params.set("dateEnd", dateTo);
      params.set("dateField", "approval_date");
      // AP actual = approval_date AND stage_group='APPROVED' (현재 승인 유효분).
      // 재개봉(과거 승인 → 현재 B/C/UR)·Terminated 는 집계에서 제외되므로
      // 드릴다운도 동일 렌즈를 적용해 카드·매트릭스·리스트 삼자 일치를 유지한다.
      params.set("status", "sg_approved");
    } else {
      // 술어 정본 = abd_progress_events (rn ≤/= v_active, AP는 ap_plan 이동 예측).
      // 집계행(stage='all')은 화면에 표시 중인 스테이지 조합을 그대로 전달한다.
      params.set("cellStage", stage === "all" ? effectiveStages.join(",") : stage);
      params.set("cellField", field);
      params.set("cellFrom", dateFrom);
      params.set("cellTo", dateTo);
      params.set("cellMode", planMode);
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
              mode="datadate"
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
                    const next = (v as AbdTeam[]).filter((x) => (TEAM_VALUES as string[]).includes(x));
                    setSearch({ teams: next.join(",") });
                  }}
                  className="gap-1"
                >
                  {TEAM_VALUES.map((t) => (
                    <ToggleGroupItem
                      key={t}
                      value={t}
                      className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {t}
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
                  As of
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
        asOf={asOfDate === today ? null : asOfDate}
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
            cells={cellsQ.data ?? []}
            buckets={buckets}
            stages={effectiveStages}
            today={today}
            open={scurveOpen}
            onOpenChange={(v) => setSearch({ scurveOpen: v ? 1 : 0 })}
            baselines={scurveBaselines}
            cum={scurveCum}
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
