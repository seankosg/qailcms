import { cn } from "@/lib/utils";

export type KpiTone = "muted" | "info" | "warning" | "destructive" | "success";

const BAR: Record<KpiTone, string> = {
  muted: "bg-muted-foreground/40",
  info: "bg-info",
  warning: "bg-warning",
  destructive: "bg-destructive",
  success: "bg-success",
};
const TEXT: Record<KpiTone, string> = {
  muted: "text-foreground",
  info: "text-info",
  warning: "text-warning",
  destructive: "text-destructive",
  success: "text-success",
};

interface Props {
  label: string;
  value: number;
  total: number;
  tone?: KpiTone;
  active?: boolean;
  onClick?: () => void;
  animatePulse?: boolean;
}

export function ModuleKpiCard({ label, value, total, tone = "muted", active, onClick, animatePulse }: Props) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex items-stretch rounded-md border bg-card overflow-hidden text-left transition",
        "hover:shadow-md hover:border-foreground/20",
        active && "ring-2 ring-offset-1 ring-foreground/20",
      )}
    >
      <span className={cn("w-1 shrink-0", BAR[tone], animatePulse && value > 0 && "animate-pulse")} />
      <div className="flex-1 min-w-0 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <div className={cn("text-2xl font-semibold tabular-nums leading-tight", TEXT[tone])}>
            {value.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{pct}%</div>
        </div>
        <div className="mt-1.5 h-[2px] w-full bg-muted rounded overflow-hidden">
          <div className={cn("h-full", BAR[tone])} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}