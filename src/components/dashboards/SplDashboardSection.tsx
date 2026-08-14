import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { SplPlanVsActualCard } from "@/components/spl/dashboard/SplPlanVsActualCard";
import { getSplRowsAsOf, type SplCatalogEntry, type SplRow } from "@/lib/spl/rows.functions";
import {
  buildSplSCurve,
  splSeriesColor,
  type SplBucket,
  type SplPlanMode,
  type SplSeriesGroup,
} from "@/lib/spl/scurve";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbSplFilters } from "@/lib/dashboards/pdb-filters";
import { ProjectModuleSection } from "./ProjectModuleSection";
import { PdbBreakdownCard, type BreakdownRow } from "./PdbBreakdownCard";
import { usePdbLang, usePdbT } from "@/lib/dashboards/pdb-i18n";
import { usePdbPlot, filterByPlot, plotGridClass } from "@/lib/dashboards/pdb-plot";

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

/** 계열 구성 — 설정의 계열 단위(밴드/단계)와 선택 목록을 그대로 따른다 */
function buildGroups(catalog: SplCatalogEntry[], f: PdbSplFilters): SplSeriesGroup[] {
  const ordered = [...catalog].sort((a, b) => a.sort_order - b.sort_order);
  if (f.stageMode === "stage") {
    const picked =
      f.stages.length > 0 ? ordered.filter((c) => f.stages.includes(c.stage_code)) : ordered;
    return picked.map((c) => ({
      key: c.stage_code,
      label: c.short_code || c.stage_code,
      color: splSeriesColor(
        ordered.findIndex((x) => x.stage_code === c.stage_code),
        ordered.length,
      ),
      stages: [c.stage_code],
    }));
  }
  const all: string[] = [];
  for (const c of ordered) if (!all.includes(c.band)) all.push(c.band);
  const picked = f.bands.length > 0 ? all.filter((b) => f.bands.includes(b)) : all;
  return picked.map((b) => ({
    key: b,
    label: BAND_LABEL[b] ?? b,
    color: splSeriesColor(all.indexOf(b), all.length),
    stages: ordered.filter((c) => c.band === b).map((c) => c.stage_code),
  }));
}

function usePlotView(
  plot: "C" | "D",
  rows: SplRow[],
  catalog: SplCatalogEntry[],
  asOf: string,
  f: PdbSplFilters,
) {
  const plotRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (r.plot ?? "") === plot &&
          (f.teams.length === 0 || f.teams.includes(r.team ?? "")),
      ),
    [rows, plot, f.teams],
  );
  const groups = useMemo(
    () => buildGroups(catalog, f),
    [catalog, f.stageMode, f.bands.join(","), f.stages.join(",")],
  );
  const scurve = useMemo(
    () =>
      buildSplSCurve({
        rows: plotRows,
        groups,
        bucket: f.bucket as SplBucket,
        planMode: f.planMode as SplPlanMode,
        asOf,
        rangeDays: f.rangeDays,
      }),
    [plotRows, groups, f.bucket, f.planMode, f.rangeDays, asOf],
  );

  const kpi = useMemo(() => {
    const idx = scurve.todayIndex >= 0 ? scurve.todayIndex : scurve.buckets.length - 1;
    let total = 0;
    let actual = 0;
    let plan = 0;
    const bands: BreakdownRow[] = [];
    for (const g of groups) {
      const s = scurve.series.find((x) => x.key === g.key);
      const denom = s?.denom ?? 0;
      const a = (s?.cumActual[idx] ?? 0) as number;
      const p = s?.cumPlan[idx] ?? 0;
      total += denom;
      actual += a;
      plan += p;
      bands.push({ key: g.label, count: denom, pct: denom > 0 ? (a / denom) * 100 : null });
    }
    return {
      total,
      actual,
      plan,
      bands,
      progressPct: total > 0 ? (actual / total) * 100 : null,
    };
  }, [scurve, groups]);

  return { plotRows, groups, kpi };
}

/** SPL — 정본: spl_rows_as_of (SPL Dashboard 와 동일 데이터·동일 차트) */
export function SplDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.spl ?? PDB_DEFAULTS.spl;
  const t = usePdbT();
  const { lang } = usePdbLang();
  const { plotFilter } = usePdbPlot();

  const fetchRows = useServerFn(getSplRowsAsOf);
  const { data, isLoading } = useQuery({
    queryKey: ["spl-rows-as-of", asOfDate],
    queryFn: () => fetchRows({ data: { as_of: asOfDate } }),
  });
  const rows = data?.rows ?? [];
  const catalog = data?.catalog ?? [];
  const asOf = data?.as_of ?? asOfDate;

  const d = usePlotView("D", rows, catalog, asOf, f);
  const c = usePlotView("C", rows, catalog, asOf, f);

  const columns = filterByPlot(
    [
      { plot: "D" as const, v: d },
      { plot: "C" as const, v: c },
    ],
    plotFilter,
  );

  return (
    <ProjectModuleSection
      title="Spare Part List"
      to="/closure/spare-part/dashboard"
      tone="spl"
      progressHint={t("hintSplSection")}
      plots={[
        { plot: "D" as const, progressPct: isLoading ? null : d.kpi.progressPct, total: d.kpi.total },
        { plot: "C" as const, progressPct: isLoading ? null : c.kpi.progressPct, total: c.kpi.total },
      ]}
    >
      <div className={plotGridClass(plotFilter)}>
        {columns.map(({ plot: label, v }) => {
          const actualPct = v.kpi.total > 0 ? (v.kpi.actual / v.kpi.total) * 100 : null;
          const planPct = v.kpi.total > 0 ? (v.kpi.plan / v.kpi.total) * 100 : null;
          const diffPct = actualPct != null && planPct != null ? actualPct - planPct : null;
          return (
            <div key={label} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <AbdKpiCard
                  presentation="project-summary"
                  lang={lang}
                  label={t("progressStatus")}
                  count={v.kpi.actual}
                  total={v.kpi.total}
                  tone={diffPct != null && diffPct < 0 ? "danger" : "ok"}
                  showTotal
                  hint={t("hintSplProgress")}
                  actualPct={actualPct ?? undefined}
                  planPct={planPct ?? undefined}
                  variant="tm-progress"
                  leftSub={`A ${v.kpi.actual.toLocaleString()} / P ${v.kpi.plan.toLocaleString()}`}
                  rightValue={`${diffPct != null ? `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}` : "—"}%`}
                  rightSub={`A ${actualPct?.toFixed(1) ?? "—"}% / P ${planPct?.toFixed(1) ?? "—"}%`}
                />
                <PdbBreakdownCard
                  label={t("bandProgress")}
                  rows={v.kpi.bands}
                  hint={t("hintSplBand")}
                />
              </div>
              <SplPlanVsActualCard
                rows={v.plotRows}
                groups={v.groups}
                bucket={f.bucket as SplBucket}
                planMode={f.planMode as SplPlanMode}
                asOf={asOf}
                rangeDays={f.rangeDays}
                open={open}
                onOpenChange={setOpen}
                filterSummary={[
                  { label: "Plot", value: `PLOT-${label}` },
                  { label: "Team", value: f.teams.length === 0 ? "All" : f.teams.join(", ") },
                  { label: "As-of", value: asOf },
                  { label: "Items", value: v.plotRows.length.toLocaleString() },
                ]}
              />
            </div>
          );
        })}
      </div>
    </ProjectModuleSection>
  );
}
