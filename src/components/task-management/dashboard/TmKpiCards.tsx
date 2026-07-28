import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProgressKpiCard } from "./ProgressKpiCard";
import { RiskKpiCard, type RiskKpiBreakdownRow } from "./RiskKpiCard";
import { StatusMixDonut } from "./StatusMixDonut";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  computeKpi,
  computeKpiBreakdownByTeam,
  type KpiTeamBreakdownEntry,
  pctNum,
  scopeItems,
  type TaskScope,
  type TmKpiMode,
} from "@/lib/task-management/kpi-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { EMPTY_TOKEN } from "@/lib/task-management/filters";
import { useTmItemsCounts, type TmCountsByTeamEntry } from "@/hooks/useTmItemsCounts";

interface Props {
  items: TaskItem[];
  asOfDate: string;
  taskScope: TaskScope;
  onScopeChange: (v: TaskScope) => void;
  disciplines: string[];
  onDisciplinesChange: (v: string[]) => void;
  ownerContext?: {
    team?: string[];
    hdec_pic_name?: string[];
    hdec_eng_name?: string[];
    discipline?: string[];
    plot?: string[];
    q?: string;
  };
  statusMixSideSlot?: ReactNode;
  statusMixLeftExtraSlot?: ReactNode;
}

const SCOPE_LABEL: Record<TaskScope, string> = {
  all: "All",
  main: "Main Task",
  sub: "Sub Task",
};

const DISCIPLINE_KEYS = ["ARCH", "MECH", "ELEC", "DESN", "PRJC", "SUPP"] as const;

