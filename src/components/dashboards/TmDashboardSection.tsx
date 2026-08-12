import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { TmPlanVsActualCard } from "@/components/task-management/dashboard/TmPlanVsActualCard";
import { useTmScurveData } from "@/hooks/useTmScurveData";
import { resolveActualPct, resolveIsDelayed, resolvePlanPct } from "@/lib/task-management/delay-utils";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbTmFilters } from "@/lib/dashboards/pdb-filters";
import { useUnionWindow } from "@/lib/charts/use-union-window";
import { ProjectModuleSection } from "./ProjectModuleSection";

const PROGRESS_HINT =
  "진도현황 = Sub 과업 실적%(서버 정본 srv_actual_pct, 없으면 누적 실적) 단순 평균 · 건수 = 실적 환산 완료분 / 모집단";
const DELAY_HINT =
  "지연현황 = 정본 판정(resolveJudgment)이 지연 또는 악화인 과업 수 — 실적% < 선형 Plan%";

function useTmPlot(plot: "C" | "D", asOfDate: string, f: PdbTmFilters) {
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
    for (const it of q.scopedItems) {
      actualSum += resolveActualPct(it);
      if (resolveIsDelayed(it, q.thresholds, asOfDate)) delayed += 1;
    }
    return {
      total,
      delayed,
      actualCount: Math.round(actualSum),
      progressPct: total > 0 ? (actualSum / total) * 100 : null,
    };
  }, [q.scopedItems, q.thresholds, asOfDate]);
  return { ...q, kpi };
}

/** TM — 정본: useTmScurveData(= TM KPI Analysis 와 동일 훅), Plot 별 2회 호출 */
export function TmDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.tm ?? PDB_DEFAULTS.tm;
  const c = useTmPlot("C", asOfDate, f);
  const d = useTmPlot("D", asOfDate, f);
  const { window: win, report } = useUnionWindow();

  return (
    <ProjectModuleSection
      title="Task Management"
      to="/closure/task-management/kpi-analysis"
      progressHint="진도율 = 해당 Plot Sub 과업 실적%(서버 정본 srv_actual_pct, 없으면 누적 실적) 단순 평균 — TM KPI Analysis 와 동일"
      plots={[
        { plot: "D", progressPct: d.isLoading ? null : d.kpi.progressPct, total: d.kpi.total },
        { plot: "C", progressPct: c.isLoading ? null : c.kpi.progressPct, total: c.kpi.total },
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-2">
        {([["D", d], ["C", c]] as const).map(([label, q]) => (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                label={`Plot ${label} 진도현황`}
                count={q.kpi.actualCount}
                total={q.kpi.total}
                tone="ok"
                showTotal
                hint={PROGRESS_HINT}
              />
              <AbdKpiCard
                label={`Plot ${label} 지연현황`}
                count={q.kpi.delayed}
                total={q.kpi.total}
                tone="danger"
                showTotal
                hint={DELAY_HINT}
              />
            </div>
            <TmPlanVsActualCard
              items={q.scopedItems}
              asOfDate={asOfDate}
              startFrom={f.startDate}
              dim="hdec_pic_name"
              filterSummary={q.filterSummary}
              bucket={f.bucket}
              onBucketChange={() => {}}
              controlsHidden
              windowStart={win.start}
              windowEnd={win.end}
              onWindowResolved={(s, e) => report(label, s, e)}
              open={open}
              onOpenChange={setOpen}
            />
          </div>
        ))}
      </div>
    </ProjectModuleSection>
  );
}
