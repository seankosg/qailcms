import { useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { getTocRowsAsOf, type TocCatalogEntry } from "@/lib/toc/rows.functions";
import { TOC_BANDS } from "@/lib/toc/columns";
import { asSplRows, tocSeriesColor, type TocBucket, type TocPlanMode, type TocSeriesGroup } from "@/lib/toc/scurve";
import { SplPlanVsActualCard } from "@/components/spl/dashboard/SplPlanVsActualCard";
import { TocBreakdownCards } from "./TocBreakdownCards";

const routeApi = getRouteApi("/_authenticated/closure/toc/dashboard");

const BUCKETS: Array<{ v: TocBucket; label: string }> = [
  { v: "day", label: "Day" },
  { v: "week", label: "Week" },
  { v: "month", label: "Month" },
];
const RANGES = [30, 60, 120, 240, 480];
const PLAN_MODES: Array<{ v: TocPlanMode; label: string }> = [
  { v: "baseline", label: "Baseline Plan" },
  { v: "remaining", label: "Remaining Plan" },
];

const BAND_LABEL: Record<string, string> = Object.fromEntries(TOC_BANDS.map((b) => [b.band, b.label]));

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} className={cn("h-7 text-[11px]")} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Handover (TOC) Dashboard — SPL 대시보드와 동일 구성.
 * 데이터는 정본 `toc_rows_as_of` 하나만 사용하고, 카드 클릭은 Raw Data 드릴다운으로 이어진다.
 */
export function TocDashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getTocRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["toc-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: search.asOf || null } }),
  });

  const rows = data?.rows ?? [];
  const catalog: TocCatalogEntry[] = data?.catalog ?? [];

  const plot = search.plot ?? "all";
  const team = search.team ?? "all";
  const stageMode = search.stageMode === "stage" ? "stage" : "band";
  const bucket = (BUCKETS.find((b) => b.v === search.bucket)?.v ?? "week") as TocBucket;
  const rangeDays = search.range ?? 120;
  const planMode = (search.planMode === "remaining" ? "remaining" : "baseline") as TocPlanMode;
  const scurveOpen = (search.scurveOpen ?? 1) === 1;
  const selectedStages = (search.stages ?? "").split(",").filter(Boolean);

  const setSearch = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({ search: { ...search, ...patch }, replace: true });

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(), [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        if (plot !== "all" && (r.plot ?? "") !== plot) return false;
        if (team !== "all" && (r.team ?? "") !== team) return false;
        return true;
      }),
    [rows, plot, team],
  );

  const orderedCatalog = useMemo(() => [...catalog].sort((a, b) => a.sort_order - b.sort_order), [catalog]);

  const seriesGroups: TocSeriesGroup[] = useMemo(() => {
    if (stageMode === "band") {
      const bands: string[] = [];
      for (const c of orderedCatalog) if (!bands.includes(c.band)) bands.push(c.band);
      const picked = selectedStages.length > 0 ? bands.filter((b) => selectedStages.includes(b)) : bands;
      return picked.map((b) => ({
        key: b,
        label: BAND_LABEL[b] ?? b,
        color: tocSeriesColor(bands.indexOf(b), bands.length),
        stages: orderedCatalog.filter((c) => c.band === b).map((c) => c.stage_code),
      }));
    }
    const picked =
      selectedStages.length > 0 ? orderedCatalog.filter((c) => selectedStages.includes(c.stage_code)) : orderedCatalog;
    return picked.map((c) => ({
      key: c.stage_code,
      label: c.short_code || c.label,
      color: tocSeriesColor(
        orderedCatalog.findIndex((x) => x.stage_code === c.stage_code),
        orderedCatalog.length,
      ),
      stages: [c.stage_code],
    }));
  }, [orderedCatalog, stageMode, selectedStages.join(",")]);

  const toggleStage = (key: string) => {
    const next = selectedStages.includes(key) ? selectedStages.filter((s) => s !== key) : [...selectedStages, key];
    setSearch({ stages: next.join(",") });
  };

  const filterSummary = [
    { label: "Plot", value: plot === "all" ? "All" : `PLOT-${plot}` },
    { label: "Team", value: team === "all" ? "All" : team },
    { label: "As-of", value: asOf },
    { label: "Items", value: filteredRows.length.toLocaleString() },
  ];

  const drill = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({
      to: "/closure/toc/raw-data",
      search: { asOf: search.asOf ?? "", ...patch },
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Handover (TOC) — Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            모든 수치는 정본 함수(toc_rows_as_of → toc_eval_as_of)를 거쳐 조회 시점에 다시 계산됩니다. 카드를 누르면 같은
            조건의 Raw Data 로 이동합니다.
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
          <TocBreakdownCards rows={filteredRows} catalog={orderedCatalog} onDrill={drill} />

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
                Band ({TOC_BANDS.length})
              </TabButton>
              <TabButton active={stageMode === "stage"} onClick={() => setSearch({ stageMode: "stage", stages: "" })}>
                Stage ({orderedCatalog.length})
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
            rows={asSplRows(filteredRows)}
            groups={seriesGroups}
            bucket={bucket}
            planMode={planMode}
            asOf={asOf}
            rangeDays={rangeDays}
            open={scurveOpen}
            onOpenChange={(v: boolean) => setSearch({ scurveOpen: v ? 1 : 0 })}
            filterSummary={filterSummary}
          />
        </>
      )}
    </div>
  );
}
