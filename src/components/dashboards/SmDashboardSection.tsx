import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import {
  SnagKpiPlanVsActualCard,
  type SnagCurveUnit,
} from "@/components/defect-management/kpi/SnagKpiPlanVsActualCard";
import { useSnagScurveData } from "@/hooks/useSnagScurveData";
import type { PlotKey } from "@/lib/defect-management/dashboard-shape";
import type { Bucket, Stage } from "@/lib/defect-management/progress-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";

const STAGE: Stage = "closure";

function usePlot(plot: PlotKey, asOfDate: string, bucket: Bucket) {
  return useSnagScurveData({
    plot,
    teams: [],
    roomGroups: [],
    buildings: [],
    bucket,
    planMode: "baseline",
    stage: STAGE,
    groupBy: "team",
    asOfDate,
    rangeDays: 60,
  });
}

/** SM — 정본: useSnagScurveData(= SM KPI Analysis 와 동일 훅), Plot 별 2회 호출 */
export function SmDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [bucket, setBucket] = useState<Bucket>("week");
  const [unit, setUnit] = useState<SnagCurveUnit>("cnt");
  const [open, setOpen] = useState(true);
  const c = usePlot("C", asOfDate, bucket);
  const d = usePlot("D", asOfDate, bucket);

  const kpi = useMemo(() => {
    const total = c.stageTotal + d.stageTotal;
    const actual = c.baseline.actualUpto + d.baseline.actualUpto;
    const plan = c.baseline.planUpto + d.baseline.planUpto;
    return {
      total,
      actual,
      plan,
      behind: Math.max(0, plan - actual),
      progressPct: total > 0 ? (actual / total) * 100 : null,
    };
  }, [c.stageTotal, d.stageTotal, c.baseline, d.baseline]);

  const loading = c.loading || d.loading;

  return (
    <ProjectModuleSection
      title="Snag Management"
      to="/defect-management/kpi"
      progressPct={loading ? null : kpi.progressPct}
      progressHint="진도율 = Closure 실적 누계 ÷ Closure 모수 — SM KPI Analysis 와 동일(서버 totals 정본)"
      asOfNote={`Plot C ${c.stageTotal.toLocaleString()} · D ${d.stageTotal.toLocaleString()}`}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AbdKpiCard label="Total (Closure 모수)" count={kpi.total} hint="Plot C + D 의 Closure 스테이지 모수" />
        <AbdKpiCard label="실적 누계" count={kpi.actual} total={kpi.total} tone="ok" hint="as-of 기준 actual_upto 합" />
        <AbdKpiCard label="계획 누계" count={kpi.plan} total={kpi.total} tone="info" hint="as-of 기준 plan_upto 합" />
        <AbdKpiCard
          label="계획 대비 미달"
          count={kpi.behind}
          total={kpi.total}
          tone="danger"
          hint="max(0, 계획 누계 − 실적 누계)"
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {([["C", c], ["D", d]] as const).map(([label, q]) => (
          <SnagKpiPlanVsActualCard
            key={label}
            cells={q.cells as never}
            buckets={q.buckets}
            stage={STAGE}
            today={q.today}
            asOfDate={asOfDate}
            bucket={bucket}
            onBucketChange={setBucket}
            unit={unit}
            onUnitChange={setUnit}
            filterSummary={q.filterSummary}
            baselinePlan={q.baseline.plan}
            baselineActual={q.baseline.actual}
            planUpto={q.baseline.planUpto}
            actualUpto={q.baseline.actualUpto}
            stageTotal={q.stageTotal}
            open={open}
            onOpenChange={setOpen}
          />
        ))}
      </div>
    </ProjectModuleSection>
  );
}