export function TmKpiCards({
  items,
  asOfDate,
  taskScope,
  onScopeChange,
  disciplines,
  onDisciplinesChange,
  ownerContext,
  statusMixSideSlot,
  statusMixLeftExtraSlot,
}: Props) {
  const navigate = useNavigate();
  const { data: thresholds } = useTaskManagementSettings();
  const t = thresholds ?? DEFAULT_THRESHOLDS;

  const scoped = useMemo(() => scopeItems(items, taskScope), [items, taskScope]);
  const clientKpi = useMemo(() => computeKpi(scoped, asOfDate, t), [scoped, asOfDate, t]);
  const clientBreakdown = useMemo(
    () => computeKpiBreakdownByTeam(scoped, asOfDate, t),
    [scoped, asOfDate, t],
  );

  // 서버 정본 카운트 — KPI 카드 숫자와 드릴다운 리스트 건수 정합성 보장.
  const { counts: serverCounts, byTeam: serverByTeam } = useTmItemsCounts({
    filters: {
      team: ownerContext?.team,
      hdec_pic_name: ownerContext?.hdec_pic_name,
      hdec_eng_name: ownerContext?.hdec_eng_name,
      discipline: ownerContext?.discipline,
      plot: ownerContext?.plot,
      q: ownerContext?.q,
    },
    taskScope,
    asOfDate,
    thresholds: t,
  });

  // 카운트: 서버 값 우선, 미도착 시 클라이언트 값 폴백. 가중 진도(%)는 클라이언트에서 계속 계산.
  const kpi = useMemo(() => {
    if (!serverCounts) return clientKpi;
    return {
      ...clientKpi,
      total: serverCounts.total,
      completed: serverCounts.completed,
      wip: serverCounts.wip,
      notStarted: serverCounts.not_started,
      plannedStartedByAsOf: serverCounts.planned_started,
      actuallyStarted: serverCounts.actual_started,
      inDelay: serverCounts.in_delay,
      startDelayed: serverCounts.start_delayed,
      completionOverdue: serverCounts.completion_overdue,
      criticalDelay: serverCounts.critical,
      behindSchedule: serverCounts.behind,
    };
  }, [serverCounts, clientKpi]);

  const mapTeam = (list: TmCountsByTeamEntry[] | undefined) =>
    (list ?? []).map((e) => ({ team: e.team, isNull: e.isNull, count: e.count }));

  const breakdown = useMemo(() => {
    if (!serverByTeam) return clientBreakdown;
    return {
      inDelay: mapTeam(serverByTeam.in_delay),
      startDelayed: mapTeam(serverByTeam.start_delayed),
      completionOverdue: mapTeam(serverByTeam.completion_overdue),
      criticalDelay: mapTeam(serverByTeam.critical_delay),
      behindSchedule: mapTeam(serverByTeam.behind_schedule),
    };
  }, [serverByTeam, clientBreakdown]);

  const goRaw = (mode: TmKpiMode) => {
    const s: Record<string, string> = {
      source: "dashboard",
      mode,
      asOf: asOfDate,
      taskScope,
    };
    if (ownerContext?.team?.length) s.team = ownerContext.team.join(",");
    if (ownerContext?.hdec_pic_name?.length) s.hdec_pic_name = ownerContext.hdec_pic_name.join(",");
    if (ownerContext?.hdec_eng_name?.length) s.hdec_eng_name = ownerContext.hdec_eng_name.join(",");
    if (ownerContext?.discipline?.length) s.discipline = ownerContext.discipline.join(",");
    if (ownerContext?.plot?.length) s.plot = ownerContext.plot.join(",");
    if (ownerContext?.q && ownerContext.q.trim()) s.q = ownerContext.q.trim();
    navigate({ to: "/closure/task-management/raw-data", search: s as any });
  };

  const goRawWithTeam = (mode: TmKpiMode, entry: KpiTeamBreakdownEntry) => {
    const s: Record<string, string> = {
      source: "dashboard",
      mode,
      asOf: asOfDate,
      taskScope,
    };
    // 팀별 breakdown 클릭 시 팀 필터는 클릭한 단일 값으로 override
    s.team = entry.isNull ? EMPTY_TOKEN : entry.team;
    if (ownerContext?.hdec_pic_name?.length) s.hdec_pic_name = ownerContext.hdec_pic_name.join(",");
    if (ownerContext?.hdec_eng_name?.length) s.hdec_eng_name = ownerContext.hdec_eng_name.join(",");
    if (ownerContext?.discipline?.length) s.discipline = ownerContext.discipline.join(",");
    if (ownerContext?.plot?.length) s.plot = ownerContext.plot.join(",");
    if (ownerContext?.q && ownerContext.q.trim()) s.q = ownerContext.q.trim();
    navigate({ to: "/closure/task-management/raw-data", search: s as any });
  };

  const toBreakdownRows = (
    mode: TmKpiMode,
    list: KpiTeamBreakdownEntry[],
  ): RiskKpiBreakdownRow[] => {
    const MAX = 6;
    if (list.length <= MAX) {
      return list.map((e) => ({
        label: e.team,
        count: e.count,
        onClick: () => goRawWithTeam(mode, e),
      }));
    }
    const top = list.slice(0, MAX);
    const rest = list.slice(MAX);
    const restSum = rest.reduce((acc, r) => acc + r.count, 0);
    return [
      ...top.map((e) => ({
        label: e.team,
        count: e.count,
        onClick: () => goRawWithTeam(mode, e),
      })),
      {
        label: `기타 (${rest.length}팀)`,
        count: restSum,
        disabled: true,
      },
    ];
  };

  // Toolbar controls (Task Filter / Discipline / items count) moved to TmDashboardPage sticky toolbar.
  // Props `taskScope`, `onScopeChange`, `disciplines`, `onDisciplinesChange` kept for API stability.
  void onScopeChange;
  void onDisciplinesChange;
  void disciplines;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <ProgressKpiCard
          label="Completed"
          percent={pctNum(kpi.completed, kpi.total)}
          sub={`${kpi.completed.toLocaleString()} / ${kpi.total.toLocaleString()} items`}
          barTone="emerald"
          onClick={() => goRaw("completed")}
        />
        <ProgressKpiCard
          label="Planned Progress"
          percent={kpi.weighted.planned}
          sub={`${kpi.plannedStartedByAsOf.toLocaleString()} / ${kpi.total.toLocaleString()} items`}
          barTone="neutral"
          onClick={() => goRaw("planned_started")}
        />
        <ProgressKpiCard
          label="Actual Progress"
          percent={kpi.weighted.actual}
          sub={`${kpi.actuallyStarted.toLocaleString()} / ${kpi.total.toLocaleString()} items`}
          barTone="emerald"
          onClick={() => goRaw("actual_started")}
        />
        <RiskKpiCard
          label="In Delay"
          count={kpi.inDelay}
          percent={pctNum(kpi.inDelay, kpi.total)}
          sub={`${kpi.inDelay.toLocaleString()} / ${kpi.total.toLocaleString()} items`}
          tone="danger"
          showPercentFirst
          onClick={() => goRaw("in_delay")}
          breakdown={toBreakdownRows("in_delay", breakdown.inDelay)}
          formula={`지연 우산 KPI (gap 단일 소스)\n= 미완료 & (Actual% − CumPlan% < 0)\nasOf=${asOfDate} · scope=${SCOPE_LABEL[taskScope]}\nBehind Schedule 과 동일 산식`}
        />
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-4">
        <div className="min-w-0 h-full lg:col-span-1">
          <StatusMixDonut
            total={kpi.total}
            completed={kpi.completed}
            wip={kpi.wip}
            notStarted={kpi.notStarted}
            onSegmentClick={(seg) => goRaw(seg)}
          />
        </div>
        <div className="min-w-0 h-full lg:col-span-1">{statusMixLeftExtraSlot}</div>
        <div className="min-w-0 h-full lg:col-span-2">{statusMixSideSlot}</div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <RiskKpiCard
          label="Start Delayed"
          count={kpi.startDelayed}
          percent={pctNum(kpi.startDelayed, kpi.total)}
          tone="danger"
          onClick={() => goRaw("start_delayed")}
          breakdown={toBreakdownRows("start_delayed", breakdown.startDelayed)}
          formula="In Delay ∩ (plan_start ≤ asOf & actual_start 없음)"
        />
        <RiskKpiCard
          label="Completion Overdue"
          count={kpi.completionOverdue}
          percent={pctNum(kpi.completionOverdue, kpi.total)}
          tone="danger"
          onClick={() => goRaw("completion_overdue")}
          breakdown={toBreakdownRows("completion_overdue", breakdown.completionOverdue)}
          formula="In Delay ∩ (plan_end < asOf)"
        />
        <RiskKpiCard
          label="Critical Delay"
          count={kpi.criticalDelay}
          percent={pctNum(kpi.criticalDelay, kpi.total)}
          tone="danger"
          onClick={() => goRaw("critical")}
          breakdown={toBreakdownRows("critical", breakdown.criticalDelay)}
          formula={`In Delay ∩ (gap < ${t.worsen_gap}) → '악화'`}
        />
        <RiskKpiCard
          label="Behind Schedule"
          count={kpi.behindSchedule}
          percent={pctNum(kpi.behindSchedule, kpi.total)}
          tone="danger"
          onClick={() => goRaw("behind")}
          breakdown={toBreakdownRows("behind", breakdown.behindSchedule)}
          formula="In Delay 와 동일 산식 (gap<0 · 미완료)"
        />
      </div>
    </div>
  );
}