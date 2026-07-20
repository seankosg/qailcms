import { useMemo, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CalendarDays, Gauge, RotateCcw, Search } from "lucide-react";
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
import {
  ALL_TASK_STAGE_KEYS,
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
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import { OwnerQuickFilterPills } from "./OwnerQuickFilterPills";
import { DelayTopTable } from "./DelayTopTable";
import { OwnerLeaderboardCard } from "./OwnerLeaderboardCard";
import { WeeklyDelayTrend } from "./WeeklyDelayTrend";
import { JudgmentStageBreakdown } from "./JudgmentStageBreakdown";
import { OwnerDetailDialog } from "./OwnerDetailDialog";

const routeApi = getRouteApi("/_authenticated/closure/task-management/dashboard");

const DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "위험만" },
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

  const selectedDataDate =
    search.dataDate && search.dataDate.length ? search.dataDate : latestDataDate;
  const asOfDate = selectedDataDate;
  const asOfLabel = "Data Date";

  const ownerDim: OwnerDim = isOwnerDim(search.ownerDim) ? search.ownerDim : "hdec_pic_name";

  const taskScope: TaskScope =
    search.taskScope === "main" || search.taskScope === "sub" ? search.taskScope : "all";

  const scopedByTaskScope = useMemo(() => scopeItems(items, taskScope), [items, taskScope]);

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
      if (search.delayFilter === "risk") return it.auto_judgment === "위험";
      if (it.auto_judgment === "지연" || it.auto_judgment === "위험") return true;
      for (const st of ALL_TASK_STAGE_KEYS) {
        if (isTaskStageDelayedAsOf(it, st, asOfDate)) return true;
      }
      return false;
    });
  }, [scopedByTaskScope, search.delayFilter, asOfDate]);

  const delayTop = useMemo(() => computeDelayTopN(scopedItems, asOfDate, 20), [scopedItems, asOfDate]);

  const patch = (obj: Record<string, unknown>) =>
    navigate({
      to: "/closure/task-management/dashboard",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...obj }) as any,
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/closure/task-management/tree" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Gauge className="h-5 w-5 text-primary" />
              Task Management Dashboard
            </h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              Data Date
            </span>
            <Select
              value={selectedDataDate}
              onValueChange={(v) => patch({ dataDate: v })}
            >
              <SelectTrigger className="h-7 w-[160px] text-xs">
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
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => patch({ dataDate: "" })}
              >
                <RotateCcw className="mr-1 h-3 w-3" />
                최신
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <OwnerQuickFilterPills
            teamOptions={teamOptions}
            picOptions={picOptions}
            engOptions={engOptions}
            team={search.team}
            hdecPic={search.hdecPic}
            hdecEng={search.hdecEng}
            onChange={patch}
          />

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

          <div className="ml-auto flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search.q}
              placeholder="task_no / 이름 / 담당"
              className="h-8 w-56 text-xs"
              onChange={(e) => patch({ q: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards (SHAW Punch style) */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <TmKpiCards
          items={items}
          asOfDate={asOfDate}
          taskScope={taskScope}
          onScopeChange={(v) => patch({ taskScope: v })}
          ownerContext={{
            team: search.team,
            hdec_pic_name: search.hdecPic,
            hdec_eng_name: search.hdecEng,
            discipline: search.discipline,
          }}
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
            />
          </div>

          {/* Weekly trend */}
          <WeeklyDelayTrend items={scopedItems} today={asOfDate} />

          {/* Judgment breakdown */}
          <JudgmentStageBreakdown items={scopedItems} asOfDate={asOfDate} />
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
      />
    </div>
  );
}