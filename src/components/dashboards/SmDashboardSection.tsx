import { useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import {
  SnagKpiPlanVsActualCard,
  type SnagCurveUnit,
} from "@/components/defect-management/kpi/SnagKpiPlanVsActualCard";
import { useSnagScurveData } from "@/hooks/useSnagScurveData";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbSmFilters } from "@/lib/dashboards/pdb-filters";
import type { PlotKey, RoomGroupCol, TeamKey } from "@/lib/defect-management/dashboard-shape";
import { type Bucket, type Stage } from "@/lib/defect-management/progress-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";

function usePlot(plot: PlotKey, asOfDate: string, f: PdbSmFilters) {
  return useSnagScurveData({
    plot,
    teams: f.teams as TeamKey[],
    roomGroups: f.roomGroups as RoomGroupCol[],
    buildings: f.buildings,
    bucket: f.bucket as Bucket,
    planMode: f.planMode,
    stage: f.stage as Stage,
    groupBy: "team",
    asOfDate,
    rangeDays: 60,
    startDate: f.startDate,
  });
}

/** SM — 정본: useSnagScurveData(= SM KPI Analysis 와 동일 훅), Plot 별 2회 호출 */
export function SmDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.sm ?? PDB_DEFAULTS.sm;
  const stage = f.stage as Stage;
  const unit = f.unit as SnagCurveUnit;
  const c = usePlot("C", asOfDate, f);
  const d = usePlot("D", asOfDate, f);

  return (
    <ProjectModuleSection
      title="Snag Management"
      to="/closure/snag-management/kpi-analysis"
      progressHint="진도율 = 해당 Plot Closure 실적 누계 ÷ Closure 모수 — SM KPI Analysis 와 동일(서버 totals 정본)"
      plots={[
        {
          plot: "D",
          progressPct: d.stageTotal === 0 ? null : (d.baseline.actualUpto / d.stageTotal) * 100,
          total: d.stageTotal,
        },
        {
          plot: "C",
          progressPct: c.stageTotal === 0 ? null : (c.baseline.actualUpto / c.stageTotal) * 100,
          total: c.stageTotal,
        },
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-2">
        {([["D", d], ["C", c]] as const).map(([label, q]) => (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                label={`Plot ${label} 진도현황`}
                count={q.baseline.actualUpto}
                total={q.stageTotal}
                tone="ok"
                showTotal
                hint="진도현황 = as-of 기준 Closure actual_upto ÷ Closure 모수 — SM KPI Analysis 와 동일"
              />
              <AbdKpiCard
                label={`Plot ${label} 지연현황`}
                count={Math.max(0, q.baseline.planUpto - q.baseline.actualUpto)}
                total={q.stageTotal}
                tone="danger"
                showTotal
                hint="지연현황 = max(0, 계획 누계 plan_upto − 실적 누계 actual_upto)"
              />
            </div>
            <SnagKpiPlanVsActualCard
              cells={q.cells as never}
              buckets={q.buckets}
              stage={stage}
              today={q.today}
              asOfDate={asOfDate}
              bucket={f.bucket as Bucket}
              onBucketChange={() => {}}
              unit={unit}
              onUnitChange={() => {}}
              controlsHidden
              filterSummary={q.filterSummary}
              baselinePlan={q.baseline.plan}
              baselineActual={q.baseline.actual}
              planUpto={q.baseline.planUpto}
              actualUpto={q.baseline.actualUpto}
              stageTotal={q.stageTotal}
              open={open}
              onOpenChange={setOpen}
            />
          </div>
        ))}
      </div>
    </ProjectModuleSection>
  );
}
