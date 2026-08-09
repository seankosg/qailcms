import { useEffect, useMemo, useState } from "react";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { asOfHeaderLabel } from "@/lib/task-management/as-of";
import { useTaskDashboardData, getLatestDataDate } from "@/hooks/useTaskDashboardData";
import { useTmAsOf } from "@/hooks/useTmAsOf";
import { todayIso, type TaskItem } from "@/lib/task-management/schedule-utils";
import type { OwnerDim, OwnerLeaderboardRow } from "@/lib/task-management/delay-utils";
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import { OwnerQuickFilterPills } from "./OwnerQuickFilterPills";
import { OwnerProgressChart } from "./OwnerProgressChart";
import { OwnerDetailDialog } from "./OwnerDetailDialog";
import { TmPlanVsActualCard } from "./TmPlanVsActualCard";
import type { SCurveBucket } from "@/lib/task-management/scurve-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { resolveJudgment } from "@/lib/task-management/delay-utils";
import { todayInDoha } from "@/lib/time/doha";

const DISCIPLINE_KEYS = ["ARCH", "MECH", "ELEC", "DESN", "PRJC", "SUPP"] as const;
const TASK_SCOPE_OPTIONS = [
  { value: "main", label: "Main Task" },
  { value: "sub", label: "Sub Task" },
] as const;
const DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "악화만" },
] as const;

const routeApi = getRouteApi("/_authenticated/closure/task-management/kpi-analysis");

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

export function TmKpiAnalysisPage() {
  const search = routeApi.useSearch();
  const navigate = useNavigate();

  const [sharedDataDate, setSharedDataDate] = useTmAsOf();
  const today = todayInDoha();
  const selectedDataDate = sharedDataDate || today;
  const asOfDate = selectedDataDate;

  const { data: items = [], isLoading } = useTaskDashboardData(
    {
      disciplines: search.discipline,
      plots: search.plot,
      // 담당자 축의 Team 필터는 폐기 — 상단 Team(=discipline) 필터만 사용
      teams: [],
      hdecPic: search.hdecPic,
      hdecEng: search.hdecEng,
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

  const ownerDim: OwnerDim = isOwnerDim(search.ownerDim) ? search.ownerDim : "hdec_pic_name";
  // 계산은 항상 Sub 기준(기본값). Main 은 명시 선택 시에만.
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
  const curveBucket: SCurveBucket =
    search.curveBucket === "day" || search.curveBucket === "month"
      ? search.curveBucket
      : "week";

  const picOptions = useMemo(() => uniqSorted(items, "hdec_pic_name"), [items]);
  const engOptions = useMemo(() => uniqSorted(items, "hdec_eng_name"), [items]);

  const scopedItems = useMemo(() => {
    const base = scopedByTaskScope;
    if (search.delayFilter === "risk")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "악화");
    if (search.delayFilter === "delayed")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "지연");
    // "전체" 는 모집단 그대로 — 지연 과업만 남기지 않는다.
    return base;
  }, [scopedByTaskScope, search.delayFilter, thresholds, asOfDate]);

  const patch = (obj: Record<string, unknown>) =>
    navigate({
      to: "/closure/task-management/kpi-analysis",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...obj }) as any,
    });

  const disciplines = search.discipline ?? [];
  const totalItems = items.length;

  const listLabel = (arr: string[] | undefined) =>
    !arr || arr.length === 0 ? "All" : arr.length <= 3 ? arr.join(", ") : `${arr.length} selected`;

  const filterSummary = useMemo(
    () => [
      { label: "Task", value: taskScope === "main" ? "Main" : "Sub" },
      { label: "Team", value: listLabel(disciplines) },
      { label: "PIC", value: listLabel(search.hdecPic) },
      { label: "ENG", value: listLabel(search.hdecEng) },
      {
        label: "Delay",
        value:
          DELAY_FILTER_OPTIONS.find((o) => o.value === search.delayFilter)?.label ??
          String(search.delayFilter ?? "all"),
      },
      { label: "As of", value: asOfDate },
    ],
    [taskScope, disciplines, search.hdecPic, search.hdecEng, search.delayFilter, asOfDate],
  );

  // 폐기된 담당자축 Team 필터의 잔여 선택값 정리
  useEffect(() => {
    if ((search.team ?? []).length > 0) patch({ team: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.team]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="sticky top-0 z-30 -mx-4 -mt-4 flex flex-col gap-3 bg-background px-4 pt-4 pb-3 border-b shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/closure/task-management/dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="truncate text-xl font-semibold tracking-tight">
              Task Management KPI Analysis
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
                  Team
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

              <OwnerQuickFilterPills
                picOptions={picOptions}
                engOptions={engOptions}
                showTeam={false}
                hdecPic={search.hdecPic}
                hdecEng={search.hdecEng}
                onChange={patch}
              />
            </div>
          </CardContent>
        </Card>
      </div>

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
          <OwnerProgressChart
            items={scopedItems}
            asOfDate={asOfDate}
            dim={ownerDim}
            onDimChange={(dim) => patch({ ownerDim: dim, curveKey: "" })}
            onOwnerClick={(dim, key, row) => {
              setOwnerDetail({ dim, key, row });
              // 카드 내 담당자 필터 폐기 — 클릭 시 상단 담당자 필터에 반영한다.
              if (dim === "hdec_pic_name") patch({ hdecPic: [key], hdecEng: [] });
              else if (dim === "hdec_eng_name") patch({ hdecEng: [key], hdecPic: [] });
            }}
            thresholds={thresholds}
          />
          <TmPlanVsActualCard
            items={scopedItems}
            asOfDate={asOfDate}
            dim={ownerDim}
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
