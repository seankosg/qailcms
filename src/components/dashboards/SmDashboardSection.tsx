import { useMemo, useState } from "react";
import { AbdKpiCard } from "@/components/abd/dashboard/AbdKpiRows";
import {
  SnagKpiPlanVsActualCard,
  type SnagCurveUnit,
} from "@/components/defect-management/kpi/SnagKpiPlanVsActualCard";
import { useSnagScurveData } from "@/hooks/useSnagScurveData";
import { useSnagDashboardMatrix } from "@/hooks/useSnagDashboardMatrix";
import { usePdbModuleFilters } from "@/hooks/usePdbModuleFilters";
import { PDB_DEFAULTS, type PdbSmFilters } from "@/lib/dashboards/pdb-filters";
import { useUnionWindow } from "@/lib/charts/use-union-window";
import {
  ALL_TEAMS,
  buildMatrix,
  isLgRoomGroup,
  LG_ROOM_GROUPS,
  mergeStats,
  newStats,
  normalizeRoomGroup,
  type PlotKey,
  type RoomGroupCol,
  type Stats,
  type TeamKey,
} from "@/lib/defect-management/dashboard-shape";
import { type Bucket, type Stage } from "@/lib/defect-management/progress-utils";
import { ProjectModuleSection } from "./ProjectModuleSection";
import { PdbBreakdownCard, foldTop4, type BreakdownRow } from "./PdbBreakdownCard";

const ROOM_HINT =
  "지역별현황 = Room Group 별 Issued 건수와 Closure 진도율(Closed ÷ Issued) · SM Dashboard Room Group 카드와 동일한 정본 집계 · LG Podium 은 통합";

/** Room Group 별 Issued / Closure% — SM Dashboard 의 roomGroupTotals 정본을 그대로 쓴다. */
function useRoomGroupRows(plot: PlotKey, asOfDate: string, f: PdbSmFilters): BreakdownRow[] {
  const teams = f.teams as TeamKey[];
  const { data: rawRows = [] } = useSnagDashboardMatrix(plot, teams, asOfDate || null);
  const selected = (f.roomGroups ?? []) as string[];
  const selectedKey = [...selected].sort().join(",");
  return useMemo(() => {
    const sel = new Set(selectedKey ? selectedKey.split(",") : []);
    const rows =
      sel.size === 0 ? rawRows : rawRows.filter((r) => sel.has(normalizeRoomGroup(r.room_group)));
    const totals = buildMatrix(plot, teams.length ? teams : [...ALL_TEAMS], rows).roomGroupTotals as Record<
      string,
      Stats
    >;
    const get = (rg: string) => totals[rg] ?? newStats();
    const out: BreakdownRow[] = Object.keys(totals)
      .filter((c) => !isLgRoomGroup(c) && get(c).issued > 0)
      .map((c) => ({
        key: c,
        count: get(c).issued,
        pct: get(c).issued > 0 ? (get(c).closed / get(c).issued) * 100 : null,
      }));
    const lgPresent = LG_ROOM_GROUPS.filter((rg) => get(rg).issued > 0);
    if (lgPresent.length > 0) {
      const lg = newStats();
      for (const rg of lgPresent) mergeStats(lg, get(rg));
      out.push({
        key: "LG Podium",
        count: lg.issued,
        pct: lg.issued > 0 ? (lg.closed / lg.issued) * 100 : null,
      });
    }
    return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, plot, selectedKey, teams.join(",")]);
}

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
  const roomsC = useRoomGroupRows("C", asOfDate, f);
  const roomsD = useRoomGroupRows("D", asOfDate, f);
  const { window: win, report } = useUnionWindow();

  return (
    <ProjectModuleSection
      title="Snag Management"
      to="/closure/snag-management/dashboard"
      tone="sm"
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
        {([["D", d, roomsD], ["C", c, roomsC]] as const).map(([label, q, rooms]) => {
          const actualCnt = q.baseline.actualUpto;
          const planCnt = q.baseline.planUpto;
          const actualPct = q.stageTotal > 0 ? (actualCnt / q.stageTotal) * 100 : null;
          const planPct = q.stageTotal > 0 ? (planCnt / q.stageTotal) * 100 : null;
          const diffPct = actualPct != null && planPct != null ? actualPct - planPct : null;
          return (
          <div key={label} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AbdKpiCard
                label="진도현황"
                count={actualCnt}
                total={q.stageTotal}
                tone={diffPct != null && diffPct < 0 ? "danger" : "ok"}
                showTotal
                hint="진도현황 = as-of 기준 Closure actual_upto ÷ Closure 모수 — SM KPI Analysis 와 동일"
                actualPct={actualPct ?? undefined}
                planPct={planPct ?? undefined}
                variant="tm-progress"
                leftSub={`A ${actualCnt.toLocaleString()} / P ${planCnt.toLocaleString()}`}
                rightValue={
                  diffPct != null ? `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}%` : "—"
                }
                rightSub={`A ${actualPct?.toFixed(1) ?? "—"}% / P ${planPct?.toFixed(1) ?? "—"}%`}
              />
              <PdbBreakdownCard label="지역별현황" rows={rooms} hint={ROOM_HINT} scrollAfter={5} />
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
              windowStart={win.start}
              windowEnd={win.end}
              onWindowResolved={(s, e) => report(label, s, e)}
              filterSummary={q.filterSummary}
              baselinePlan={q.baseline.plan}
              baselineActual={q.baseline.actual}
              planUpto={q.baseline.planUpto}
              actualUpto={q.baseline.actualUpto}
              stageTotal={q.stageTotal}
              open={open}
              onOpenChange={setOpen}
              chartHeight={306}
            />
          </div>
          );
        })}
      </div>
    </ProjectModuleSection>
  );
}
