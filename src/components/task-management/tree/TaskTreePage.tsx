import { useEffect, useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCIPLINES, AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import type { Discipline } from "@/lib/task-management/columns";
import {
  computeJudgment,
  cumPlanProgress,
  computeVariance,
  worstJudgment,
} from "@/lib/task-management/derived";
import { exportTaskSummary } from "./exportTaskSummary";
import { toast } from "sonner";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { MiniProgressChart } from "./MiniProgressChart";
import { TaskProgressChartDialog } from "./TaskProgressChartDialog";
import { useServerFn } from "@tanstack/react-start";
import { getTaskProgressChartsBulk, type TaskChartCache } from "@/lib/task-management/progress-chart.functions";

const routeApi = getRouteApi("/_authenticated/closure/task-management/tree");

interface Row {
  id: string;
  task_no: string;
  main_task_no: string | null;
  level: "main" | "sub";
  discipline: string;
  task_name: string | null;
  actual_progress: number | null;
  plan_progress: number | null;
  plan_start: string | null;
  plan_end: string | null;
  slip_days: number | null;
  auto_judgment: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  sub_task_desc: string | null;
  sort_order: number | null;
  data_date: string | null;
}

/** Main Task는 Data Date 변경에 민감하므로 클라이언트 재계산 우선, Sub는 DB값 우선. */
function resolveJudgment(r: Row, asOfDate?: string): string {
  if (r.level === "main") {
    return computeJudgment(r, undefined, asOfDate) || r.auto_judgment || "";
  }
  return r.auto_judgment || computeJudgment(r, undefined, asOfDate) || "";
}

function ProgressBar({ v }: { v: number | null | undefined }) {
  const n = Math.max(0, Math.min(1, Number(v ?? 0)));
  return (
    <div className="flex w-24 items-center gap-1">
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: `${n * 100}%` }} />
      </div>
      <span className="w-9 text-right text-[10px] tabular-nums">
        {(n * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function GapCell({ gap }: { gap: number }) {
  const cls =
    gap < -0.05
      ? "text-rose-600"
      : gap > 0.05
        ? "text-emerald-600"
        : "text-muted-foreground";
  const sign = gap > 0 ? "+" : "";
  return (
    <span className={cn("w-14 text-right text-[10px] tabular-nums", cls)}>
      {sign}
      {(gap * 100).toFixed(1)}%p
    </span>
  );
}

export function TaskTreePage() {
  const routeSearch = routeApi.useSearch();
  const navigate = useNavigate();
  const [discipline, setDiscipline] = useState<Discipline>("ARCH");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [judgmentFilter, setJudgmentFilter] = useState<Set<string>>(new Set());
  const [picFilter, setPicFilter] = useState<string>("__all__");
  const [chartTask, setChartTask] = useState<{ task_no: string; task_name: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["task-tree", discipline],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select(
          "id, task_no, main_task_no, level, discipline, task_name, actual_progress, plan_progress, plan_start, plan_end, slip_days, auto_judgment, hdec_pic_name, hdec_eng_name, sub_task_desc, sort_order, data_date",
        )
        .eq("discipline", discipline)
        .order("sort_order", { ascending: true })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const fetchChartsBulk = useServerFn(getTaskProgressChartsBulk);
  const { data: chartRows = [] } = useQuery({
    queryKey: ["task-progress-charts-bulk", discipline],
    queryFn: () => fetchChartsBulk({ data: { discipline } }),
    staleTime: 5 * 60_000,
  });
  const chartMap = useMemo(() => {
    const m = new Map<string, TaskChartCache>();
    for (const r of chartRows) m.set(r.task_no, r);
    return m;
  }, [chartRows]);

  const latestDataDate = useMemo(() => {
    let latest = "";
    for (const r of data) {
      const d = r.data_date ? String(r.data_date).slice(0, 10) : "";
      if (d && d > latest) latest = d;
    }
    return latest;
  }, [data]);

  const dataDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      const d = r.data_date ? String(r.data_date).slice(0, 10) : "";
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [data]);

  const asOfDate = routeSearch.dataDate || latestDataDate || undefined;

  const { mainTasks, subsByMain } = useMemo(() => {
    const mainTasks: Row[] = [];
    const subsByMain = new Map<string, Row[]>();
    for (const r of data) {
      if (r.level === "main") mainTasks.push(r);
      else if (r.main_task_no) {
        const arr = subsByMain.get(r.main_task_no) ?? [];
        arr.push(r);
        subsByMain.set(r.main_task_no, arr);
      }
    }
    return { mainTasks, subsByMain };
  }, [data]);

  const picOptions = useMemo(() => {
    const names = new Set<string>();
    let hasUnassigned = false;
    for (const r of data) {
      const v = (r.hdec_pic_name ?? "").trim();
      if (v) names.add(v);
      else hasUnassigned = true;
    }
    return {
      names: Array.from(names).sort((a, b) => a.localeCompare(b, "ko")),
      hasUnassigned,
    };
  }, [data]);

  useEffect(() => {
    if (picFilter === "__all__" || picFilter === "__unassigned__") return;
    if (!picOptions.names.includes(picFilter)) setPicFilter("__all__");
  }, [picFilter, picOptions.names]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return mainTasks.filter((p) => {
      const kids = subsByMain.get(p.task_no) ?? [];
      if (judgmentFilter.size > 0) {
        const mainJ = resolveJudgment(p, asOfDate);
        const anyMatch =
          (mainJ && judgmentFilter.has(mainJ)) ||
          kids.some((k) => judgmentFilter.has(resolveJudgment(k, asOfDate)));
        if (!anyMatch) return false;
      }
      if (picFilter !== "__all__") {
        if (picFilter === "__unassigned__") {
          const anyUnassigned = [p, ...kids].some(
            (r) => !((r.hdec_pic_name ?? "").trim()),
          );
          if (!anyUnassigned) return false;
        } else {
          const anyMatch = [p, ...kids].some(
            (r) => (r.hdec_pic_name ?? "").trim() === picFilter,
          );
          if (!anyMatch) return false;
        }
      }
      if (!q) return true;
      const hay = [p.task_no, p.task_name, ...kids.flatMap((k) => [k.task_no, k.task_name, k.sub_task_desc, k.hdec_pic_name, k.hdec_eng_name])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [mainTasks, subsByMain, q, judgmentFilter, picFilter, asOfDate]);

  // 완료(Actual% ≥ 100%) Main Task 는 하단으로 정렬
  const sortedFiltered = useMemo(() => {
    const isDone = (r: Row) => Number(r.actual_progress ?? 0) >= 1;
    return [...filtered].sort((a, b) => {
      const da = isDone(a) ? 1 : 0;
      const db = isDone(b) ? 1 : 0;
      return da - db;
    });
  }, [filtered]);

  function toggle(taskNo: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(taskNo)) next.delete(taskNo);
      else next.add(taskNo);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(filtered.map((p) => p.task_no)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  async function handleExport() {
    if (filtered.length === 0) {
      toast.info("내보낼 데이터가 없습니다.");
      return;
    }
    // 현재 필터가 적용된 Main + 그 하위 Sub 로만 sub 맵을 구성해 넘긴다.
    const filteredSubs = new Map<string, Row[]>();
    for (const p of filtered) {
      filteredSubs.set(p.task_no, subsByMain.get(p.task_no) ?? []);
    }
    const filtersLabel = [
      `Discipline=${discipline}`,
      picFilter === "__all__"
        ? null
        : picFilter === "__unassigned__"
          ? "PIC=(미지정)"
          : `PIC=${picFilter}`,
      judgmentFilter.size > 0
        ? `위험도=${Array.from(judgmentFilter).join(",")}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    setExporting(true);
    try {
      const n = await exportTaskSummary({
        discipline,
        mainTasks: filtered,
        subsByMain: filteredSubs,
        filtersLabel,
        searchLabel: search.trim(),
        asOfDate,
      });
      toast.success(`엑셀 내보내기 완료 — ${n.toLocaleString()} rows`);
    } catch (e) {
      toast.error(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Task Tree</h1>
        {latestDataDate && (
          <DataDatePicker
            value={routeSearch.dataDate}
            latest={latestDataDate}
            options={dataDateOptions}
            onChange={(v) =>
              navigate({
                to: "/closure/task-management/tree",
                search: (prev: Record<string, unknown>) =>
                  ({ ...prev, dataDate: v === latestDataDate ? "" : v }) as any,
              })
            }
            onReset={() =>
              navigate({
                to: "/closure/task-management/tree",
                search: (prev: Record<string, unknown>) =>
                  ({ ...prev, dataDate: "" }) as any,
              })
            }
          />
        )}
        <Tabs value={discipline} onValueChange={(v) => setDiscipline(v as Discipline)}>
          <TabsList>
            {DISCIPLINES.map((d) => (
              <TabsTrigger key={d} value={d}>
                {d}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={picFilter} onValueChange={setPicFilter}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="HDEC PIC" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">모든 HDEC PIC</SelectItem>
            {picOptions.hasUnassigned && (
              <SelectItem value="__unassigned__">(미지정)</SelectItem>
            )}
            {picOptions.names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {(["정상", "주의", "지연", "위험"] as const).map((j) => {
              const active = judgmentFilter.has(j);
              return (
                <button
                  key={j}
                  type="button"
                  onClick={() =>
                    setJudgmentFilter((cur) => {
                      const next = new Set(cur);
                      if (next.has(j)) next.delete(j);
                      else next.add(j);
                      return next;
                    })
                  }
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-[11px] font-medium transition",
                    active
                      ? (AUTO_JUDGMENT_COLORS[j] ?? "bg-muted") + " border-transparent ring-1 ring-current"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {j}
                </button>
              );
            })}
            {judgmentFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setJudgmentFilter(new Set())}
                className="ml-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                해제
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색"
              className="h-8 w-56 pl-7"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={expandAll}>
            펴기
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={collapseAll}>
            접기
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={handleExport}
            disabled={exporting || isLoading}
          >
            {exporting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Excel
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">로딩 중…</div>}

      <div className="space-y-2">
        {sortedFiltered.map((p) => {
          const kids = subsByMain.get(p.task_no) ?? [];
          const isOpen = expanded.has(p.task_no);
          const isDone = Number(p.actual_progress ?? 0) >= 1;
          const mainJudgment = resolveJudgment(p, asOfDate);
          const behindCount = kids.filter(
            (k) => (computeVariance(k, asOfDate) ?? 0) < -0.05,
          ).length;
          const pGap = computeVariance(p, asOfDate) ?? 0;
          return (
            <Card key={p.id} className={cn("overflow-hidden", isDone && "bg-muted/60 text-muted-foreground opacity-70")}> 
              <CardHeader
                className={cn(
                  "cursor-pointer flex flex-row items-center gap-2 py-2",
                  isOpen && "border-b",
                )}
                onClick={() => toggle(p.task_no)}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <button
                  type="button"
                  className="flex items-center gap-2 text-left hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({
                      to: "/closure/task-management/detail/$id",
                      params: { id: p.id },
                    });
                  }}
                  title="상세 페이지로 이동"
                >
                  <span className="font-mono text-xs">{p.task_no}</span>
                  <span className="text-sm font-semibold">{p.task_name ?? "-"}</span>
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Sub Task {kids.length}</Badge>
                  {behindCount > 0 && (
                    <Badge className="bg-rose-500/15 text-rose-700">지연 {behindCount}</Badge>
                  )}
                  {mainJudgment && (
                    <Badge
                      className={cn(
                        "rounded-none border border-black/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm",
                        AUTO_JUDGMENT_COLORS[mainJudgment] ?? "bg-muted",
                      )}
                      title="Main Task 판정"
                    >
                      {mainJudgment}
                    </Badge>
                  )}
                  <ProgressBar v={p.actual_progress} />
                  <GapCell gap={pGap} />
                  <MiniProgressChart
                    planPoints={chartMap.get(p.task_no)?.plan_points}
                    actualPoints={chartMap.get(p.task_no)?.actual_points}
                    xStart={chartMap.get(p.task_no)?.x_start ?? null}
                    xEnd={chartMap.get(p.task_no)?.x_end ?? null}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChartTask({ task_no: p.task_no, task_name: p.task_name });
                    }}
                    title="클릭하여 진도율 상세 차트 보기"
                  />
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 text-left">Task No</th>
                       <th className="px-2 py-1 text-left">Sub Task 설명</th>
                        <th className="px-2 py-1 text-left">담당</th>
                        <th className="px-2 py-1 text-left">계획</th>
                        <th className="px-2 py-1 text-left">실적</th>
                        <th className="px-2 py-1 text-left">오늘 계획</th>
                        <th className="px-2 py-1 text-left">차이</th>
                        <th className="px-2 py-1 text-left">판정</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {kids.map((k) => {
                        const gap = computeVariance(k, asOfDate) ?? 0;
                        const j = resolveJudgment(k, asOfDate);
                        return (
                          <tr
                            key={k.id}
                            className="cursor-pointer border-t hover:bg-accent/30"
                            onClick={() =>
                              navigate({
                                to: "/closure/task-management/detail/$id",
                                params: { id: k.id },
                              })
                            }
                          >
                            <td className="px-2 py-1 font-mono text-primary underline-offset-2 hover:underline">
                              {k.task_no}
                            </td>
                            <td className="px-2 py-1">{k.sub_task_desc ?? "-"}</td>
                            <td className="px-2 py-1">{k.hdec_pic_name ?? k.hdec_eng_name ?? "-"}</td>
                            <td className="px-2 py-1 text-[10px] tabular-nums">
                              {k.plan_start ?? "-"} ~ {k.plan_end ?? "-"}
                            </td>
                            <td className="px-2 py-1">
                              <ProgressBar v={k.actual_progress} />
                            </td>
                            <td className="px-2 py-1 tabular-nums text-[10px]">
                              {(cumPlanProgress(k, asOfDate) * 100).toFixed(0)}%
                            </td>
                            <td className="px-2 py-1">
                              <GapCell gap={gap} />
                            </td>
                            <td className="px-2 py-1">
                              {j && (
                                <Badge className={AUTO_JUDGMENT_COLORS[j] ?? "bg-muted"}>
                                  {j}
                                </Badge>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <MiniProgressChart
                                planPoints={chartMap.get(k.task_no)?.plan_points}
                                actualPoints={chartMap.get(k.task_no)?.actual_points}
                                xStart={chartMap.get(k.task_no)?.x_start ?? null}
                                xEnd={chartMap.get(k.task_no)?.x_end ?? null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChartTask({ task_no: k.task_no, task_name: k.task_name });
                                }}
                                title="클릭하여 진도율 상세 차트 보기"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && !isLoading && (
        <div className="rounded border p-6 text-center text-sm text-muted-foreground">
          표시할 Main Task가 없습니다.
        </div>
      )}

      <TaskProgressChartDialog
        open={!!chartTask}
        onClose={() => setChartTask(null)}
        discipline={discipline}
        taskNo={chartTask?.task_no ?? null}
        taskName={chartTask?.task_name ?? null}
      />
    </div>
  );
}