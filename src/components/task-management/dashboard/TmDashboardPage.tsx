import { useEffect, useMemo } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
import { useTaskDashboardData, getLatestDataDate } from "@/hooks/useTaskDashboardData";
import { useTmAsOf } from "@/hooks/useTmAsOf";
import {
  todayIso,
  type TaskItem,
} from "@/lib/task-management/schedule-utils";
import { TmKpiCards } from "./TmKpiCards";

const DISCIPLINE_KEYS = ["ARCH", "MECH", "ELEC", "DESN", "PRJC", "SUPP"] as const;
const TASK_SCOPE_OPTIONS = [
  { value: "main", label: "Main Task" },
  { value: "sub", label: "Sub Task" },
] as const;
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import { useTmRowsAsOf } from "@/hooks/useTmRowsAsOf";
import { OwnerQuickFilterPills } from "./OwnerQuickFilterPills";
import { JudgmentStageBreakdown } from "./JudgmentStageBreakdown";
import { JudgmentDonut } from "./JudgmentDonut";
import { computeJudgmentStageBreakdown } from "@/lib/task-management/delay-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { resolveJudgment, resolveIsDelayed } from "@/lib/task-management/delay-utils";
import { todayInDoha } from "@/lib/time/doha";

const routeApi = getRouteApi("/_authenticated/closure/task-management/dashboard");

const DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "악화만" },
] as const;

const PLOT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
  { value: "G", label: "G" },
] as const;

function uniqSorted(items: TaskItem[], field: keyof TaskItem): string[] {
  const s = new Set<string>();
  for (const it of items) {
    const v = it[field];
    if (typeof v === "string" && v.trim()) s.add(v.trim());
  }
  return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
}

