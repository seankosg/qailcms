import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Circle, Clock, Eye, EyeOff, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { todayInDoha } from "@/lib/time/doha";
import { cn } from "@/lib/utils";

const PLOT_ORDER = ["D", "C", "G"];

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
  auto?: boolean; // 모듈·팀 자동 최종 완료일 (보조 노드)
}
interface AutoRow {
  plot: string | null;
  label: string | null;
  last_date: string | null;
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
export function MilestoneTimelineCard({ hidePlotG }: { hidePlotG?: boolean }) {

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["tm_milestone_timeline"],
    staleTime: 60_000,
    queryFn: async () => {
      const [kindsRes, cfgRes, autoRes] = await Promise.all([
        (supabase as any)
          .from("tm_milestone_kinds")
          .select("kind_code, label, sort_order, is_active")
          .is("deleted_at", null)
          .order("sort_order", { ascending: true }),
        (supabase as any).from("tm_milestone_config").select("plot, kind, target_date"),
        (supabase as any).rpc("plot_module_team_last_date"),
      ]);
      if (kindsRes.error) throw kindsRes.error;
      if (cfgRes.error) throw cfgRes.error;
      return {
        kinds: (kindsRes.data ?? []) as Kind[],
        cfg: (cfgRes.data ?? []) as Cfg[],
        auto: (autoRes?.data ?? []) as AutoRow[],
      };
    },
  });

  const today = todayInDoha();
  const todayNum = dayNum(today);
  const [showAuto, setShowAuto] = useState(false);

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
    if (showAuto) {
      for (const r of data?.auto ?? []) {
        if (!r?.plot || !r?.label || !r?.last_date) continue;
        const list = byPlot.get(r.plot) ?? [];
        list.push({
          kind: `auto:${r.label}`,
          label: r.label,
          date: r.last_date,
          diff: dayNum(r.last_date) - todayNum,
          auto: true,
        });
        byPlot.set(r.plot, list);
      }
      for (const list of byPlot.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    }
    return Array.from(byPlot.entries())
      .filter(([, list]) => list.length > 0)
      .sort((a, b) => {
        const ia = PLOT_ORDER.indexOf(a[0]);
        const ib = PLOT_ORDER.indexOf(b[0]);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a[0].localeCompare(b[0]);
      });
  }, [data, todayNum, showAuto]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b bg-muted/30 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Milestone Timeline</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Plot 별 마일스톤 · 오늘 {today} (Doha)
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => setShowAuto((s) => !s)}
        >
          {showAuto ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          모듈-팀 {showAuto ? "숨기기" : "보기"}
        </Button>
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
          <SharedTimeline plots={plots} todayNum={todayNum} showAuto={showAuto} />
        )}
      </CardContent>
    </Card>
  );
}

