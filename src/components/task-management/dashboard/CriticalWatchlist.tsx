import { memo } from "react";
import { AlertTriangle, Clock, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  TASK_STAGE_LABELS,
  type TaskCriticalItem,
  type TaskLaggingGroup,
} from "@/lib/task-management/schedule-utils";

interface Props {
  highRisk: TaskCriticalItem[];
  bottleneck: TaskCriticalItem[];
  lagging: TaskLaggingGroup[];
  onItemClick?: (item: TaskCriticalItem) => void;
  onGroupClick?: (label: string) => void;
}

export const CriticalWatchlist = memo(function CriticalWatchlist({
  highRisk,
  bottleneck,
  lagging,
  onItemClick,
  onGroupClick,
}: Props) {
  return (
    <div className="flex w-[320px] shrink-0 flex-col gap-3">
      <Section
        title="High Risk (≤7d)"
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        empty="위험 항목이 없습니다."
        count={highRisk.length}
        accent="destructive"
      >
        {highRisk.slice(0, 12).map((it) => (
          <RiskRow key={`${it.id}-${it.stage}`} item={it} onClick={onItemClick} />
        ))}
      </Section>

      <Section
        title="Completion Bottleneck"
        icon={<Clock className="h-4 w-4 text-warning" />}
        empty="완료 지연 항목이 없습니다."
        count={bottleneck.length}
        accent="warning"
      >
        {bottleneck.slice(0, 8).map((it) => (
          <RiskRow key={`bn-${it.id}`} item={it} onClick={onItemClick} hint="완료 예정 초과" />
        ))}
      </Section>

      <Section
        title="Lagging Groups"
        icon={<TrendingDown className="h-4 w-4 text-warning" />}
        empty="모든 그룹 정상."
        count={lagging.length}
      >
        {lagging.map((g) => {
          const pct = Math.round(g.ratio * 100);
          return (
            <button
              key={g.key}
              type="button"
              onClick={onGroupClick ? () => onGroupClick(g.label) : undefined}
              className="flex w-full flex-col gap-1 rounded-md border border-border/60 bg-card px-2.5 py-2 text-left text-xs hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium" title={g.label}>{g.label}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-semibold",
                    pct < 70 ? "text-destructive" : pct < 90 ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {pct}%
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>
                  {g.cumActual} / {g.cumPlan}
                </span>
                <span>{g.total} 항목</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded bg-muted">
                <div
                  className={cn(
                    "h-full",
                    pct < 70 ? "bg-destructive" : pct < 90 ? "bg-warning" : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </button>
          );
        })}
      </Section>
    </div>
  );
});

function Section({
  title,
  icon,
  children,
  empty,
  count,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  empty: string;
  count: number;
  accent?: "destructive" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="px-3 py-2">
        <CardTitle className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5">
            {icon}
            {title}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              accent === "destructive"
                ? "bg-destructive/15 text-destructive"
                : accent === "warning"
                  ? "bg-warning/15 text-warning"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-3 pb-3 pt-0">
        {count === 0 ? (
          <div className="py-2 text-center text-[11px] text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function RiskRow({
  item,
  onClick,
  hint,
}: {
  item: TaskCriticalItem;
  onClick?: (i: TaskCriticalItem) => void;
  hint?: string;
}) {
  const danger = item.daysLeft < 0 ? "overdue" : item.daysLeft <= 3 ? "high" : "med";
  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(item) : undefined}
      className="flex w-full flex-col gap-0.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-left text-[11px] hover:bg-accent/40"
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex h-4 min-w-7 items-center justify-center rounded px-1 text-[9px] font-bold",
            item.stage === "start" && "bg-secondary text-secondary-foreground",
            item.stage === "finish" && "bg-primary/20 text-primary",
          )}
        >
          {TASK_STAGE_LABELS[item.stage]}
        </span>
        <span className="truncate font-medium" title={`${item.taskNo} · ${item.taskName}`}>
          {item.taskNo || item.taskName || "(no id)"}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          <span
            className={cn(
              "font-semibold",
              danger === "overdue"
                ? "text-destructive"
                : danger === "high"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {item.daysLeft < 0 ? `${-item.daysLeft}d late` : `${item.daysLeft}d`}
          </span>
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">
          {item.discipline || "—"} · {item.group}
        </span>
        {hint && <span className="ml-2 shrink-0 text-warning">{hint}</span>}
      </div>
    </button>
  );
}