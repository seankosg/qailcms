import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProgressKpiCard } from "./ProgressKpiCard";
import { RiskKpiCard } from "./RiskKpiCard";
import { StatusMixBar } from "./StatusMixBar";
import { CriticalThresholdPopover } from "@/components/task-management/shared/CriticalThresholdPopover";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  computeKpi,
  pctNum,
  scopeItems,
  type TaskScope,
  type TmKpiMode,
} from "@/lib/task-management/kpi-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";

interface Props {
  items: TaskItem[];
  asOfDate: string;
  taskScope: TaskScope;
  onScopeChange: (v: TaskScope) => void;
  ownerContext?: {
    team?: string[];
    hdec_pic_name?: string[];
    hdec_eng_name?: string[];
    discipline?: string[];
  };
}

const SCOPE_LABEL: Record<TaskScope, string> = {
  all: "All",
  main: "Main Task",
  sub: "Sub Task",
};

export function TmKpiCards({ items, asOfDate, taskScope, onScopeChange, ownerContext }: Props) {
  const navigate = useNavigate();
  const { data: thresholds } = useTaskManagementSettings();
  const t = thresholds ?? DEFAULT_THRESHOLDS;

  const scoped = useMemo(() => scopeItems(items, taskScope), [items, taskScope]);
  const kpi = useMemo(() => computeKpi(scoped, asOfDate, t), [scoped, asOfDate, t]);

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
    navigate({ to: "/closure/task-management/raw-data", search: s as any });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Task Scope
        </span>
        <ToggleGroup
          type="single"
          value={taskScope}
          onValueChange={(v) => {
            if (v === "all" || v === "main" || v === "sub") onScopeChange(v);
          }}
          className="gap-1"
        >
          {(["all", "main", "sub"] as const).map((k) => (
            <ToggleGroupItem
              key={k}
              value={k}
              className="h-8 px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {SCOPE_LABEL[k]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {kpi.total.toLocaleString()} items
        </span>
      </div>

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
        />
      </div>

      <StatusMixBar
        total={kpi.total}
        completed={kpi.completed}
        wip={kpi.wip}
        notStarted={kpi.notStarted}
        onSegmentClick={(seg) => goRaw(seg)}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <RiskKpiCard
          label="Start Delayed"
          count={kpi.startDelayed}
          percent={pctNum(kpi.startDelayed, kpi.total)}
          tone="warn"
          onClick={() => goRaw("start_delayed")}
        />
        <RiskKpiCard
          label="Completion Overdue"
          count={kpi.completionOverdue}
          percent={pctNum(kpi.completionOverdue, kpi.total)}
          tone="danger"
          onClick={() => goRaw("completion_overdue")}
        />
        <RiskKpiCard
          label="Critical Delay"
          count={kpi.criticalDelay}
          percent={pctNum(kpi.criticalDelay, kpi.total)}
          tone="danger"
          onClick={() => goRaw("critical")}
          action={<CriticalThresholdPopover compact triggerVariant="ghost" triggerLabel="설정" />}
        />
        <RiskKpiCard
          label="Behind Schedule"
          count={kpi.behindSchedule}
          percent={pctNum(kpi.behindSchedule, kpi.total)}
          tone="warn"
          onClick={() => goRaw("behind")}
        />
      </div>
    </div>
  );
}