/** 모든 Plot 이 공유하는 단일 시간축 타임라인. */
function SharedTimeline({
  plots,
  todayNum,
  showAuto,
}: {
  plots: [string, Node[]][];
  todayNum: number;
  showAuto: boolean;
}) {
  const { minDay, maxDay, ticks } = useMemo(() => {
    const all = plots.flatMap(([, ns]) => ns.map((n) => dayNum(n.date)));
    all.push(todayNum);
    const rawMin = Math.min(...all);
    const rawMax = Math.max(...all);
    const pad = Math.max(Math.round((rawMax - rawMin) * 0.07), 21);
    const minDay = rawMin - pad;
    const maxDay = rawMax + pad;
    // 월 단위 눈금
    const ticks: { day: number; label: string }[] = [];
    const start = new Date((minDay + pad) * 86_400_000);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth();
    for (let i = 0; i < 60; i++) {
      const day = Math.floor(Date.UTC(y, m, 1) / 86_400_000);
      if (day > maxDay) break;
      if (day >= minDay) {
        ticks.push({
          day,
          label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
            timeZone: "UTC",
          }),
        });
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return { minDay, maxDay, ticks };
  }, [plots, todayNum]);

  const span = Math.max(maxDay - minDay, 1);
  const pct = (day: number) => ((day - minDay) / span) * 100;
  const todayPct = pct(todayNum);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1000px] pr-32">
        <div className="flex">
          {/* Plot 라벨 거터 */}
          <div className="w-24 shrink-0" />
          {/* 시간축 헤더 */}
          <div className="relative h-6 flex-1 border-b">
            {ticks.map((t) => (
              <span
                key={t.day}
                className={cn(
                  "absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px]",
                  showAuto ? "text-muted-foreground/50" : "text-muted-foreground",
                )}
                style={{ left: `${pct(t.day)}%` }}
              >
                {t.label}
              </span>
            ))}
            <span
              className={cn(
                "absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full border px-1.5 font-mono text-[10px] font-semibold",
                showAuto
                  ? "border-muted-foreground/30 bg-muted-foreground/10 text-muted-foreground/70"
                  : "border-primary/30 bg-primary/15 text-primary",
              )}
              style={{ left: `${todayPct}%` }}
            >
              Today
            </span>
          </div>
        </div>

        <div className="relative">
          {/* 전 Plot 공통 Today 세로선 · 월 그리드 */}
          <div className="pointer-events-none absolute inset-0 flex">
            <div className="w-24 shrink-0" />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <div
                  key={t.day}
                  className={cn("absolute inset-y-0 w-px", showAuto ? "bg-border/40" : "bg-border/60")}
                  style={{ left: `${pct(t.day)}%` }}
                />
              ))}
              <div
                className={cn("absolute inset-y-0", showAuto ? "w-px bg-muted-foreground/30" : "w-0.5 bg-primary/60")}
                style={{ left: `${todayPct}%` }}
              />
            </div>
          </div>

          {plots.map(([plot, nodes]) => (
            <PlotRow
              key={plot}
              plot={plot}
              nodes={nodes}
              pct={pct}
              todayPct={todayPct}
              showAuto={showAuto}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlotRow({
  plot,
  nodes,
  pct,
  todayPct,
  showAuto,
}: {
  plot: string;
  nodes: Node[];
  pct: (day: number) => number;
  todayPct: number;
  showAuto: boolean;
}) {
  const activeIdx = nodes.findIndex((n) => n.diff >= 0 && !n.auto);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const startPct = pct(dayNum(first.date));
  const endPct = pct(dayNum(last.date));
  const elapsedEnd = Math.min(Math.max(todayPct, startPct), endPct);

  // 라벨 겹침 자동 회피: 라벨 폭(추정)이 겹치면 아래 레인으로 밀어낸다.
  const TRACK_PX = 840; // min-w-[1000px] - 라벨 거터(96) - 우측 여백(64)
  const LANE_H = 76;
  const lanes: number[] = []; // 레인별 마지막 라벨 우측 끝(px)
  const placed = nodes.map((n) => {
    const left = pct(dayNum(n.date));
    const textLen = Math.max(n.label.length, `${fmtDate(n.date)} · ${dLabel(n.diff)}`.length);
    const half = (textLen * (n.auto ? 6 : 8) + 22) / 2;
    const leftPx = (left / 100) * TRACK_PX;
    let lane = 0;
    while (lane < lanes.length && leftPx - half < lanes[lane] + 14) lane += 1;
    lanes[lane] = leftPx + half;
    return { node: n, left, lane };
  });
  const laneCount = Math.max(lanes.length, 1);

  return (
    <div className="flex items-stretch border-b last:border-b-0">
      <div className="flex w-24 shrink-0 flex-col justify-center gap-1 py-4 pr-2">
        <span className="w-fit rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary ring-1 ring-primary/20">
          Plot {plot}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {nodes.length} MS · {dLabel(last.diff)}
        </span>
      </div>

      <div className="relative flex-1 py-4" style={{ height: 36 + laneCount * LANE_H }}>
        {/* 기준선 */}
        <div
          className={cn(
            "absolute top-[22px] h-[6px] rounded-full",
            showAuto ? "bg-muted-foreground/30" : "bg-border",
          )}
          style={{ left: `${startPct}%`, width: `${Math.max(endPct - startPct, 0)}%` }}
        />
        {/* 경과선 */}
        <div
          className={cn(
            "absolute top-[22px] h-[6px] rounded-full",
            showAuto ? "bg-muted-foreground/40" : "bg-destructive",
          )}
          style={{ left: `${startPct}%`, width: `${Math.max(elapsedEnd - startPct, 0)}%` }}
        />

        {placed.map(({ node: n, left, lane }, index) => {
          const isDone = n.diff < 0;
          const isActive = index === activeIdx;
          if (n.auto) {
            return (
              <div
                key={`${n.kind}-${n.date}`}
                className="absolute z-30 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${left}%`, top: 12 + lane * LANE_H }}
              >
                {lane > 0 ? (
                  <span
                    className="absolute bottom-full w-px bg-muted-foreground/50"
                    style={{ height: lane * LANE_H - 10 }}
                  />
                ) : null}
                <div className="h-4 w-4 rounded-full border-2 border-background bg-foreground shadow-sm" />
                <span
                  className="mt-1 whitespace-nowrap rounded-md bg-background px-2 py-0.5 text-[11px] font-bold text-foreground shadow-sm"
                  title={`${n.label} · ${fmtDate(n.date)} (모듈·팀 최종 계획일)`}
                >
                  {n.label}
                </span>
                <span className="whitespace-nowrap rounded bg-background px-1 font-mono text-[10px] font-semibold text-foreground">
                  {fmtDate(n.date)}
                </span>
                <span className="whitespace-nowrap rounded bg-background px-1 font-mono text-[10px] font-extrabold text-destructive">
                  {dLabel(n.diff)}
                </span>
              </div>
            );
          }
          const Icon = isDone ? CheckCircle2 : isActive ? Clock : Circle;
          return (
            <div
              key={`${n.kind}-${n.date}`}
              className="absolute z-20 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${left}%`, top: 8 + lane * LANE_H }}
            >
              {lane > 0 ? (
                <span
                  className={cn(
                    "absolute bottom-full w-px",
                    showAuto ? "bg-muted-foreground/30" : "bg-border",
                  )}
                  style={{ height: lane * LANE_H - 14 }}
                />
              ) : null}
              <div
                className={cn(
                  "flex items-center justify-center rounded-full border-[3px] bg-background transition-all",
                  showAuto
                    ? "h-8 w-8 border-muted-foreground/40"
                    : isActive
                      ? "h-10 w-10 border-primary ring-4 ring-primary/20"
                      : isDone
                        ? "h-8 w-8 border-success ring-2 ring-success/20"
                        : "h-8 w-8 border-muted-foreground/40 bg-muted",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-center rounded-full",
                    showAuto
                      ? "h-6 w-6 bg-muted-foreground/30 text-muted-foreground"
                      : isActive
                        ? "h-7 w-7 bg-primary text-primary-foreground"
                        : isDone
                          ? "h-6 w-6 bg-success text-success-foreground"
                          : "h-6 w-6 bg-muted-foreground/20 text-muted-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      showAuto ? "h-3.5 w-3.5 text-muted-foreground" : isActive ? "h-4 w-4" : "h-3.5 w-3.5",
                      showAuto
                        ? "text-muted-foreground"
                        : isActive
                          ? "text-primary-foreground"
                          : isDone
                            ? "text-success-foreground"
                            : "text-muted-foreground",
                    )}
                  />
                </div>
              </div>
              <span
                className={cn(
                  "mt-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-bold uppercase leading-tight tracking-wide ring-1",
                  showAuto
                    ? "bg-muted text-muted-foreground ring-border"
                    : isActive
                      ? "bg-primary text-primary-foreground ring-primary"
                      : isDone
                        ? "bg-success/15 text-success ring-success/40"
                        : "bg-muted text-foreground ring-border",
                )}
                title={`${n.label} · ${fmtDate(n.date)}`}
              >
                {n.label}
              </span>
              <span className="mt-1 whitespace-nowrap rounded bg-background/90 px-1 font-mono text-[12px] font-bold text-muted-foreground">
                {fmtDate(n.date)}
              </span>
              {!isDone ? (
                <span
                  className={cn(
                    "whitespace-nowrap rounded bg-background/90 px-1 font-mono text-[12px] font-extrabold",
                    showAuto ? "text-muted-foreground/70" : isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {dLabel(n.diff)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
