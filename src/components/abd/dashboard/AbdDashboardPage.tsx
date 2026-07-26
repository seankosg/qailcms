import { nowInDoha } from "@/lib/time/doha";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarIcon,
  RefreshCw,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { AbdRow1Kpis, AbdRow2Kpis } from "./AbdKpiRows";
import {
  AbdRow4ApprovalTrend,
  AbdRow6Attention,
  AbdRow6Crosscut,
} from "./AbdChartsRows";
import { AbdAgingSettingsPopover, useAbdSettingsQuery } from "./AbdAgingSettingsPopover";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AbdDetailSheet } from "@/components/abd/raw-data/AbdDetailSheet";
import { AbdStatusMixDonut } from "./AbdStatusMixDonut";
import { AbdJudgmentDonut } from "./AbdJudgmentDonut";
import { AbdJudgmentStageBreakdown } from "./AbdJudgmentStageBreakdown";

export function AbdDashboardPage() {
  const [asOf, setAsOf] = useState<Date>(() => nowInDoha());
  const [batchFilter, setBatchFilter] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ id: string; focus?: "rounds" | "aconex" | "comments" } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  // SSOT: 대시보드 상단 필터를 위한 batch 옵션 — abd_items_facets("batch_no")로 조회
  const batchListQ = useQuery<string[]>({
    queryKey: ["abd-batch-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("abd_items_facets", {
        _column: "batch_no",
        _team: "MECH", // team 무관 조회를 위해 임의값 — 이후 union 대체 예정
        _status_group: null,
        _include_inactive: false,
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
  // aging 설정을 사전 로드해 하위 카드에서 즉시 사용
  useAbdSettingsQuery();
  const isFetching = false;
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ["abd-dash-row1"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-row2"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-status"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-trend"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-attention"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-crosscut"] });
    qc.invalidateQueries({ queryKey: ["abd-dash-judgment-mix"] });
  };

  const openRawData = (params: Record<string, string> = {}) => {
    const search: Record<string, string> = { ...params };
    if (batchFilter.length && !("batch" in search)) {
      search.batch = batchFilter.join(",");
    }
    const progressKeys = ["team", "dis", "service", "hdec_pic_name", "hdec_eng_name", "docAx", "docAxx", "batch"];
    if (progressKeys.some((k) => k in search) && !("source" in search)) {
      search.source = "progress";
    }
    navigate({ to: "/closure/abd/raw-data", search: search as any });
  };

  const batchOptions = useMemo(() => {
    const set = new Set<string>(batchFilter);
    for (const v of batchListQ.data ?? []) set.add(v);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [batchListQ.data, batchFilter]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            As-Built Drawing Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            NS · DS · UR · Approved 5분류와 라운드 진척을 한눈에.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AbdAgingSettingsPopover />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 font-normal">
                <Filter className="h-4 w-4" />
                Batch: {batchFilter.length ? `${batchFilter.length} selected` : "All"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-medium text-muted-foreground">Filter by Batch No.</span>
                {batchFilter.length > 0 && (
                  <button
                    className="text-[11px] text-primary hover:underline"
                    onClick={() => setBatchFilter([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-0.5">
                {batchOptions.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Batch 데이터 없음
                  </div>
                )}
                {batchOptions.map((b) => {
                  const checked = batchFilter.includes(b);
                  return (
                    <label
                      key={b}
                      className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setBatchFilter((prev) =>
                            e.target.checked ? [...prev, b] : prev.filter((x) => x !== b),
                          );
                        }}
                      />
                      <span className="truncate">{b}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
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

      {/* Row 1 — 배타적 5분류 (Total / Approved / UR / DS / NS) */}
      <AbdRow1Kpis batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 2 — 지연 (Total / RS / SB / DS / No Plan) */}
      <AbdRow2Kpis batchNo={batchFilter} onOpenRaw={openRawData} />

      {/* Row 2.5 — Status Mix / 자동 판정 분포 / 스테이지별 판정 스택 (TM 이식) */}
      <div className="grid gap-4 xl:grid-cols-3">
        <AbdStatusMixDonut batchNo={batchFilter} />
        <AbdJudgmentDonut batchNo={batchFilter} />
        <AbdJudgmentStageBreakdown batchNo={batchFilter} />
      </div>

      {/* Row 3 — Latest Status Distribution + Row 4 — Approval Trend */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <AbdRow3StatusDist batchNo={batchFilter} onOpenRaw={openRawData} />
        </div>
        <div className="xl:col-span-2">
          <AbdRow4ApprovalTrend batchNo={batchFilter} onOpenRaw={openRawData} />
        </div>
      </div>

      {/* Row 5 — Attention Lists + Cross-cut */}
      <div className="grid gap-4 xl:grid-cols-2">
        <AbdRow6Attention
          batchNo={batchFilter}
          onOpenRaw={openRawData}
          onOpenDetail={(id, focus) => setDetail({ id, focus })}
        />
        <AbdRow6Crosscut batchNo={batchFilter} onOpenRaw={openRawData} />
      </div>
      <AbdDetailSheet
        id={detail?.id ?? null}
        focusSection={detail?.focus ?? null}
        onOpenChange={(open) => { if (!open) setDetail(null); }}
      />
    </div>
  );
}

