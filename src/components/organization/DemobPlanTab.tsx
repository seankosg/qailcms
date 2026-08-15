/**
 * Organization > Demob Plan
 * HDEC PIC 개인별 모듈(TM·SM·ABD·SPL·WRT) 최종 종결일 기준 철수 시점 타임라인.
 * 열람 권한: System Administrator + 지정 사용자(정본은 RPC 내부 게이트).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDdMmmYyyy, todayInDoha } from "@/lib/time/doha";
import { buildDemobAxis, dayNum } from "@/lib/organization/demob-axis";
import { exportDemobPlanToExcel } from "@/lib/organization/export-demob-plan";
import {
  DEMOB_MODULES,
  MODULE_BAR,
  MODULE_LABEL,
  type DemobModule,
  type DemobPayload,
  type DemobRow,
} from "@/lib/organization/demob-types";
import { DemobDetailSheet } from "./DemobDetailSheet";

const MODULE_SET_ALL = new Set<DemobModule>(DEMOB_MODULES);

export function DemobPlanTab() {
  const [asOf, setAsOf] = useState(() => todayInDoha());
  const [q, setQ] = useState("");
  const [teamFilter, setTeamFilter] = useState<string | "all">("all");
  const [mods, setMods] = useState<Set<DemobModule>>(new Set(MODULE_SET_ALL));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DemobRow | null>(null);

  const dataQ = useQuery<DemobPayload>({
    queryKey: ["demob-plan"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("org_demob_plan");
      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("org_demob_plan: 예상치 못한 응답 형식");
      }
      return data as DemobPayload;
    },
  });

  const allRows = dataQ.data?.rows ?? [];

  /** 모듈 토글을 반영해 철수일을 재계산한다(끈 모듈은 계산에서 제외). */
  const rows = useMemo(() => {
    return allRows.map((r) => {
      const starts: string[] = [];
      const ends: string[] = [];
      for (const m of DEMOB_MODULES) {
        if (!mods.has(m)) continue;
        const c = r.per_module?.[m];
        if (c?.start) starts.push(c.start);
        if (c?.end) ends.push(c.end);
      }
      starts.sort();
      ends.sort();
      return {
        ...r,
        first_date: starts[0] ?? null,
        demob_date: ends[ends.length - 1] ?? null,
      };
    });
  }, [allRows, mods]);

  const teams = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.team ?? "미지정"))).sort((a, b) => a.localeCompare(b, "ko")),
    [allRows],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => (teamFilter === "all" ? true : (r.team ?? "미지정") === teamFilter))
      .filter((r) => (s ? r.pic_name.toLowerCase().includes(s) : true))
      .filter((r) => !!r.demob_date);
  }, [rows, teamFilter, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, DemobRow[]>();
    filtered.forEach((r) => {
      const key = r.team ?? "미지정";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    });
    return Array.from(m.entries()).map(([team, list]) => [
      team,
      list.slice().sort((a, b) => a.pic_name.localeCompare(b.pic_name, "ko")),
    ] as [string, DemobRow[]]);
  }, [filtered]);

  const todayNum = dayNum(asOf);
  const axis = useMemo(() => {
    const days: number[] = [];
    filtered.forEach((r) => {
      // 축 범위는 철수일(종결일) 기준. 비정상적으로 이른 시작일이 축 전체를 압축하지 않도록 제외.
      if (r.demob_date) days.push(dayNum(r.demob_date));
    });
    if (days.length === 0) days.push(todayNum);
    return buildDemobAxis(days, todayNum);
  }, [filtered, todayNum]);

  const kpi = useMemo(() => {
    const within = filtered.filter(
      (r) => r.demob_date && dayNum(r.demob_date) - todayNum <= 90 && dayNum(r.demob_date) >= todayNum,
    ).length;
    const last = filtered.reduce<string | null>(
      (acc, r) => (r.demob_date && (!acc || r.demob_date > acc) ? r.demob_date : acc),
      null,
    );
    const done = filtered.filter((r) => r.demob_date && dayNum(r.demob_date) < todayNum).length;
    return { total: filtered.length, within, last, done };
  }, [filtered, todayNum]);

  const toggleModule = (m: DemobModule) => {
    setMods((prev) => {
      const next = new Set(prev);
      if (next.has(m) && next.size > 1) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const toggleRow = (nn: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nn)) next.delete(nn); else next.add(nn);
      return next;
    });
  };

  if (dataQ.isLoading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }
  if (dataQ.error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Demob Plan 조회 실패: {(dataQ.error as Error).message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Demob Plan</h2>
          <p className="text-sm text-muted-foreground">
            개인별 모듈 최종 종결일 기준 철수 시점. 종결일 = 실적완료일(없으면 예상·계획완료일)의 최댓값.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">기준일</Label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40 text-xs" />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAsOf(todayInDoha())}>오늘</Button>
          <div className="space-y-1">
            <Label className="text-xs">검색</Label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름" className="h-8 w-40 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">팀</Label>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="all">All</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">모듈</Label>
            <div className="flex gap-1">
              {DEMOB_MODULES.map((m) => (
                <Toggle
                  key={m}
                  size="sm"
                  pressed={mods.has(m)}
                  onPressedChange={() => toggleModule(m)}
                  className="h-8 px-2 text-xs"
                >
                  <span className={cn("mr-1 h-2 w-2 rounded-full", MODULE_BAR[m])} />
                  {MODULE_LABEL[m]}
                </Toggle>
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => exportDemobPlanToExcel(filtered)}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="대상 인원" value={kpi.total} sub="철수일 산출 가능 인원" />
        <Kpi label="90일 내 철수" value={kpi.within} sub={`${asOf} 기준`} />
        <Kpi label="철수 가능" value={kpi.done} sub="기준일 이전 종결" />
        <Kpi label="최종 철수일" value={kpi.last ? formatDdMmmYyyy(kpi.last) : "-"} sub="전체 최댓값" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">철수 타임라인</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="min-w-[1000px]">
            {/* 헤더 축 */}
            <div className="flex">
              <div className="w-44 shrink-0 bg-card" />
              <div className="relative h-8 flex-1 border-b">
                {axis.ticks.map((t) => (
                  <div
                    key={t.day}
                    className="absolute bottom-0 top-0 flex flex-col items-center justify-end"
                    style={{ left: `${axis.pct(t.day)}%`, transform: "translateX(-50%)" }}
                  >
                    {t.major && (
                      <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                        {t.label}
                      </span>
                    )}
                    <span className={cn("w-px bg-border", t.major ? "h-2" : "h-1")} />
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              {/* 그리드 · 기준일 세로선 */}
              <div className="pointer-events-none absolute inset-0 flex">
                <div className="w-44 shrink-0" />
                <div className="relative flex-1">
                  {axis.ticks.map((t) => (
                    <div
                      key={t.day}
                      className={cn("absolute inset-y-0 w-px", t.major ? "bg-border/60" : "bg-border/30")}
                      style={{ left: `${axis.pct(t.day)}%` }}
                    />
                  ))}
                  <div className="absolute inset-y-0 w-0.5 bg-primary/60" style={{ left: `${axis.pct(todayNum)}%` }} />
                </div>
              </div>

              {grouped.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">표시할 인원이 없습니다.</div>
              )}

              {grouped.map(([team, list]) => (
                <div key={team}>
                  <div className="flex items-center border-b bg-muted/50">
                    <div className="w-44 shrink-0 bg-muted px-2 py-1 text-xs font-semibold">
                      {team} <span className="opacity-60">({list.length})</span>
                    </div>
                    <div className="flex-1" />
                  </div>

                  {list.map((r) => {
                    const isOpen = expanded.has(r.nn);
                    const done = !!r.demob_date && dayNum(r.demob_date) < todayNum;
                    return (
                      <div key={r.nn}>
                        {/* 사람 요약 행 */}
                        <div
                          className={cn(
                            "flex cursor-pointer items-center border-b hover:bg-accent/40",
                            done && "opacity-60",
                          )}
                          onClick={() => toggleRow(r.nn)}
                        >
                          <div className="flex w-44 shrink-0 items-center gap-1 bg-card px-2 py-1.5 text-xs">
                            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <span className="truncate font-medium">{r.pic_name}</span>
                            {!r.in_master && <Badge variant="outline" className="text-[9px]">미등록</Badge>}
                            {done && <Badge variant="secondary" className="text-[9px]">철수 가능</Badge>}
                          </div>
                          <div className="relative h-7 flex-1">
                            {r.first_date && r.demob_date && (
                              <div
                                className="absolute top-1/2 h-px -translate-y-1/2 border-t border-dashed border-muted-foreground/50"
                                style={{
                                  left: `${axis.pct(dayNum(r.first_date))}%`,
                                  width: `${Math.max(axis.pct(dayNum(r.demob_date)) - axis.pct(dayNum(r.first_date)), 0)}%`,
                                }}
                              />
                            )}
                            {r.demob_date && (
                              <div
                                className="absolute inset-y-0 flex -translate-x-1/2 flex-col items-center justify-center leading-none"
                                style={{ left: `${axis.pct(dayNum(r.demob_date))}%` }}
                              >
                                <span className="h-3 w-3 rotate-45 rounded-[2px] bg-primary" />
                                <button
                                  className="mt-0.5 whitespace-nowrap font-mono text-[10px] font-semibold text-primary underline-offset-2 hover:underline"
                                  onClick={(e) => { e.stopPropagation(); setDetail(r); }}
                                >
                                  {formatDdMmmYyyy(r.demob_date)}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 모듈 행 — 한 행에 한 모듈(데이터가 있는 모듈만 표시) */}
                        {isOpen && DEMOB_MODULES.filter((m) => mods.has(m) && !!r.per_module?.[m]?.end).map((m) => {
                          const c = r.per_module?.[m]!;
                          return (
                            <div key={m} className="flex items-center border-b bg-muted/20">
                              <div className="w-44 shrink-0 bg-card py-1 pl-7 pr-2 text-[11px] text-muted-foreground">
                                <span className={cn("mr-1 inline-block h-2 w-2 rounded-full align-middle", MODULE_BAR[m])} />
                                {MODULE_LABEL[m]}
                              </div>
                              <div className="relative h-6 flex-1">
                                <div
                                  className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full", MODULE_BAR[m])}
                                  style={{
                                    left: `${axis.pct(dayNum(c.start ?? c.end))}%`,
                                    width: `${Math.max(axis.pct(dayNum(c.end)) - axis.pct(dayNum(c.start ?? c.end)), 0.4)}%`,
                                  }}
                                  title={`${MODULE_LABEL[m]} ${c.start ? formatDdMmmYyyy(c.start) : "?"} ~ ${formatDdMmmYyyy(c.end)} · ${c.count}건`}
                                />
                                <span
                                  className="absolute inset-y-0 flex -translate-x-1/2 flex-col items-center justify-center leading-none"
                                  style={{ left: `${axis.pct(dayNum(c.end))}%` }}
                                >
                                  <span className={cn("h-2 w-2 rounded-full ring-2 ring-background", MODULE_BAR[m])} />
                                  <span className="mt-0.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                                    {formatDdMmmYyyy(c.end)}
                                  </span>
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <DemobDetailSheet row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
