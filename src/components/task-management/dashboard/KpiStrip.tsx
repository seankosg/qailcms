import { AlertTriangle, Calendar as CalendarIcon, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface KpiValues {
  cumPlan: number;
  cumActual: number;
  variance: number;
  progressPct: number;
  doneStages: number;
  totalStages: number;
  overdue: number;
  criticalCount: number;
  upcoming7Plan: number;
}

interface Props {
  values: KpiValues;
  asOfLabel: string;
  onOverdueClick?: () => void;
  onCriticalClick?: () => void;
  onUpcomingClick?: () => void;
}

export function KpiStrip({ values, asOfLabel, onOverdueClick, onCriticalClick, onUpcomingClick }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Kpi
        label="Cumulative Progress"
        value={`${values.progressPct.toFixed(0)}%`}
        subValue={
          values.totalStages > 0
            ? `${values.doneStages}/${values.totalStages} 완료 · ${asOfLabel}${
                values.cumPlan > 0
                  ? ` · Var ${values.variance >= 0 ? "+" : ""}${values.variance.toFixed(1)}%`
                  : ""
              }`
            : "0/0"
        }
        accent={
          values.totalStages > 0 && values.progressPct < 30
            ? "short"
            : values.totalStages > 0 && values.progressPct >= 90
              ? "over"
              : undefined
        }
        progressPct={values.totalStages > 0 ? values.progressPct : undefined}
        icon={<TrendingUp className="h-3.5 w-3.5" />}
      />
      <Kpi
        label={`Delay Up to ${asOfLabel}`}
        value={values.overdue}
        accent={values.overdue > 0 ? "short" : undefined}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        onClick={values.overdue > 0 ? onOverdueClick : undefined}
      />
      <Kpi
        label="Critical (≤7d)"
        value={values.criticalCount}
        accent={values.criticalCount > 0 ? "short" : undefined}
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        onClick={values.criticalCount > 0 ? onCriticalClick : undefined}
      />
      <Kpi
        label="Upcoming 7d Plan"
        value={values.upcoming7Plan}
        icon={<CalendarIcon className="h-3.5 w-3.5" />}
        onClick={values.upcoming7Plan > 0 ? onUpcomingClick : undefined}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  subValue,
  accent,
  icon,
  onClick,
  progressPct,
}: {
  label: string;
  value: number | string;
  subValue?: string;
  accent?: "short" | "over";
  icon?: React.ReactNode;
  onClick?: () => void;
  progressPct?: number;
}) {
  return (
    <Card onClick={onClick} className={cn(onClick && "cursor-pointer transition-colors hover:bg-accent/40")}>
      <CardContent className="flex flex-col gap-0.5 p-2.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </div>
        <div
          className={cn(
            "text-lg font-semibold tabular-nums leading-tight",
            accent === "short" && "text-schedule-short",
            accent === "over" && "text-schedule-over",
          )}
        >
          {value}
        </div>
        {progressPct !== undefined && (
          <Progress
            value={Math.min(100, progressPct)}
            className={cn(
              "mt-1 h-1.5",
              accent === "short" && "[&>div]:bg-schedule-short",
              accent === "over" && "[&>div]:bg-schedule-over",
            )}
          />
        )}
        {subValue && <div className="text-[10px] text-muted-foreground tabular-nums">{subValue}</div>}
      </CardContent>
    </Card>
  );
}

export function ScheduleLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <LegendDot color="bg-schedule-plan" label="Plan" />
      <LegendDot color="bg-schedule-actual" label="Actual" />
      <LegendDot color="bg-schedule-over" label="Over" />
      <LegendDot color="bg-schedule-short" label="Short" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block h-2 w-3 rounded-sm", color)} />
      {label}
    </span>
  );
}