import { useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { getSplRowsAsOf, type SplCatalogEntry } from "@/lib/spl/rows.functions";
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
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getSplRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["spl-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
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

  /** 카드 = 드릴다운 — Raw Data 로 이동하며 동일 술어를 검색 파라미터로 전달 */
  const drill = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({
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
          <SplBreakdownCards
            rows={filteredRows}
            catalog={orderedCatalog}
            asOf={data?.as_of ?? today}
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