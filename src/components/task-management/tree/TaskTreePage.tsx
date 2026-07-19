import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, History, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCIPLINES, AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import type { Discipline } from "@/lib/task-management/columns";
import { computeJudgment, expectedProgressToday, todayGap, worstJudgment } from "@/lib/task-management/derived";
import { HistoryDrawer } from "@/components/task-management/raw-data/HistoryDrawer";

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
  pic: string | null;
  sub_task_desc: string | null;
  sort_order: number | null;
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
  const [discipline, setDiscipline] = useState<Discipline>("ARCH");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [behindOnly, setBehindOnly] = useState(false);
  const [historyTask, setHistoryTask] = useState<{ task_no: string; task_name: string | null } | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["task-tree", discipline],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select(
          "id, task_no, main_task_no, level, discipline, task_name, actual_progress, plan_progress, plan_start, plan_end, slip_days, auto_judgment, pic, sub_task_desc, sort_order",
        )
        .eq("discipline", discipline)
        .order("sort_order", { ascending: true })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { parents, childrenByParent } = useMemo(() => {
    const parents: Row[] = [];
    const childrenByParent = new Map<string, Row[]>();
    for (const r of data) {
      if (r.level === "main") parents.push(r);
      else if (r.main_task_no) {
        const arr = childrenByParent.get(r.main_task_no) ?? [];
        arr.push(r);
        childrenByParent.set(r.main_task_no, arr);
      }
    }
    return { parents, childrenByParent };
  }, [data]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return parents.filter((p) => {
      const kids = childrenByParent.get(p.task_no) ?? [];
      if (behindOnly) {
        const anyBehind = [p, ...kids].some((r) => todayGap(r) < -0.05);
        if (!anyBehind) return false;
      }
      if (!q) return true;
      const hay = [p.task_no, p.task_name, ...kids.flatMap((k) => [k.task_no, k.task_name, k.sub_task_desc, k.pic])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [parents, childrenByParent, q, behindOnly]);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Task Tree</h1>
        <Tabs value={discipline} onValueChange={(v) => setDiscipline(v as Discipline)}>
          <TabsList>
            {DISCIPLINES.map((d) => (
              <TabsTrigger key={d} value={d}>
                {d}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색"
              className="h-8 w-56 pl-7"
            />
          </div>
          <Button
            size="sm"
            variant={behindOnly ? "default" : "outline"}
            className="h-8"
            onClick={() => setBehindOnly((v) => !v)}
          >
            지연만
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={expandAll}>
            펴기
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={collapseAll}>
            접기
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">로딩 중…</div>}

      <div className="space-y-2">
        {filtered.map((p) => {
          const kids = childrenByParent.get(p.task_no) ?? [];
          const isOpen = expanded.has(p.task_no);
          const worst = worstJudgment(kids.map((k) => k.auto_judgment)) ?? p.auto_judgment;
          const behindCount = kids.filter((k) => todayGap(k) < -0.05).length;
          const pGap = todayGap(p);
          return (
            <Card key={p.id} className="overflow-hidden">
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
                <span className="font-mono text-xs">{p.task_no}</span>
                <CardTitle className="text-sm">{p.task_name ?? "-"}</CardTitle>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge variant="outline">자식 {kids.length}</Badge>
                  {behindCount > 0 && (
                    <Badge className="bg-rose-500/15 text-rose-700">지연 {behindCount}</Badge>
                  )}
                  {worst && (
                    <Badge className={AUTO_JUDGMENT_COLORS[worst] ?? "bg-muted"}>{worst}</Badge>
                  )}
                  <ProgressBar v={p.actual_progress} />
                  <GapCell gap={pGap} />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHistoryTask({ task_no: p.task_no, task_name: p.task_name });
                    }}
                    title="이력 보기"
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 text-left">Task No</th>
                        <th className="px-2 py-1 text-left">세부 업무</th>
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
                        const gap = todayGap(k);
                        const j = k.auto_judgment ?? computeJudgment(k);
                        return (
                          <tr key={k.id} className="border-t hover:bg-accent/30">
                            <td className="px-2 py-1 font-mono">{k.task_no}</td>
                            <td className="px-2 py-1">{k.sub_task_desc ?? "-"}</td>
                            <td className="px-2 py-1">{k.pic ?? "-"}</td>
                            <td className="px-2 py-1 text-[10px] tabular-nums">
                              {k.plan_start ?? "-"} ~ {k.plan_end ?? "-"}
                            </td>
                            <td className="px-2 py-1">
                              <ProgressBar v={k.actual_progress} />
                            </td>
                            <td className="px-2 py-1 tabular-nums text-[10px]">
                              {(expectedProgressToday(k) * 100).toFixed(0)}%
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
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() =>
                                  setHistoryTask({ task_no: k.task_no, task_name: k.task_name })
                                }
                              >
                                <History className="h-3.5 w-3.5" />
                              </Button>
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
          표시할 parent가 없습니다.
        </div>
      )}

      <HistoryDrawer
        open={!!historyTask}
        onClose={() => setHistoryTask(null)}
        discipline={discipline}
        taskNo={historyTask?.task_no ?? null}
        taskName={historyTask?.task_name ?? null}
      />
    </div>
  );
}