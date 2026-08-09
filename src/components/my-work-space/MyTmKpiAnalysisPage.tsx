import { useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
import { useTaskDashboardData, getLatestDataDate } from "@/hooks/useTaskDashboardData";
import { useTmAsOf } from "@/hooks/useTmAsOf";
import { todayIso } from "@/lib/task-management/schedule-utils";
import type { OwnerDim, OwnerLeaderboardRow } from "@/lib/task-management/delay-utils";
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import { OwnerProgressChart } from "@/components/task-management/dashboard/OwnerProgressChart";
import { OwnerDetailDialog } from "@/components/task-management/dashboard/OwnerDetailDialog";
import { TmPlanVsActualCard } from "@/components/task-management/dashboard/TmPlanVsActualCard";
import type { SCurveBucket } from "@/lib/task-management/scurve-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { resolveJudgment } from "@/lib/task-management/delay-utils";
import { todayInDoha } from "@/lib/time/doha";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ChartGuideButton } from "@/components/task-management/dashboard/ChartGuideButton";

const TASK_SCOPE_OPTIONS = [
  { value: "main", label: "Main Task" },
  { value: "sub", label: "Sub Task" },
] as const;
const DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "악화만" },
] as const;

const routeApi = getRouteApi("/_authenticated/my-kpi-analysis");

/** S-Curve 차트 시작일 기본값 — KPI Analysis 와 동일 */
const DEFAULT_CURVE_START = "2026-07-17";

const OWNER_DIM: OwnerDim = "hdec_pic_name";

export function MyTmKpiAnalysisPage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate();

  const { data: me, isLoading: meLoading } = useCurrentUser();
  const myName = me?.hdec_pic_name ?? null;

  const [sharedDataDate, setSharedDataDate] = useTmAsOf();
  const today = todayInDoha();
  const selectedDataDate = sharedDataDate || today;
  const asOfDate = selectedDataDate;

  const { data: items = [], isLoading } = useTaskDashboardData(
    {
      disciplines: [],
      plots: [],
      teams: [],
      // 대상은 본인 고정
      hdecPic: myName ? [myName] : ["\u0000__none__"],
      hdecEng: [],
      level: "all",
      q: "",
    },
    asOfDate,
  );

  const latestDataDate = getLatestDataDate(items) ?? todayIso();

  const dataDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      const d = (it as unknown as { data_date?: string | null }).data_date;
      if (d) set.add(String(d).slice(0, 10));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [items]);

  const taskScope: TaskScope = search.taskScope === "main" ? "main" : "sub";
  const scopedByTaskScope = useMemo(() => scopeItems(items, taskScope), [items, taskScope]);

  const { data: thresholdsData } = useTaskManagementSettings();
  const thresholds = thresholdsData ?? DEFAULT_THRESHOLDS;

  const [ownerDetail, setOwnerDetail] = useState<{
    dim: OwnerDim;
    key: string;
    row: OwnerLeaderboardRow;
  } | null>(null);
  const [curveOpen, setCurveOpen] = useState(true);
  const [curveStart, setCurveStart] = useState<string>(DEFAULT_CURVE_START);
  const curveBucket: SCurveBucket =
    search.curveBucket === "day" || search.curveBucket === "month" ? search.curveBucket : "week";

  const scopedItems = useMemo(() => {
    const base = scopedByTaskScope;
    if (search.delayFilter === "risk")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "악화");
    if (search.delayFilter === "delayed")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "지연");
    return base;
  }, [scopedByTaskScope, search.delayFilter, thresholds, asOfDate]);

  const patch = (obj: Record<string, unknown>) =>
    navigate({
      to: "/my-kpi-analysis",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...obj }) as any,
    });

  const totalItems = items.length;

  const filterSummary = useMemo(
    () => [
      { label: "Task", value: taskScope === "main" ? "Main" : "Sub" },
      { label: "PIC", value: myName ?? "-" },
      {
        label: "Delay",
        value:
          DELAY_FILTER_OPTIONS.find((o) => o.value === search.delayFilter)?.label ??
          String(search.delayFilter ?? "all"),
      },
      { label: "As of", value: asOfDate },
    ],
    [taskScope, myName, search.delayFilter, asOfDate],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="sticky top-0 z-30 -mx-4 -mt-4 flex flex-col gap-3 bg-background px-4 pt-4 pb-3 border-b shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">My KPI Analysis</h1>
            {myName && (
              <span className="rounded-md border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {myName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {asOfHeaderLabel(selectedDataDate, today)}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {totalItems.toLocaleString()} items
            </span>
            <ChartGuideButton />
          </div>
        </div>

        <Card className="bg-background">
          <CardContent className="flex flex-col gap-2 p-3">
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

              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium uppercase tracking-wide">Chart start</span>
                <input
                  type="date"
                  value={curveStart}
                  onChange={(e) => setCurveStart(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-xs tabular-nums"
                />
              </label>

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
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading || meLoading ? (
        <Skeleton className="h-[600px] w-full" />
      ) : !myName ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/60" />
            사용자 프로필에 담당자 이름이 없어 본인 과업을 조회할 수 없습니다.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/60" />
            현재 조건에 해당하는 태스크가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <>
          <OwnerProgressChart
            items={scopedItems}
            asOfDate={asOfDate}
            dim={OWNER_DIM}
            titleSuffix={myName}
            onOwnerClick={(dim, key, row) => setOwnerDetail({ dim, key, row })}
            thresholds={thresholds}
          />
          <TmPlanVsActualCard
            items={scopedItems}
            asOfDate={asOfDate}
            startFrom={curveStart || null}
            dim={OWNER_DIM}
            filterSummary={filterSummary}
            bucket={curveBucket}
            onBucketChange={(b) => patch({ curveBucket: b })}
            open={curveOpen}
            onOpenChange={setCurveOpen}
          />
        </>
      )}

      <OwnerDetailDialog
        open={ownerDetail !== null}
        onOpenChange={(o) => !o && setOwnerDetail(null)}
        dim={ownerDetail?.dim ?? OWNER_DIM}
        ownerKey={ownerDetail?.key ?? ""}
        row={ownerDetail?.row ?? null}
        items={scopedItems}
        asOfDate={asOfDate}
        thresholds={thresholds}
      />
    </div>
  );
}
void Button;
void BookOpen;
