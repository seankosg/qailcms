import { nowInDoha } from "@/lib/time/doha";
import { useEffect, useMemo, useState } from "react";
import { useAbdDataDate } from "@/hooks/useAbdDataDate";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarIcon,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { AbdRow1Kpis, AbdRow2Kpis } from "./AbdKpiRows";
import {
  AbdRow6Attention,
  AbdRow6Crosscut,
} from "./AbdChartsRows";
import { AbdAgingSettingsPopover, useAbdSettingsQuery } from "./AbdAgingSettingsPopover";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
// AbdDetailSheet 제거 → /closure/abd/detail/$id 전용 라우트로 이동
import { AbdStatusMixDonut } from "./AbdStatusMixDonut";
import { AbdJudgmentDonut } from "./AbdJudgmentDonut";
import { AbdJudgmentStageBreakdown } from "./AbdJudgmentStageBreakdown";
import { useAbdTeamList } from "@/hooks/useAbdTeamList";
import { ABD_TEAMS } from "@/lib/abd/columns";

export function AbdDashboardPage() {

  // ABD Data Date 는 세션 전역(useAbdDataDate)에 저장 → Raw Data/Progress 등과 공유,
  // 페이지 이동 후 복귀해도 유지된다. 빈 값이면 오늘(Doha)로 간주.
  const [sharedDate, setSharedDate] = useAbdDataDate();
  const [asOf, setAsOf] = useState<Date>(() => {
    if (sharedDate) {
      const d = new Date(sharedDate);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return nowInDoha();
  });
  useEffect(() => {
    const today = nowInDoha();
    const iso = format(asOf, "yyyy-MM-dd");
    const isToday = iso === format(today, "yyyy-MM-dd");
    const next = isToday ? "" : iso;
    if (next !== sharedDate) setSharedDate(next);
     
  }, [asOf]);
  const [plotFilter, setPlotFilter] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  // 팀 옵션 정본: 실측 distinct(abd_team_list) — 화면 필터와 무관한 전체 기준.
  const { data: teamList } = useAbdTeamList();
  const TEAM_OPTIONS = useMemo(
    () => (teamList && teamList.length > 0 ? teamList : ABD_TEAMS.map((t) => t.value as string)),
    [teamList],
  );
  const [batchFilter, setBatchFilter] = useState<string[]>([]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  // SSOT: 대시보드 필터 옵션 — abd_items_facets 로 조회
  const plotListQ = useQuery<string[]>({
    queryKey: ["abd-plot-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: "plot",
        _team: "MECH",
        _status_group: null,
        _plot: null,
        _q: null,
        _filters: [],
      });
      if (error) return [];
      return ((data ?? []) as any[])
        .map((r) => String(r.value ?? ""))
        .filter((v) => v && v !== "(empty)");
    },
    staleTime: 5 * 60_000,
  });
  const batchListQ = useQuery<string[]>({
    queryKey: ["abd-batch-list", plotFilter.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: "batch_no",
        _team: "MECH",
        _status_group: null,
        _plot: plotFilter.length === 1 ? plotFilter[0] : null,
        _q: null,
        _filters: [],
      });
      if (error) return [];
      return ((data ?? []) as any[])
        .map((r) => String(r.value ?? ""))
        .filter((v) => v && v !== "(empty)");
    },
    staleTime: 5 * 60_000,
  });
  // aging 설정을 사전 로드해 하위 카드에서 즉시 사용
  useAbdSettingsQuery();
  const isFetching = false;
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["abd-dash-row1"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-row2"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-attention"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-crosscut"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-judgment-mix"] });
  };

  const openRawData = (params: Record<string, string> = {}) => {
    const search: Record<string, string> = { ...params };
    // Row1/Row2 breakdown 클릭 시 `team`으로 전달되나 Raw Data는 `tab`을 소비.
    // 매핑하지 않으면 tab이 비어 기본값(MECH)로 잘려 나가 카드 카운트와 불일치.
    if (search.team && !search.tab) {
      search.tab = search.team;
    }
    delete search.team;
    // 카드 본문 클릭(팀 지정 없음)은 ABD 전 팀을 포함해야 카드 카운트와 일치.
    if (!search.tab) {
      search.tab = teamFilter.length ? teamFilter.join(",") : TEAM_OPTIONS.join(",");
    }
    if (batchFilter.length && !("batch" in search)) {
      search.batch = batchFilter.join(",");
    }
    if (plotFilter.length && !("plot" in search)) {
      search.plot = plotFilter.join(",");
    }
    const progressKeys = ["tab", "dis", "service", "hdec_pic_name", "hdec_eng_name", "docAx", "docAxx", "batch"];
    if (progressKeys.some((k) => k in search) && !("source" in search)) {
      search.source = "progress";
    }
    navigate({ to: "/closure/abd/raw-data", search: search as any });
  };

  const plotOptions = useMemo(() => {
    const set = new Set<string>(plotFilter);
    for (const v of plotListQ.data ?? []) set.add(v);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [plotListQ.data, plotFilter]);

  const batchOptions = useMemo(() => {
    const set = new Set<string>(batchFilter);
    for (const v of batchListQ.data ?? []) set.add(v);
    // Empty(데이터 없음) 칩은 항상 가장 오른쪽에 배치
    return Array.from(set).sort((a, b) => {
      const aEmpty = a === "__EMPTY__";
      const bEmpty = b === "__EMPTY__";
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      return a.localeCompare(b);
    });
  }, [batchListQ.data, batchFilter]);

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            As-Built Drawing Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            DS · DF · SB · RS · RESUBMIT · Approved 생애주기 6분류와 라운드 진척을 한눈에.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AbdAgingSettingsPopover />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 font-normal">
                <CalendarIcon className="h-4 w-4" />
                As of: {format(asOf, "dd-MMM-yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={asOf}
                onSelect={(d) => d && setAsOf(d)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar — 탭형 다중선택 (Plot · Team · Batch) */}
      <div className="space-y-2 rounded-md border bg-card p-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
          <FilterRow
            label="Plot"
            options={plotOptions}
            selected={plotFilter}
            onToggle={(v) => setPlotFilter((prev) => toggleIn(prev, v))}
            onClear={() => setPlotFilter([])}
            onAll={() => setPlotFilter([])}
            emptyText="Plot 데이터 없음"
          />
          <FilterRow
            label="Team"
            options={TEAM_OPTIONS}
            selected={teamFilter}
            onToggle={(v) => setTeamFilter((prev) => toggleIn(prev, v))}
            onClear={() => setTeamFilter([])}
            onAll={() => setTeamFilter([])}
            emptyText="Team 데이터 없음"
          />
        </div>
        <FilterRow
          label="Batch"
          options={batchOptions}
          selected={batchFilter}
          onToggle={(v) => setBatchFilter((prev) => toggleIn(prev, v))}
          onClear={() => setBatchFilter([])}
          onAll={() => setBatchFilter([])}
          emptyText="Batch 데이터 없음"
        />
      </div>

      {/* Row 1 — 배타적 5분류 (Total / Approved / UR / DS / NS) */}
      <AbdRow1Kpis plots={plotFilter} teams={teamFilter} batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 2 — 지연 (Total / RS / SB / DS / No Plan) */}
      <AbdRow2Kpis plots={plotFilter} teams={teamFilter} batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 2.5 — Status Mix / 자동 판정 분포 / 스테이지별 판정 스택 (TM 이식) */}
      <div className="grid gap-4 xl:grid-cols-3">
        <AbdStatusMixDonut plots={plotFilter} batchNo={batchFilter} />
        <AbdJudgmentDonut plots={plotFilter} batchNo={batchFilter} />
        <AbdJudgmentStageBreakdown plots={plotFilter} batchNo={batchFilter} />
      </div>

      {/* Row 4 — Attention Lists + Cross-cut */}
      <div className="grid gap-4 xl:grid-cols-2">
        <AbdRow6Attention
          plots={plotFilter}
          teams={teamFilter}
          batchNo={batchFilter}
          onOpenRaw={openRawData}
          onOpenDetail={(id, focus) =>
            navigate({
              to: "/closure/abd/detail/$id",
              params: { id },
              search: focus ? { focus } : {},
            })
          }
        />
        <AbdRow6Crosscut plots={plotFilter} teams={teamFilter} batchNo={batchFilter} onOpenRaw={openRawData} />
      </div>
      {/* ABD detail drilldown → 전용 라우트 */}
    </div>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
  onClear,
  onAll,
  emptyText,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  onAll: () => void;
  emptyText: string;
}) {
  const isAll = selected.length === 0;
  return (
    <div className="flex items-start gap-2">
      <div className="pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0 w-14">
        {label}
      </div>
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onAll}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            isAll
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          All
        </button>
        {options.length === 0 && (
          <span className="px-2 py-1 text-xs text-muted-foreground">{emptyText}</span>
        )}
        {options.map((v) => {
          const active = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors max-w-[220px] truncate",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted",
              )}
              title={v}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="pt-1.5 shrink-0 text-[11px] text-muted-foreground">
        {selected.length > 0 ? (
          <button className="text-primary hover:underline" onClick={onClear}>
            Clear ({selected.length})
          </button>
        ) : (
          <span>All</span>
        )}
      </div>
    </div>
  );
}

