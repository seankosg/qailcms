import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { TmPlanVsActualCard } from "@/components/task-management/dashboard/TmPlanVsActualCard";
import { useTmScurveData } from "@/hooks/useTmScurveData";
import { resolveActualPct, resolveIsDelayed } from "@/lib/task-management/delay-utils";
import type { SCurveBucket } from "@/lib/task-management/scurve-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";

const PLOT_C = new Set(["C"]);
const PLOT_D = new Set(["D"]);

/** TM — 정본: useTmScurveData(= TM KPI Analysis 와 동일 훅) */
export function TmDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [bucket, setBucket] = useState<SCurveBucket>("week");
  const [open, setOpen] = useState(true);
  const { scopedItems, thresholds, filterSummary, isLoading } = useTmScurveData({
    asOfDate,
    taskScope: "sub",
    workType: "all",
    delayFilter: "all",
  });

  const kpi = useMemo(() => {
    const total = scopedItems.length;
    let done = 0;
    let delayed = 0;
    let plotC = 0;
    let plotD = 0;
    let unclassified = 0;
    let actualSum = 0;
    for (const it of scopedItems) {
      const a = resolveActualPct(it);
      actualSum += a;
      if (a >= 1) done += 1;
      if (resolveIsDelayed(it, thresholds, asOfDate)) delayed += 1;
      const p = String((it as { plot?: string | null }).plot ?? "").trim().toUpperCase();
      if (PLOT_C.has(p)) plotC += 1;
      else if (PLOT_D.has(p)) plotD += 1;
      else unclassified += 1;
    }
    return {
      total,
      done,
      delayed,
      wip: Math.max(0, total - done),
      plotC,
      plotD,
      unclassified,
      progressPct: total > 0 ? (actualSum / total) * 100 : null,
    };
  }, [scopedItems, thresholds, asOfDate]);

  return (
    <ProjectModuleSection
      title="Task Management"
      to="/task-management/kpi"
      progressPct={isLoading ? null : kpi.progressPct}
      progressHint="진도율 = Sub 과업 실적%(서버 정본 srv_actual_pct, 없으면 누적 실적) 단순 평균 — TM KPI Analysis 와 동일"
      asOfNote={`Plot C ${kpi.plotC.toLocaleString()} · D ${kpi.plotD.toLocaleString()}`}
      unclassified={kpi.unclassified}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AbdKpiCard label="Total (Sub)" count={kpi.total} hint="TM Sub 과업 모집단" />
        <AbdKpiCard
          label="완료"
          count={kpi.done}
          total={kpi.total}
          tone="good"
          hint="실적% = 100% 인 과업 수"
        />
        <AbdKpiCard
          label="진행중"
          count={kpi.wip}
          total={kpi.total}
          hint="완료되지 않은 과업 수"
        />
        <AbdKpiCard
          label="지연 · 악화"
          count={kpi.delayed}
          total={kpi.total}
          tone="bad"
          hint="정본 판정(resolveJudgment) 이 지연 또는 악화 — 실적% < 선형 Plan%"
        />
      </div>
      <TmPlanVsActualCard
        items={scopedItems}
        asOfDate={asOfDate}
        dim="hdec_pic_name"
        filterSummary={filterSummary}
        bucket={bucket}
        onBucketChange={setBucket}
        open={open}
        onOpenChange={setOpen}
      />
    </ProjectModuleSection>
  );
}
