import { useEffect, useMemo, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CalendarDays, RotateCcw, Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskDashboardData, getLatestDataDate } from "@/hooks/useTaskDashboardData";
import { useTmDataDate } from "@/hooks/useTmDataDate";
import {
  ALL_TASK_TIMELINE_STAGE_KEYS,
  isTaskStageDelayedAsOf,
  todayIso,
  type TaskItem,
} from "@/lib/task-management/schedule-utils";
import {
  computeDelayTopN,
  type OwnerDim,
  type OwnerLeaderboardRow,
} from "@/lib/task-management/delay-utils";
import { TmKpiCards } from "./TmKpiCards";

const DISCIPLINE_KEYS = ["ARCH", "MECH", "ELEC", "DESN", "PRJC", "SUPP"] as const;
const TASK_SCOPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "main", label: "Main Task" },
  { value: "sub", label: "Sub Task" },
] as const;
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import { useTmJudgmentAtDate } from "@/hooks/useTmJudgmentAtDate";
import { OwnerQuickFilterPills } from "./OwnerQuickFilterPills";
import { DelayTopTable } from "./DelayTopTable";
import { OwnerLeaderboardCard } from "./OwnerLeaderboardCard";
import { JudgmentStageBreakdown } from "./JudgmentStageBreakdown";
import { JudgmentDonut } from "./JudgmentDonut";
import { computeJudgmentStageBreakdown } from "@/lib/task-management/delay-utils";
import { OwnerDetailDialog } from "./OwnerDetailDialog";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { todayInDoha } from "@/lib/time/doha";

const routeApi = getRouteApi("/_authenticated/closure/task-management/dashboard");

const DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "악화만" },
] as const;

