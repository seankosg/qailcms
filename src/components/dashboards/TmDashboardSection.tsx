import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { TmPlanVsActualCard } from "@/components/task-management/dashboard/TmPlanVsActualCard";
import { useTmScurveData } from "@/hooks/useTmScurveData";
import {
  resolveActualPct,
  resolveIsDelayed,
  resolvePlanPct,
} from "@/lib/task-management/delay-utils";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbTmFilters } from "@/lib/dashboards/pdb-filters";
import { useUnionWindow } from "@/lib/charts/use-union-window";
import { ProjectModuleSection } from "./ProjectModuleSection";
import { PdbBreakdownCard, foldTop4 } from "./PdbBreakdownCard";
import { usePdbLang, usePdbT } from "@/lib/dashboards/pdb-i18n";
import { usePdbPlot, filterByPlot, plotGridClass } from "@/lib/dashboards/pdb-plot";

/** 필터 요약 배지의 한국어 값(Delay 옵션 라벨)만 영문으로 옮긴다. */
const DELAY_EN: Record<string, string> = {
  전체: "All",
  지연: "Delayed",
  악화: "At Risk",
};

function useTmPlot(
  plot: "C" | "D",
  asOfDate: string,
  f: PdbTmFilters,
  labels: { others: string; unassigned: string },
) {
  const q = useTmScurveData({
    asOfDate,
    plots: [plot],
    disciplines: f.disciplines,
    taskScope: f.taskScope,
    workType: f.workType,
    delayFilter: f.delayFilter,
  });
  const kpi = useMemo(() => {
    const total = q.scopedItems.length;
    let delayed = 0;
    let actualSum = 0;
    let planSum = 0;
    const byType = new Map<string, { count: number; actual: number }>();
    for (const it of q.scopedItems) {
      const a = resolveActualPct(it);
      actualSum += a;
      planSum += resolvePlanPct(it, asOfDate);
      if (resolveIsDelayed(it, q.thresholds, asOfDate)) delayed += 1;
      const wt = ((it as { row_type?: string | null }).row_type ?? "").trim() || labels.unassigned;
      if (wt.toLowerCase() === "others") continue;
      const cur = byType.get(wt) ?? { count: 0, actual: 0 };
      cur.count += 1;
      cur.actual += a;
      byType.set(wt, cur);
    }
    const progressPct = total > 0 ? (actualSum / total) * 100 : null;
    const planPct = total > 0 ? (planSum / total) * 100 : null;
    const diffPct = progressPct != null && planPct != null ? progressPct - planPct : null;
    return {
      total,
      delayed,
      workTypes: foldTop4(
        [...byType.entries()].map(([key, v]) => ({ key, count: v.count, actual: v.actual })),
        labels.others,
      ),
      actualCount: Math.round(actualSum),
      planCount: Math.round(planSum),
      progressPct,
      planPct,
      actualPct: progressPct,
      diffPct,
    };
  }, [q.scopedItems, q.thresholds, asOfDate, labels.others, labels.unassigned]);

  return { ...q, kpi };
}

/** TM — 정본: useTmScurveData(= TM KPI Analysis 와 동일 훅), Plot 별 2회 호출 */
export function TmDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.tm ?? PDB_DEFAULTS.tm;
  const t = usePdbT();
  const { lang } = usePdbLang();
  const labels = useMemo(
    () => ({ others: t("others"), unassigned: t("unassigned") }),
    [t],
  );
  const c = useTmPlot("C", asOfDate, f, labels);
  const d = useTmPlot("D", asOfDate, f, labels);
  const { window: win, report } = useUnionWindow();
  const { plotFilter } = usePdbPlot();
  const columns = filterByPlot(
    [
      { plot: "D" as const, q: d },
      { plot: "C" as const, q: c },
    ],
    plotFilter,
  );

  return (
    <ProjectModuleSection
      title="Task Management"
      to="/closure/task-management/dashboard"
      tone="tm"
      progressHint={t("hintTmSection")}
      plots={[
        { plot: "D", progressPct: d.isLoading ? null : d.kpi.progressPct, total: d.kpi.total },
        { plot: "C", progressPct: c.isLoading ? null : c.kpi.progressPct, total: c.kpi.total },
      ]}
    >
      <div className={plotGridClass(plotFilter)}>
        {columns.map(({ plot: label, q }) => (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                presentation="project-summary"
                lang={lang}
                label={t("plannedVsActual")}
                count={q.kpi.actualCount}
                total={q.kpi.total}
                tone={q.kpi.diffPct != null && q.kpi.diffPct < 0 ? "danger" : "ok"}
                showTotal
                hint={t("hintTmProgress")}
                actualPct={q.kpi.actualPct ?? undefined}
                planPct={q.kpi.planPct ?? undefined}
                variant="tm-progress"
                leftSub={`A ${q.kpi.actualCount.toLocaleString()} / P ${q.kpi.planCount.toLocaleString()}`}
                rightValue={`${q.kpi.diffPct != null ? `${q.kpi.diffPct > 0 ? "+" : ""}${q.kpi.diffPct.toFixed(1)}` : "—"}%`}
                rightSub={`A ${q.kpi.actualPct?.toFixed(1) ?? "—"}% / P ${q.kpi.planPct?.toFixed(1) ?? "—"}%`}
              />

              <PdbBreakdownCard
                label={t("byWorkType")}
                rows={q.kpi.workTypes}
                hint={t("hintTmWorkType")}
              />
            </div>
            <TmPlanVsActualCard
              items={q.scopedItems}
              asOfDate={asOfDate}
              lang={lang}
              startFrom={f.startDate}
              dim="hdec_pic_name"
              filterSummary={
                lang === "en"
                  ? q.filterSummary.map((s) => ({
                      ...s,
                      value: DELAY_EN[s.value] ?? s.value,
                    }))
                  : q.filterSummary
              }
              bucket={f.bucket}
              onBucketChange={() => {}}
              controlsHidden
              windowStart={win.start}
              windowEnd={win.end}
              onWindowResolved={(s, e) => report(label, s, e)}
              open={open}
              onOpenChange={setOpen}
              chartHeight={306}
            />
          </div>
        ))}
      </div>
    </ProjectModuleSection>
  );
}
