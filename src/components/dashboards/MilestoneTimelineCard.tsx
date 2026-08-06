import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Circle, Clock, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todayInDoha } from "@/lib/time/doha";

const PLOT_ORDER = ["C", "D", "G"];

interface Kind {
  kind_code: string;
  label: string | null;
  sort_order: number | null;
  is_active: boolean | null;
}
interface Cfg {
  plot: string;
  kind: string;
  target_date: string | null;
}
interface Node {
  kind: string;
  label: string;
  date: string; // YYYY-MM-DD
  diff: number; // days from today (positive = future)
}

/** YYYY-MM-DD -> UTC-midnight epoch day number. */
function dayNum(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function dLabel(diff: number): string {
  return diff > 0 ? `D-${diff}` : diff === 0 ? "D-Day" : `D+${Math.abs(diff)}`;
}

/**
 * Outstanding Work 대시보드 최상단 마일스톤 타임라인.
 * 정본: tm_milestone_config × tm_milestone_kinds (기준일 오름차순, 미지정·비활성 제외).
 * 상태는 날짜 기준 자동 판정 — 경과=완료, 첫 도래=진행중, 이후=예정.
 */
export function MilestoneTimelineCard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["tm_milestone_timeline"],
    staleTime: 60_000,
    queryFn: async () => {
      const [kindsRes, cfgRes] = await Promise.all([
        (supabase as any)
          .from("tm_milestone_kinds")
          .select("kind_code, label, sort_order, is_active")
          .is("deleted_at", null)
          .order("sort_order", { ascending: true }),
        (supabase as any).from("tm_milestone_config").select("plot, kind, target_date"),
      ]);
      if (kindsRes.error) throw kindsRes.error;
      if (cfgRes.error) throw cfgRes.error;
      return { kinds: (kindsRes.data ?? []) as Kind[], cfg: (cfgRes.data ?? []) as Cfg[] };
    },
  });

  const today = todayInDoha();
  const todayNum = dayNum(today);

  const plots = useMemo(() => {
    const kinds = new Map(
      (data?.kinds ?? []).filter((k) => k.is_active !== false).map((k) => [k.kind_code, k]),
    );
    const byPlot = new Map<string, Node[]>();
    for (const r of data?.cfg ?? []) {
      if (!r?.plot || !r?.kind || !r.target_date) continue;
      const k = kinds.get(r.kind);
      if (!k) continue;
      const list = byPlot.get(r.plot) ?? [];
      list.push({
        kind: r.kind,
        label: k.label || r.kind,
        date: r.target_date,
        diff: dayNum(r.target_date) - todayNum,
      });
      byPlot.set(r.plot, list);
    }
    for (const list of byPlot.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return Array.from(byPlot.entries())
      .filter(([, list]) => list.length > 0)
      .sort((a, b) => {
        const ia = PLOT_ORDER.indexOf(a[0]);
        const ib = PLOT_ORDER.indexOf(b[0]);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a[0].localeCompare(b[0]);
      });
  }, [data, todayNum]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b bg-muted/30 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Milestone Timeline</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Plot 별 계약 마일스톤 · 오늘 {today} (Doha)
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          새로고침
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">마일스톤을 불러오지 못했습니다.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              다시 시도
            </Button>
          </div>
        ) : plots.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            등록된 마일스톤 기준일이 없습니다. (Admin &gt; 마일스톤 설정)
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {plots.map(([plot, nodes]) => (
              <PlotTimeline key={plot} plot={plot} nodes={nodes} todayNum={todayNum} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlotTimeline({
  plot,
  nodes,
  todayNum,
}: {
  plot: string;
  nodes: Node[];
  todayNum: number;
}) {
  const pos = (i: number) => (nodes.length <= 1 ? 50 : (i / (nodes.length - 1)) * 100);

  // 오늘이 속한 구간을 보간해 경과선 길이를 구한다.
  const elapsedPercent = useMemo(() => {
    const days = nodes.map((n) => dayNum(n.date));
    if (days.length === 0) return 0;
    if (todayNum <= days[0]) return 0;
    if (todayNum >= days[days.length - 1]) return 100;
    for (let i = 1; i < days.length; i++) {
      if (todayNum <= days[i]) {
        const seg = Math.max(days[i] - days[i - 1], 1);
        const ratio = (todayNum - days[i - 1]) / seg;
        return pos(i - 1) + (pos(i) - pos(i - 1)) * ratio;
      }
    }
    return 100;
  }, [nodes, todayNum]);

  // 다음 도래(진행중) 노드 = 아직 지나지 않은 첫 노드
  const activeIdx = nodes.findIndex((n) => n.diff >= 0);
  const final = nodes[nodes.length - 1];

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary ring-1 ring-primary/20">
            Plot {plot}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {nodes.length} milestones
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5">
          <CalendarClock className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-xs font-bold text-primary">{dLabel(final.diff)}</span>
          <span className="ml-0.5 hidden text-[10px] text-muted-foreground sm:inline">
            {final.label}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="relative min-w-[720px] px-14 pb-3 pt-8">
          {/* 기준선 */}
          <div className="absolute left-14 right-14 top-[calc(2rem+18px-1.5px)] h-[3px] rounded-full bg-border" />
          {/* 경과선 */}
          <div className="pointer-events-none absolute left-14 right-14 top-[calc(2rem+18px-1.5px)] h-[3px]">
            <div
              className="h-full rounded-full bg-destructive"
              style={{ width: `${elapsedPercent}%` }}
            />
          </div>

          {/* Today 마커 */}
          {elapsedPercent > 0 && elapsedPercent < 100 && (
            <div
              className="pointer-events-none absolute flex flex-col items-center"
              style={{
                top: "calc(2rem + 18px - 1.5px)",
                left: `calc(56px + (100% - 112px) * ${elapsedPercent / 100})`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <span className="mb-1 whitespace-nowrap rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                Today
              </span>
              <div className="h-2 w-0.5 rounded-full bg-primary/50" />
            </div>
          )}

          <div className="relative" style={{ height: 124 }}>
            {nodes.map((n, index) => {
              const isDone = n.diff < 0;
              const isActive = index === activeIdx;
              const Icon = isDone ? CheckCircle2 : isActive ? Clock : Circle;
              const isFirst = index === 0;
              const isLast = index === nodes.length - 1;
              return (
                <div
                  key={`${n.kind}-${n.date}`}
                  className={`absolute z-10 flex flex-col ${
                    isFirst ? "items-start" : isLast ? "items-end" : "items-center"
                  } ${isDone ? "opacity-70" : ""}`}
                  style={{
                    left: `${pos(index)}%`,
                    top: 0,
                    transform: isFirst
                      ? "translateX(0)"
                      : isLast
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                  }}
                >
                  <div
                    className={`flex items-center justify-center rounded-full border-2 transition-all ${
                      isActive
                        ? "h-10 w-10 border-primary bg-primary/20 ring-4 ring-primary/15"
                        : isDone
                          ? "h-9 w-9 border-success bg-success/20"
                          : "h-9 w-9 border-border bg-muted"
                    }`}
                  >
                    <Icon
                      className={`${isActive ? "h-5 w-5" : "h-4 w-4"} ${
                        isDone
                          ? "text-success"
                          : isActive
                            ? "text-primary"
                            : "text-muted-foreground"
                      }`}
                    />
                  </div>
                  <span
                    className={`mt-2 max-w-[120px] whitespace-nowrap text-center text-xs leading-tight ${
                      isActive ? "font-bold text-foreground" : "font-medium"
                    }`}
                    title={n.label}
                  >
                    {n.label}
                  </span>
                  <span className="mt-0.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {fmtDate(n.date)}
                  </span>
                  <span
                    className={`mt-0.5 whitespace-nowrap font-mono text-base font-bold ${
                      n.diff > 0
                        ? "text-primary"
                        : n.diff === 0
                          ? "text-warning"
                          : "text-muted-foreground"
                    }`}
                  >
                    {dLabel(n.diff)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