function isOwnerDim(v: string): v is OwnerDim {
  return v === "team" || v === "hdec_pic_name" || v === "hdec_eng_name";
}

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

  const { data: items = [], isLoading } = useTaskDashboardData({
    disciplines: search.discipline,
    plots: search.plot,
    teams: search.team,
    hdecPic: search.hdecPic,
    hdecEng: search.hdecEng,
    level: "all",
    q: search.q,
  });

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

  // 세션 전역 Data Date (Raw Data/MWS 등과 공유)
  const [sharedDataDate, setSharedDataDate] = useTmDataDate();
  // As-of 단일 규칙: 선택값 없으면 오늘(Asia/Qatar). data_date 폴백 금지.
  const selectedDataDate =
    (search.dataDate && search.dataDate.length ? search.dataDate : sharedDataDate) ||
    todayInDoha();

  // 세션 상태 동기화 — 선택이 최신과 다르면 저장, 최신이면 초기화
  useEffect(() => {
    const next = selectedDataDate === latestDataDate ? "" : selectedDataDate;
    if (next !== sharedDataDate) setSharedDataDate(next);
     
  }, [selectedDataDate, latestDataDate]);
  const asOfDate = selectedDataDate;
  // 판정 기준일 라벨. 행별 관측 컷오프(data_date)와 구분한다.
  const asOfLabel = "As of";

  // 과거 Data Date 선택 시 서버측 재판정 RPC(tm_judge_at_date) 결과를 병합.
  // Actual% 는 절대 덮어쓰지 않는다 — Plan/gap/judgment 만 as-of 재계산.
  const isPastDate = asOfDate.slice(0, 10) < latestDataDate.slice(0, 10);
  const judge = useTmJudgmentAtDate(asOfDate, isPastDate);
  const effectiveItems = useMemo(() => {
    if (!isPastDate || !judge.ready) return items;
    return items.map((it) => {
      const j = judge.map.get(it.id);
      if (!j) return it;
      return {
        ...it,
        auto_judgment: j.auto_judgment ?? null,
        gap_pct: j.gap_pct ?? null,
        cum_plan_pct: j.cum_plan_pct ?? null,
        delay_days: j.delay_days ?? null,
        alarm_reason: j.alarm_reason ?? null,
      } as typeof it;
    });
  }, [items, isPastDate, judge.ready, judge.map]);

  const ownerDim: OwnerDim = isOwnerDim(search.ownerDim) ? search.ownerDim : "hdec_pic_name";

  const taskScope: TaskScope =
    search.taskScope === "main" || search.taskScope === "sub" ? search.taskScope : "all";

  const scopedByTaskScope = useMemo(() => scopeItems(effectiveItems, taskScope), [effectiveItems, taskScope]);

  // 정본 thresholds — KPI/Raw Data 와 동일 소스. 미전달 시 DEFAULT 폴백으로 판정이 어긋남.
  const { data: thresholdsData } = useTaskManagementSettings();
  const thresholds = thresholdsData ?? DEFAULT_THRESHOLDS;

  const [ownerDetail, setOwnerDetail] = useState<{
    dim: OwnerDim;
    key: string;
    row: OwnerLeaderboardRow;
  } | null>(null);

  // Facet options — derived from ALL loaded items (respect discipline/plot filter for owners).
  const teamOptions = useMemo(() => uniqSorted(items, "team"), [items]);
  const picOptions = useMemo(() => uniqSorted(items, "hdec_pic_name"), [items]);
  const engOptions = useMemo(() => uniqSorted(items, "hdec_eng_name"), [items]);

  const scopedItems = useMemo(() => {
    const base = scopedByTaskScope;
    if (search.delayFilter === "all") return base;
    return base.filter((it) => {
      if (search.delayFilter === "risk") return it.auto_judgment === "악화";
      if (it.auto_judgment === "지연" || it.auto_judgment === "악화") return true;
      for (const st of ALL_TASK_TIMELINE_STAGE_KEYS) {
        if (isTaskStageDelayedAsOf(it, st, asOfDate)) return true;
      }
      return false;
    });
  }, [scopedByTaskScope, search.delayFilter, asOfDate]);

  const delayTop = useMemo(
    () => computeDelayTopN(scopedItems, asOfDate, 20, thresholds),
    [scopedItems, asOfDate, thresholds],
  );

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
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {totalItems.toLocaleString()} items
        </span>
      </div>

      {/* Unified Toolbar */}
      <Card className="bg-background">
        <CardContent className="flex flex-col gap-2 p-3">
          {/* Row 1: As of · Task · Discipline · Delay · Search */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                As of
              </span>
              <Select
                value={selectedDataDate}
                onValueChange={(v) => patch({ dataDate: v })}
              >
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder={latestDataDate} />
                </SelectTrigger>
                <SelectContent>
                  {(dataDateOptions.length ? dataDateOptions : [latestDataDate]).map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                      {d === latestDataDate && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(최신)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDataDate !== latestDataDate && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => patch({ dataDate: "" })}
                  aria-label="최신 As of로 초기화"
                  title="최신으로"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <span className="h-5 w-px bg-border" aria-hidden />

            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Task
              </span>
              <ToggleGroup
                type="single"
                value={taskScope}
                onValueChange={(v) => {
                  if (v === "all" || v === "main" || v === "sub") patch({ taskScope: v });
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

          {/* Row 2: Owner axis pills */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
            <OwnerQuickFilterPills
              teamOptions={teamOptions}
              picOptions={picOptions}
              engOptions={engOptions}
              team={search.team}
              hdecPic={search.hdecPic}
              hdecEng={search.hdecEng}
              onChange={patch}
            />
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
              counts={computeJudgmentStageBreakdown(scopedItems, asOfDate).judgmentCounts}
            />
          }
        />
      )}

      {isLoading ? (
        <Skeleton className="h-[600px] w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/60" />
            현재 조건에 해당하는 태스크가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top row: 지연 Top + Owner Leaderboard */}
          <div className="grid gap-4 xl:grid-cols-2">
            <DelayTopTable items={delayTop} />
            <OwnerLeaderboardCard
              items={scopedItems}
              asOfDate={asOfDate}
              defaultDim={ownerDim}
              onDimChange={(dim) => patch({ ownerDim: dim })}
              onOwnerClick={(dim, key, row) => setOwnerDetail({ dim, key, row })}
              thresholds={thresholds}
            />
          </div>
        </>
      )}

      <OwnerDetailDialog
        open={ownerDetail !== null}
        onOpenChange={(o) => !o && setOwnerDetail(null)}
        dim={ownerDetail?.dim ?? ownerDim}
        ownerKey={ownerDetail?.key ?? ""}
        row={ownerDetail?.row ?? null}
        items={scopedItems}
        asOfDate={asOfDate}
        thresholds={thresholds}
      />
    </div>
  );
}