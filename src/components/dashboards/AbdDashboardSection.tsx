import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { AbdPlanVsActualCard } from "@/components/abd/progress/AbdPlanVsActualCard";
import { useAbdScurveData } from "@/hooks/useAbdScurveData";
import { ALL_STAGES } from "@/lib/abd/progress-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";

function useAbdPlot(plot: "all" | "C" | "D", asOfDate: string) {
  const q = useAbdScurveData({
    plot,
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
    const out = { total: 0, actual: 0, plan: 0 };
    for (const r of rows) {
      if (r.stage !== "approval") continue;
      out.total += Number(r.total ?? 0);
      out.actual += Number(r.actual_upto ?? 0);
      out.plan += Number(r.plan_upto ?? 0);
    }
    return {
      ...out,
      behind: Math.max(0, out.plan - out.actual),
      progressPct: out.total > 0 ? (out.actual / out.total) * 100 : null,
    };
  }, [q.totals]);
  return { ...q, kpi };
}

/** ABD — 정본: useAbdScurveData(= ABD Progress 와 동일 훅), Plot 별 호출 */
export function AbdDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const all = useAbdPlot("all", asOfDate);
  const c = useAbdPlot("C", asOfDate);
  const d = useAbdPlot("D", asOfDate);

  const unclassified = Math.max(0, all.kpi.total - c.kpi.total - d.kpi.total);

  return (
    <ProjectModuleSection
      title="As Built Drawing"
      to="/closure/abd/progress"
      progressPct={all.loading ? null : all.kpi.progressPct}
      progressHint="진도율 = Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일(서버 totals 정본)"
      asOfNote={`Plot D ${d.kpi.total.toLocaleString()} · C ${c.kpi.total.toLocaleString()}`}
      unclassified={unclassified}
    >
      <div className="grid gap-3 xl:grid-cols-2">
        {([["D", d], ["C", c]] as const).map(([label, q]) => (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                label={`Plot ${label} 진도현황`}
                count={q.kpi.actual}
                total={q.kpi.total}
                tone="ok"
                hint="진도현황 = as-of 기준 Approval actual_upto ÷ 문서 모수"
              />
              <AbdKpiCard
                label={`Plot ${label} 지연현황`}
                count={q.kpi.behind}
                total={q.kpi.total}
                tone="danger"
                hint="지연현황 = max(0, Approval 계획 누계 − 실적 누계)"
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
          </div>
        ))}
      </div>
    </ProjectModuleSection>
  );
}
