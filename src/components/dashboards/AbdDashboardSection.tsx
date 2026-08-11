import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { AbdPlanVsActualCard } from "@/components/abd/progress/AbdPlanVsActualCard";
import { useAbdScurveData } from "@/hooks/useAbdScurveData";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, pdbFilterChips, type PdbAbdFilters } from "@/lib/dashboards/pdb-filters";
import { ALL_STAGES } from "@/lib/abd/progress-utils";
import type { AbdTeam } from "@/lib/abd/columns";
import { ProjectModuleSection } from "./ProjectModuleSection";

function useAbdPlot(plot: "C" | "D", asOfDate: string, f: PdbAbdFilters) {
  const q = useAbdScurveData({
    plot,
    teams: f.teams as AbdTeam[],
    groupBy: ["team"],
    bucket: f.bucket,
    planMode: f.planMode,
    asOfDate,
    rangeDays: 60,
    scurveEnabled: true,
    startDate: f.startDate,
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
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.abd ?? PDB_DEFAULTS.abd;
  const c = useAbdPlot("C", asOfDate, f);
  const d = useAbdPlot("D", asOfDate, f);

  return (
    <ProjectModuleSection
      title="As Built Drawing"
      to="/closure/abd/progress"
      progressHint="진도율 = 해당 Plot Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일(서버 totals 정본)"
      filterChips={pdbFilterChips("abd", f)}
      plots={[
        { plot: "D", progressPct: d.loading ? null : d.kpi.progressPct, total: d.kpi.total },
        { plot: "C", progressPct: c.loading ? null : c.kpi.progressPct, total: c.kpi.total },
      ]}
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
                showTotal
                hint="진도현황 = as-of 기준 Approval actual_upto ÷ 문서 모수"
              />
              <AbdKpiCard
                label={`Plot ${label} 지연현황`}
                count={q.kpi.behind}
                total={q.kpi.total}
                tone="danger"
                showTotal
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
