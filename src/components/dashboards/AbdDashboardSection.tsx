import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { AbdPlanVsActualCard } from "@/components/abd/progress/AbdPlanVsActualCard";
import { useAbdScurveData } from "@/hooks/useAbdScurveData";
import { ALL_STAGES } from "@/lib/abd/progress-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";

/** ABD — 정본: useAbdScurveData(= ABD Progress 와 동일 훅) */
export function AbdDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const q = useAbdScurveData({
    plot: "all",
    teams: [],
    groupBy: ["team"],
    bucket: "week",
    planMode: "baseline",
    asOfDate,
    rangeDays: 60,
    scurveEnabled: true,
  });

  const kpi = useMemo(() => {
    const rows = (q.totals ?? []) as Array<Record<string, unknown>>;
    const pick = (stage: string) => {
      const out = { total: 0, actual: 0, plan: 0 };
      for (const r of rows) {
        if (r.stage !== stage) continue;
        out.total += Number(r.total ?? 0);
        out.actual += Number(r.actual_upto ?? 0);
        out.plan += Number(r.plan_upto ?? 0);
      }
      return out;
    };
    const ap = pick("approval");
    const sb = pick("submission");
    return {
      ...ap,
      submission: sb.actual,
      behind: Math.max(0, ap.plan - ap.actual),
      progressPct: ap.total > 0 ? (ap.actual / ap.total) * 100 : null,
    };
  }, [q.totals]);

  return (
    <ProjectModuleSection
      title="As Built Drawing"
      to="/closure/abd/progress"
      progressPct={q.loading ? null : kpi.progressPct}
      progressHint="진도율 = Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일(서버 totals 정본)"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AbdKpiCard label="Total (문서)" count={kpi.total} hint="ABD 문서 모수" />
        <AbdKpiCard label="Approval 누계" count={kpi.actual} total={kpi.total} tone="ok" hint="as-of 기준 Approval actual_upto" />
        <AbdKpiCard label="Submission 누계" count={kpi.submission} total={kpi.total} tone="info" hint="as-of 기준 Submission actual_upto" />
        <AbdKpiCard
          label="Approval 계획 대비 미달"
          count={kpi.behind}
          total={kpi.total}
          tone="danger"
          hint="max(0, Approval 계획 누계 − 실적 누계)"
        />
      </div>
      <AbdPlanVsActualCard
        cells={q.cells as never}
        buckets={q.buckets}
        stages={ALL_STAGES}
        today={q.today}
        open={open}
        onOpenChange={setOpen}
        baselines={q.baselines}
        cum={q.cum}
      />
    </ProjectModuleSection>
  );
}
