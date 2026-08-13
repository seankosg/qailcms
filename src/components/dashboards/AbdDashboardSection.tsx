import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import { AbdPlanVsActualCard } from "@/components/abd/progress/AbdPlanVsActualCard";
import { useAbdScurveData } from "@/hooks/useAbdScurveData";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbAbdFilters } from "@/lib/dashboards/pdb-filters";
import { useUnionWindow } from "@/lib/charts/use-union-window";
import { ALL_STAGES, type Stage } from "@/lib/abd/progress-utils";
import type { AbdTeam } from "@/lib/abd/columns";
import { ProjectModuleSection } from "./ProjectModuleSection";
import { PdbBreakdownCard, foldTop4 } from "./PdbBreakdownCard";

function useAbdPlot(plot: "C" | "D", asOfDate: string, f: PdbAbdFilters) {
  const stages = useMemo<Stage[]>(() => {
    const sel = ALL_STAGES.filter((s) => f.stages.includes(s));
    return sel.length > 0 ? sel : ALL_STAGES;
  }, [f.stages]);
  const q = useAbdScurveData({
    plot,
    teams: f.teams as AbdTeam[],
    groupBy: ["team"],
    stages,
    bucket: (f.bucket === "month" ? "week" : f.bucket) as "day" | "week",
    planMode: f.planMode,
    asOfDate,
    rangeDays: 60,
    scurveEnabled: true,
    startDate: f.startDate,
  });
  const kpi = useMemo(() => {
    const rows = (q.totals ?? []) as Array<Record<string, unknown>>;
    const out = { total: 0, actual: 0, plan: 0 };
    const kpiStage = f.kpiStage || "approval";
    const byTeam = new Map<string, { count: number; actual: number }>();
    for (const r of rows) {
      if (r.stage !== kpiStage) continue;
      out.total += Number(r.total ?? 0);
      out.actual += Number(r.actual_upto ?? 0);
      out.plan += Number(r.plan_upto ?? 0);
      const gk = (r.group_key ?? []) as string[];
      const key = (gk[0] ?? "").trim() || "(미지정)";
      const cur = byTeam.get(key) ?? { count: 0, actual: 0 };
      cur.count += Number(r.total ?? 0);
      cur.actual += Number(r.actual_upto ?? 0);
      byTeam.set(key, cur);
    }
    return {
      ...out,
      behind: Math.max(0, out.plan - out.actual),
      teams: foldTop4(
        [...byTeam.entries()].map(([key, v]) => ({ key, count: v.count, actual: v.actual })),
      ),
      progressPct: out.total > 0 ? (out.actual / out.total) * 100 : null,
    };
  }, [q.totals, f.kpiStage]);
  return { ...q, kpi, stages };
}

/** ABD — 정본: useAbdScurveData(= ABD Progress 와 동일 훅), Plot 별 호출 */
export function AbdDashboardSection({ asOfDate }: { asOfDate: string }) {
  const [open, setOpen] = useState(true);
  const { data: settings } = usePdbModuleFilters();
  const f = settings?.abd ?? PDB_DEFAULTS.abd;
  const c = useAbdPlot("C", asOfDate, f);
  const d = useAbdPlot("D", asOfDate, f);
  const { window: win, report } = useUnionWindow();

  return (
    <ProjectModuleSection
      title="As Built Drawing"
      to="/closure/abd/progress"
      tone="abd"
      progressHint="진도율 = 해당 Plot Approval 실적 누계 ÷ 문서 모수 — ABD Progress 매트릭스와 동일(서버 totals 정본)"
      plots={[
        { plot: "D", progressPct: d.loading ? null : d.kpi.progressPct, total: d.kpi.total },
        { plot: "C", progressPct: c.loading ? null : c.kpi.progressPct, total: c.kpi.total },
      ]}
    >
      <div className="grid gap-3 xl:grid-cols-2">
        {([["D", d], ["C", c]] as const).map(([label, q]) => {
          const actualPct = q.kpi.total > 0 ? (q.kpi.actual / q.kpi.total) * 100 : null;
          const planPct = q.kpi.total > 0 ? (q.kpi.plan / q.kpi.total) * 100 : null;
          const diffPct = actualPct != null && planPct != null ? actualPct - planPct : null;
          return (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                label={`${label} 진도현황`}
                count={q.kpi.actual}
                total={q.kpi.total}
                tone={diffPct != null && diffPct < 0 ? "danger" : "ok"}
                showTotal
                hint="진도현황 = as-of 기준 Approval actual_upto ÷ 문서 모수"
                actualPct={actualPct ?? undefined}
                planPct={planPct ?? undefined}
                variant="tm-progress"
                leftSub={`A ${q.kpi.actual.toLocaleString()} / P ${q.kpi.plan.toLocaleString()}`}
                rightValue={`${diffPct != null ? `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}` : "—"}%`}
                rightSub={`A ${actualPct?.toFixed(1) ?? "—"}% / P ${planPct?.toFixed(1) ?? "—"}%`}
              />
              <PdbBreakdownCard
                label={`${label} Team 진도`}
                rows={q.kpi.teams}
                hint="Team 별 문서 수 상위 4개 + Others · 진도율 = 실적 누계 ÷ 문서 모수"
              />
            </div>
            <AbdPlanVsActualCard
              cells={q.cells as never}
              buckets={q.buckets}
              stages={q.stages as Stage[]}
              today={q.today}
              open={open}
              onOpenChange={setOpen}
              baselines={q.baselines}
              cum={q.cum}
              denomByStage={q.denomByStage}
              windowStart={win.start}
              windowEnd={win.end}
              onWindowResolved={(s, e) => report(label, s, e)}
              chartHeight={324}
              filterSummary={q.filterSummary}
            />
          </div>
          );
        })}
      </div>
    </ProjectModuleSection>
  );
}
