import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProgressKpiCard } from "./ProgressKpiCard";
import { RiskKpiCard, type RiskKpiBreakdownRow } from "./RiskKpiCard";
import { StatusMixDonut } from "./StatusMixDonut";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  pctNum,
  type KpiTeamBreakdownEntry,
  type TaskScope,
  type TmKpiMode,
} from "@/lib/task-management/kpi-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { EMPTY_TOKEN } from "@/lib/task-management/filters";
import { useTmItemsCounts, type TmCountsByTeamEntry } from "@/hooks/useTmItemsCounts";
import { AlertTriangle } from "lucide-react";

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

  // items 는 라우트 컨텍스트 유지용으로 받되, KPI 산정에는 사용하지 않는다.
  void items;

  // 서버 정본 카운트/가중진도 — KPI 카드 숫자와 드릴다운 리스트 건수 정합성 보장.
  // 클라이언트 폴백 없음: 로딩 중은 "—", 실패는 명시적 에러 표시.
  const {
    counts: serverCounts,
    byTeam: serverByTeam,
    weighted: serverWeighted,
    isLoading: serverLoading,
    isError: serverError,
  } = useTmItemsCounts({
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

  const ready = !!serverCounts && !!serverWeighted;
  const kpi = useMemo(() => {
    return {
      total: serverCounts?.total ?? 0,
      completed: serverCounts?.completed ?? 0,
      wip: serverCounts?.wip ?? 0,
      notStarted: serverCounts?.not_started ?? 0,
      plannedStartedByAsOf: serverCounts?.planned_started ?? 0,
      actuallyStarted: serverCounts?.actual_started ?? 0,
      inDelay: serverCounts?.in_delay ?? 0,
      startDelayed: serverCounts?.start_delayed ?? 0,
      completionOverdue: serverCounts?.completion_overdue ?? 0,
      criticalDelay: serverCounts?.critical ?? 0,
      behindSchedule: serverCounts?.behind ?? 0,
      weighted: {
        planned: serverWeighted?.planned ?? 0,
        actual: serverWeighted?.actual ?? 0,
      },
    };
  }, [serverCounts, serverWeighted]);

  const mapTeam = (list: TmCountsByTeamEntry[] | undefined) =>
    (list ?? []).map((e) => ({ team: e.team, isNull: e.isNull, count: e.count }));

  const breakdown = useMemo(() => {
    return {
      inDelay: mapTeam(serverByTeam?.in_delay),
      startDelayed: mapTeam(serverByTeam?.start_delayed),
      completionOverdue: mapTeam(serverByTeam?.completion_overdue),
      criticalDelay: mapTeam(serverByTeam?.critical_delay),
      behindSchedule: mapTeam(serverByTeam?.behind_schedule),
    };
  }, [serverByTeam]);

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

  // 로딩/에러 상태 표시 도우미 — 서버 정본이 도착하기 전엔 클라이언트로 대체하지 않는다.
  const fmtCount = (n: number): string => (ready ? n.toLocaleString() : "—");
  const fmtPct = (n: number): string => (ready ? `${n.toFixed(1)}%` : "—");
  const safePct = (part: number, total: number): number | undefined =>
    ready ? pctNum(part, total) : undefined;

  return (
    <div className="space-y-3">
      {serverError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4" />
          KPI 데이터를 불러오지 못했습니다. 새로고침 후에도 계속되면 관리자에게 문의하세요.
        </div>
      )}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <ProgressKpiCard
          label="Completed"
          percent={ready ? pctNum(kpi.completed, kpi.total) : NaN}
          sub={`${fmtCount(kpi.completed)} / ${fmtCount(kpi.total)} items`}
          barTone="emerald"
          onClick={() => goRaw("completed")}
        />
        <ProgressKpiCard
          label="Planned Progress"
          percent={ready ? kpi.weighted.planned : NaN}
          sub={`${fmtCount(kpi.plannedStartedByAsOf)} / ${fmtCount(kpi.total)} items`}
          barTone="neutral"
          onClick={() => goRaw("planned_started")}
        />
        <ProgressKpiCard
          label="Actual Progress"
          percent={ready ? kpi.weighted.actual : NaN}
          sub={`${fmtCount(kpi.actuallyStarted)} / ${fmtCount(kpi.total)} items`}
          barTone="emerald"
          onClick={() => goRaw("actual_started")}
        />
        <RiskKpiCard
          label="In Delay"
          count={kpi.inDelay}
          percent={safePct(kpi.inDelay, kpi.total)}
          sub={`${fmtCount(kpi.inDelay)} / ${fmtCount(kpi.total)} items`}
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
          percent={safePct(kpi.startDelayed, kpi.total)}
          tone="danger"
          onClick={() => goRaw("start_delayed")}
          breakdown={toBreakdownRows("start_delayed", breakdown.startDelayed)}
          formula="In Delay ∩ (plan_start ≤ asOf & actual_start 없음)"
        />
        <RiskKpiCard
          label="Completion Overdue"
          count={kpi.completionOverdue}
          percent={safePct(kpi.completionOverdue, kpi.total)}
          tone="danger"
          onClick={() => goRaw("completion_overdue")}
          breakdown={toBreakdownRows("completion_overdue", breakdown.completionOverdue)}
          formula="In Delay ∩ (plan_end < asOf)"
        />
        <RiskKpiCard
          label="Critical Delay"
          count={kpi.criticalDelay}
          percent={safePct(kpi.criticalDelay, kpi.total)}
          tone="danger"
          onClick={() => goRaw("critical")}
          breakdown={toBreakdownRows("critical", breakdown.criticalDelay)}
          formula={`In Delay ∩ (gap < ${t.worsen_gap}) → '악화'`}
        />
        <RiskKpiCard
          label="Behind Schedule"
          count={kpi.behindSchedule}
          percent={safePct(kpi.behindSchedule, kpi.total)}
          tone="danger"
          onClick={() => goRaw("behind")}
          breakdown={toBreakdownRows("behind", breakdown.behindSchedule)}
          formula="In Delay 와 동일 산식 (gap<0 · 미완료)"
        />
      </div>
    </div>
  );
}