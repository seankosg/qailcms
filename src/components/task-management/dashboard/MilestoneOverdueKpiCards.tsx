import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { RiskKpiCard, type RiskKpiBreakdownRow } from "./RiskKpiCard";
import { EMPTY_TOKEN } from "@/lib/task-management/filters";
import type { TaskScope } from "@/lib/task-management/kpi-utils";
import {
  useTmMilestoneOverdueCounts,
  type OverdueBadge,
} from "@/hooks/useTmMilestoneOverdueCounts";
import type { TmCountsByTeamEntry } from "@/hooks/useTmItemsCounts";

interface Props {
  asOfDate: string;
  taskScope: TaskScope;
  ownerContext?: {
    team?: string[];
    hdec_pic_name?: string[];
    hdec_eng_name?: string[];
    discipline?: string[];
    plot?: string[];
    q?: string;
  };
}

const BADGES: OverdueBadge[] = ["WARNING", "RISK", "SAFE", "PASS"];
const TONE: Record<OverdueBadge, "danger" | "warn" | "info" | "neutral"> = {
  WARNING: "danger",
  RISK: "warn",
  SAFE: "info",
  PASS: "neutral",
};
const FORMULA: Record<OverdueBadge, string> = {
  WARNING: "마일스톤 초과",
  RISK: "버퍼 침범 (마일스톤 임박)",
  SAFE: "버퍼 이상 여유",
  PASS: "완료 (기한 내)",
};

export function MilestoneOverdueKpiCards({ asOfDate, taskScope: _taskScope, ownerContext }: Props) {
  const navigate = useNavigate();
  /** 이 카드의 집계 단위는 Subtask 고정 — 상단 과업 스코프와 무관 */
  const taskScope: TaskScope = "sub";
  const { data, isLoading, isError } = useTmMilestoneOverdueCounts({
    filters: {
      team: ownerContext?.team,
      hdec_pic_name: ownerContext?.hdec_pic_name,
      hdec_eng_name: ownerContext?.hdec_eng_name,
      discipline: ownerContext?.discipline,
      plot: ownerContext?.plot,
      q: ownerContext?.q,
    },
    taskScope,
  });

  const total = data?.total ?? 0;

  const goRaw = (axis: "plan" | "actual", badge: OverdueBadge, team?: TmCountsByTeamEntry) => {
    const s: Record<string, string> = {
      source: "dashboard",
      asOf: asOfDate,
      taskScope,
    };
    if (axis === "plan") s.planOverdue = badge;
    else s.actualOverdue = badge;
    if (team) s.team = team.isNull ? EMPTY_TOKEN : team.team;
    else if (ownerContext?.team?.length) s.team = ownerContext.team.join(",");
    if (ownerContext?.hdec_pic_name?.length) s.hdec_pic_name = ownerContext.hdec_pic_name.join(",");
    if (ownerContext?.hdec_eng_name?.length) s.hdec_eng_name = ownerContext.hdec_eng_name.join(",");
    if (ownerContext?.discipline?.length) s.discipline = ownerContext.discipline.join(",");
    if (ownerContext?.plot?.length) s.plot = ownerContext.plot.join(",");
    if (ownerContext?.q && ownerContext.q.trim()) s.q = ownerContext.q.trim();
    navigate({ to: "/closure/task-management/raw-data", search: s as any });
  };

  const rows = (
    axis: "plan" | "actual",
    badge: OverdueBadge,
  ): RiskKpiBreakdownRow[] => {
    const map = axis === "plan" ? data?.plan_by_team : data?.actual_by_team;
    const list = map?.[badge] ?? [];
    const MAX = 6;
    const top = list.slice(0, MAX);
    const rest = list.slice(MAX);
    const out: RiskKpiBreakdownRow[] = top.map((e) => ({
      label: e.team,
      count: e.count,
      onClick: () => goRaw(axis, badge, e),
    }));
    if (rest.length) {
      out.push({
        label: `기타 (${rest.length}팀)`,
        count: rest.reduce((a, b) => a + b.count, 0),
        disabled: true,
      });
    }
    return out;
  };

  const renderRow = (axis: "plan" | "actual") => (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
      {BADGES.map((b) => {
        const count = (axis === "plan" ? data?.plan : data?.actual)?.[b] ?? 0;
        return (
          <RiskKpiCard
            key={`${axis}-${b}`}
            label={`${axis === "plan" ? "Plan" : "Actual"} Overdue · ${b}`}
            count={isLoading ? 0 : count}
            percent={isLoading || !total ? undefined : (count / total) * 100}
            sub={isLoading ? "—" : `${count.toLocaleString()} / ${total.toLocaleString()} items`}
            tone={TONE[b]}
            onClick={() => goRaw(axis, b)}
            breakdown={rows(axis, b)}
            formula={`${FORMULA[b]}\nRaw Data 의 ${axis === "plan" ? "Plan" : "Actual"} Overdue 뱃지 기준`}
          />
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Milestone Base TM Status</h3>
        <span className="text-[11px] text-muted-foreground">
          Raw Data 의 Plan / Actual Overdue 뱃지 기준 · Subtask 기준 · {total.toLocaleString()} items
        </span>
      </div>
      {isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4" />
          마일스톤 기준 집계를 불러오지 못했습니다.
        </div>
      )}
      {renderRow("plan")}
      {renderRow("actual")}
    </div>
  );
}
