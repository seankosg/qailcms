import { useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { getSplRowsAsOf, getSplEstimatedCells, type SplCatalogEntry } from "@/lib/spl/rows.functions";
import { SplBreakdownCards } from "./SplBreakdownCards";
import { SplPlanVsActualCard } from "./SplPlanVsActualCard";
import { splSeriesColor, type SplBucket, type SplPlanMode, type SplSeriesGroup } from "@/lib/spl/scurve";
import { cn } from "@/lib/utils";

const routeApi = getRouteApi("/_authenticated/closure/spare-part/dashboard");

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

const BUCKETS: Array<{ v: SplBucket; label: string }> = [
  { v: "day", label: "Day" },
  { v: "week", label: "Week" },
  { v: "month", label: "Month" },
];
const RANGES = [30, 60, 120, 240, 480];
const PLAN_MODES: Array<{ v: SplPlanMode; label: string }> = [
  { v: "baseline", label: "Baseline Plan" },
  { v: "remaining", label: "Remaining Plan" },
];

/** 탭형 필터 버튼 — 모듈 공통 룩 */
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      className={cn("h-7 text-[11px]")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function SplDashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const rootNavigate = useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getSplRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["spl-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
  });

  const fetchEstimated = useServerFn(getSplEstimatedCells);
  const { data: estimated } = useQuery({
    queryKey: ["spl-estimated-cells"],
    queryFn: () => fetchEstimated({ data: undefined as never }),
  });

  const rows = data?.rows ?? [];
  const catalog: SplCatalogEntry[] = data?.catalog ?? [];

  /* ── 탭형 필터 ─────────────────────────────────────────── */
  const plot = search.plot ?? "all";
  const team = search.team ?? "all";
  const stageMode = search.stageMode === "stage" ? "stage" : "band";
  const bucket = (BUCKETS.find((b) => b.v === search.bucket)?.v ?? "week") as SplBucket;
  const rangeDays = search.range ?? 120;
  const planMode = (search.planMode === "remaining" ? "remaining" : "baseline") as SplPlanMode;
  const scurveOpen = (search.scurveOpen ?? 1) === 1;
  const selectedStages = (search.stages ?? "").split(",").filter(Boolean);

  const setSearch = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({ search: { ...search, ...patch }, replace: true });

  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        if (plot !== "all" && (r.plot ?? "") !== plot) return false;
        if (team !== "all" && (r.team ?? "") !== team) return false;
        return true;
      }),
    [rows, plot, team],
  );

  const orderedCatalog = useMemo(
    () => [...catalog].sort((a, b) => a.sort_order - b.sort_order),
    [catalog],
  );

  /** 차트 계열 = 밴드 3개 또는 단계 22개 (단계 탭 선택 시 부분집합) */
  const seriesGroups: SplSeriesGroup[] = useMemo(() => {
    if (stageMode === "band") {
      const bands: string[] = [];
      for (const c of orderedCatalog) if (!bands.includes(c.band)) bands.push(c.band);
      const picked = selectedStages.length > 0 ? bands.filter((b) => selectedStages.includes(b)) : bands;
      return picked.map((b, i) => ({
        key: b,
        label: BAND_LABEL[b] ?? b,
        color: splSeriesColor(bands.indexOf(b), bands.length),
        stages: orderedCatalog.filter((c) => c.band === b).map((c) => c.stage_code),
      }));
    }
    const picked =
      selectedStages.length > 0
        ? orderedCatalog.filter((c) => selectedStages.includes(c.stage_code))
        : orderedCatalog;
    return picked.map((c) => ({
      key: c.stage_code,
      label: c.short_code || c.label,
      color: splSeriesColor(orderedCatalog.findIndex((x) => x.stage_code === c.stage_code), orderedCatalog.length),
      stages: [c.stage_code],
    }));
  }, [orderedCatalog, stageMode, selectedStages.join(",")]);

  const toggleStage = (key: string) => {
    const next = selectedStages.includes(key)
      ? selectedStages.filter((s) => s !== key)
      : [...selectedStages, key];
    setSearch({ stages: next.join(",") });
  };

  const filterSummary = [
    { label: "Plot", value: plot === "all" ? "All" : `PLOT-${plot}` },
    { label: "Team", value: team === "all" ? "All" : team },
    { label: "As-of", value: asOf },
    { label: "Items", value: filteredRows.length.toLocaleString() },
  ];

  const delayBands = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of catalog) if (!s.chain_excluded) m.set(s.band, m.get(s.band) ?? 0);
    for (const r of filteredRows)
      if (r.primary_delay) m.set(r.primary_delay.band, (m.get(r.primary_delay.band) ?? 0) + 1);
    return [...m.entries()];
  }, [filteredRows, catalog]);

  const reqDoc = useMemo(() => {
    const full = filteredRows.filter((r) => r.req_doc_total > 0 && r.req_doc_done === r.req_doc_total).length;
    const sum = filteredRows.reduce((a, r) => a + r.req_doc_done, 0);
    const denom = filteredRows.reduce((a, r) => a + r.req_doc_total, 0);
    return { full, pct: denom === 0 ? 0 : Math.round((sum * 1000) / denom) / 10 };
  }, [filteredRows]);

  /** 필터가 걸리면 판정 카운트도 같은 모집단에서 다시 센다 (합계 = 모집단 검산 유지) */
  const counts = useMemo(() => {
    if (plot === "all" && team === "all") return data?.judgment_counts ?? {};
    const m: Record<string, number> = {};
    for (const r of filteredRows) m[r.judgment] = (m[r.judgment] ?? 0) + 1;
    return m;
  }, [data?.judgment_counts, filteredRows, plot, team]);
  const countsSum = JUDGMENTS.reduce((a, j) => a + (counts[j] ?? 0), 0);
  const population = plot === "all" && team === "all" ? (data?.total_count ?? 0) : filteredRows.length;
  const reconOk = countsSum === population;
  const viol = data?.violations;

  /** 카드 = 드릴다운 — Raw Data 로 이동하며 동일 술어를 검색 파라미터로 전달 */
  const drill = (patch: Record<string, unknown>) =>
    (rootNavigate as (opts: unknown) => void)({
      to: "/closure/spare-part/raw-data",
      search: {
        asOf: search.asOf ?? "",
        ...(plot !== "all" ? { plot } : {}),
        ...(team !== "all" ? { team } : {}),
        ...patch,
      },
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spare Part List — Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            All figures come from the canonical functions (spl_rows_as_of → spl_eval_as_of) and are recomputed on
            read. Clicking a card opens the matching Raw Data drill-down.
          </p>
        </div>
        <DataDatePicker
          value={search.asOf ?? ""}
          latest={data?.as_of ?? today}
          options={[]}
          onChange={(v) => setSearch({ asOf: v })}
          onReset={() => setSearch({ asOf: "" })}
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : error ? (
        <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <SplKpiCard
              label="Population (documents)"
              value={population}
              onClick={() => drill({ judgment: "all" })}
              note={reconOk ? "Sum = population ✓" : `Reconciliation mismatch: sum ${countsSum}`}
              tone={reconOk ? undefined : "warn"}
            />
            {JUDGMENTS.map((j) => (
              <SplKpiCard
                key={j}
                label={splJudgmentLabel(j)}
                value={counts[j] ?? 0}
                onClick={() => drill({ judgment: j })}
                note={
                  j === "미분류"
                    ? "No plan and no actual (denominator 0)"
                    : j === "지연"
                      ? "Documents with a primary delay"
                      : j === "미착수"
                        ? "No judgeable stage in the active band"
                        : j === "완료"
                          ? `No HDEC actual: ${data?.hdec_missing_done ?? 0}`
                          : undefined
                }
                tone={j === "지연" ? "bad" : j === "미분류" ? "warn" : undefined}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Primary delay by band</span>
            {delayBands.map(([band, n]) => (
              <Button
                key={band}
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => drill({ delayBand: band })}
              >
                {BAND_LABEL[band] ?? band} {n}
              </Button>
            ))}
            <Badge variant="outline" className="text-[11px]">
              Required documents ready {reqDoc.pct}% · fully ready {reqDoc.full} (not part of the judgment population)
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => drill({ hdecMissing: true })}
            >
              No HDEC actual: {data?.hdec_missing_items ?? 0}
            </Button>
            {viol && (
              <>
                <Badge variant={viol.total > 0 ? "destructive" : "outline"} className="gap-1 text-[11px]">
                  <AlertTriangle className="h-3 w-3" />
                  선후관계 위반 {viol.total}건
                  {viol.total > 0 && (
                    <span className="opacity-80">· 최근 임포트 발생 {viol.from_last_import}건</span>
                  )}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-[11px]"
                  title="No progress row exists for the preceding stage — HDEC import incomplete, not an actual sequence reversal"
                >
                  Data not loaded {viol.import_incomplete ?? 0}
                </Badge>
              </>
            )}
            {(data?.plan_items ?? 0) === 0 && (
              <Badge variant="secondary" className="text-[11px]">
                No HDEC plan dates loaded — delay judgment not applied (items with a plan date: {data?.plan_items ?? 0})
              </Badge>
            )}
            {!reconOk && (
              <Badge variant="outline" className="text-[11px] text-amber-600">
                Reconciliation mismatch: sum {countsSum} / population {population}
              </Badge>
            )}
            <Badge variant="outline" className="text-[11px]">
              Estimated actuals: {estimated?.items ?? 0} documents (back-filled · shown in italics)
            </Badge>
          </div>

          <SplBreakdownCards
            rows={filteredRows}
            catalog={orderedCatalog}
            onTeam={(t) => setSearch({ team: t })}
            onDrill={drill}
          />

          {/* 탭형 필터 — Plot · Team · 계열 단위 · 단계 · 버킷 · 기간 · 계획 모드 */}
          <div className="space-y-1.5 rounded-lg border p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] text-[11px] text-muted-foreground">Plot</span>
              {["all", "C", "D"].map((p) => (
                <TabButton key={p} active={plot === p} onClick={() => setSearch({ plot: p })}>
                  {p === "all" ? "All Plots" : `PLOT-${p}`}
                </TabButton>
              ))}
              <span className="ml-3 w-[40px] text-[11px] text-muted-foreground">Team</span>
              {["all", ...teams].map((t) => (
                <TabButton key={t} active={team === t} onClick={() => setSearch({ team: t })}>
                  {t === "all" ? "All Teams" : t}
                </TabButton>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] text-[11px] text-muted-foreground">Stage</span>
              <TabButton active={stageMode === "band"} onClick={() => setSearch({ stageMode: "band", stages: "" })}>
                Band (3)
              </TabButton>
              <TabButton active={stageMode === "stage"} onClick={() => setSearch({ stageMode: "stage", stages: "" })}>
                Stage (22)
              </TabButton>
              <span className="mx-1 h-4 w-px bg-border" />
              <TabButton active={selectedStages.length === 0} onClick={() => setSearch({ stages: "" })}>
                All
              </TabButton>
              {stageMode === "band"
                ? [...new Set(orderedCatalog.map((c) => c.band))].map((b) => (
                    <TabButton key={b} active={selectedStages.includes(b)} onClick={() => toggleStage(b)}>
                      {BAND_LABEL[b] ?? b}
                    </TabButton>
                  ))
                : orderedCatalog.map((c) => (
                    <TabButton
                      key={c.stage_code}
                      active={selectedStages.includes(c.stage_code)}
                      onClick={() => toggleStage(c.stage_code)}
                    >
                      {c.short_code || c.label}
                    </TabButton>
                  ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] text-[11px] text-muted-foreground">Bucket</span>
              {BUCKETS.map((b) => (
                <TabButton key={b.v} active={bucket === b.v} onClick={() => setSearch({ bucket: b.v })}>
                  {b.label}
                </TabButton>
              ))}
              <span className="ml-3 w-[40px] text-[11px] text-muted-foreground">Range</span>
              {RANGES.map((r) => (
                <TabButton key={r} active={rangeDays === r} onClick={() => setSearch({ range: r })}>
                  ±{r}d
                </TabButton>
              ))}
              <span className="ml-3 w-[52px] text-[11px] text-muted-foreground">Plan</span>
              {PLAN_MODES.map((m) => (
                <TabButton key={m.v} active={planMode === m.v} onClick={() => setSearch({ planMode: m.v })}>
                  {m.label}
                </TabButton>
              ))}
            </div>
          </div>

          <SplPlanVsActualCard
            rows={filteredRows}
            groups={seriesGroups}
            bucket={bucket}
            planMode={planMode}
            asOf={asOf}
            rangeDays={rangeDays}
            open={scurveOpen}
            onOpenChange={(v) => setSearch({ scurveOpen: v ? 1 : 0 })}
            filterSummary={filterSummary}
          />
        </>
      )}
    </div>
  );
}