export function TmDashboardPage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate();

  // 세션 전역 As-of (Raw Data/Task Summary/MWS 등과 공유)
  const [sharedDataDate, setSharedDataDate] = useTmAsOf();
  const today = todayInDoha();
  const selectedDataDate = sharedDataDate || today;
  const asOfDate = selectedDataDate;

  // 행 소스 = 정본 tm_rows_as_of(as-of) 단일. 실적 마스킹·정본 판정·Main 가중 계획 포함.
  const { data: items = [], isLoading } = useTaskDashboardData(
    {
      disciplines: search.discipline,
      plots: search.plot,
      teams: search.team,
      hdecPic: search.hdecPic,
      hdecEng: search.hdecEng,
      level: "all",
      q: search.q,
    },
    asOfDate,
  );

  const latestDataDate = getLatestDataDate(items) ?? todayIso();

  // items에 존재하는 고유 data_date 목록 (최신순)
  const dataDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const d = (it as unknown as { data_date?: string | null }).data_date;
      if (d) set.add(String(d).slice(0, 10));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [items]);

  // 구 딥링크 URL ?dataDate= 는 수용 후 무시(U5).
  useEffect(() => {
    if (search.dataDate) patch({ dataDate: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.dataDate]);
  // 판정 기준일 라벨. 행별 관측 컷오프(data_date)와 구분한다.
  const asOfLabel = "As of";

  // 행에는 이미 srv_judgment/srv_plan_pct/srv_actual_pct 가 부착되어 있다(useTmAsOfRows).
  const effectiveItems = items;

  // 계산은 항상 Sub 기준(기본값). Main 은 명시 선택 시에만.
  const taskScope: TaskScope = search.taskScope === "main" ? "main" : "sub";

  const scopedByTaskScope = useMemo(() => scopeItems(effectiveItems, taskScope), [effectiveItems, taskScope]);

  // 정본 thresholds — KPI/Raw Data 와 동일 소스. 미전달 시 DEFAULT 폴백으로 판정이 어긋남.
  const { data: thresholdsData } = useTaskManagementSettings();
  const thresholds = thresholdsData ?? DEFAULT_THRESHOLDS;

  // Facet options — derived from ALL loaded items (respect discipline/plot filter for owners).
  const teamOptions = useMemo(() => uniqSorted(items, "team"), [items]);
  const picOptions = useMemo(() => uniqSorted(items, "hdec_pic_name"), [items]);
  const engOptions = useMemo(() => uniqSorted(items, "hdec_eng_name"), [items]);

  // 지연 필터 3종 분할 — 서버 as-of 정본 판정 사용 (없으면 클라 폴백)
  const scopedItems = useMemo(() => {
    const base = scopedByTaskScope;
    if (search.delayFilter === "risk")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "악화");
    if (search.delayFilter === "delayed")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "지연");
    // 전체 = 지연 + 악화
    return base.filter((it) => resolveIsDelayed(it, thresholds, asOfDate));
  }, [scopedByTaskScope, search.delayFilter, thresholds, asOfDate]);

  const patch = (obj: Record<string, unknown>) =>
    navigate({
      to: "/closure/task-management/dashboard",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...obj }) as any,
    });

  const disciplines = search.discipline ?? [];
  const totalItems = effectiveItems.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Sticky top region: header + toolbar */}
      <div className="sticky top-0 z-30 -mx-4 -mt-4 flex flex-col gap-3 bg-background/95 px-4 pt-4 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/closure/task-management/tree" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            Task Management Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {asOfHeaderLabel(selectedDataDate, today)}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {totalItems.toLocaleString()} items
          </span>
        </div>
      </div>

      {/* Unified Toolbar */}
      <Card className="bg-background">
        <CardContent className="flex flex-col gap-2 p-3">
          {/* Row 1: As of · Task · Discipline · Delay · Search */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <DataDatePicker
              quickAsOf
              value={sharedDataDate}
              latest={latestDataDate}
              options={dataDateOptions}
              onChange={(v) => setSharedDataDate(v)}
              onReset={() => setSharedDataDate("")}
              showDataDateChip
            />

            <span className="h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Task
              </span>
              <ToggleGroup
                type="single"
                value={taskScope}
                onValueChange={(v) => {
                  if (v === "main" || v === "sub") patch({ taskScope: v });
                }}
                className="gap-1"
              >
                {TASK_SCOPE_OPTIONS.map((o) => (
                  <ToggleGroupItem
                    key={o.value}
                    value={o.value}
                    className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {o.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Discipline
              </span>
              <ToggleGroup
                type="multiple"
                value={disciplines}
                onValueChange={(v) => patch({ discipline: v })}
                className="gap-1"
              >
                {DISCIPLINE_KEYS.map((k) => (
                  <ToggleGroupItem
                    key={k}
                    value={k}
                    className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  >
                    {k}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <span className="h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                지연 필터
              </span>
              <Tabs value={search.delayFilter} onValueChange={(v) => patch({ delayFilter: v })}>
                <TabsList className="h-8">
                  {DELAY_FILTER_OPTIONS.map((o) => (
                    <TabsTrigger key={o.value} value={o.value} className="h-6 px-2 text-xs">
                      {o.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <span className="h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Plot
              </span>
              <Tabs
                value={(search.plot ?? []).length === 1 ? String(search.plot[0]) : "all"}
                onValueChange={(v) => patch({ plot: v === "all" ? [] : [v] })}
              >
                <TabsList className="h-8">
                  {PLOT_OPTIONS.map((o) => (
                    <TabsTrigger key={o.value} value={o.value} className="h-6 px-2 text-xs">
                      {o.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <OwnerQuickFilterPills
              teamOptions={teamOptions}
              picOptions={picOptions}
              engOptions={engOptions}
              team={search.team}
              hdecPic={search.hdecPic}
              hdecEng={search.hdecEng}
              onChange={patch}
            />

            <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                value={search.q}
                placeholder="task_no / 이름 / 담당"
                className="h-8 w-full text-xs sm:w-56"
                onChange={(e) => patch({ q: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* KPI Cards (SHAW Punch style) */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <TmKpiCards
          items={effectiveItems}
          asOfDate={asOfDate}
          taskScope={taskScope}
          onScopeChange={(v) => patch({ taskScope: v })}
          disciplines={search.discipline ?? []}
          onDisciplinesChange={(v) => patch({ discipline: v })}
          ownerContext={{
            team: search.team,
            hdec_pic_name: search.hdecPic,
            hdec_eng_name: search.hdecEng,
            discipline: search.discipline,
            plot: search.plot,
            q: search.q,
          }}
          statusMixSideSlot={
            <JudgmentStageBreakdown items={scopedItems} asOfDate={asOfDate} compact />
          }
          statusMixLeftExtraSlot={
            <JudgmentDonut
              // 분포 패널은 지연 탭 필터를 타지 않는다 — 모집단(taskScope 적용 전체) 기준.
              counts={computeJudgmentStageBreakdown(scopedByTaskScope, asOfDate).judgmentCounts}
              population={scopedByTaskScope.length}
            />
          }
        />
      )}

      {!isLoading && items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/60" />
            현재 조건에 해당하는 태스크가 없습니다.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}