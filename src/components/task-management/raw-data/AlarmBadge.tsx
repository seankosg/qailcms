import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Judgment = "완료" | "정상" | "주의" | "지연" | "위험";

interface Config {
  icon: LucideIcon;
  cls: string;
  pulse?: boolean;
}

// soft: 낮은 심각도(가벼운 배경) / solid: 높은 심각도(진한 배경 + 흰 글씨)
const CONFIG: Record<Judgment, Config> = {
  "완료": {
    icon: CheckCircle2,
    cls:
      "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/20",
  },
  "정상": {
    icon: Circle,
    cls:
      "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-inset ring-sky-500/20",
  },
  "주의": {
    icon: AlertCircle,
    cls:
      "bg-amber-500/20 text-amber-800 dark:text-amber-200 ring-1 ring-inset ring-amber-500/30",
  },
  "지연": {
    icon: Clock,
    cls:
      "bg-orange-600 text-white ring-1 ring-inset ring-orange-700/40 shadow-sm",
  },
  "위험": {
    icon: AlertTriangle,
    cls:
      "bg-rose-600 text-white ring-1 ring-inset ring-rose-700/40 shadow-sm",
    pulse: true,
  },
};

interface Props {
  value: string;
  todayGap?: number | null; // -1 ~ 1 (%p 소수)
  slipDays?: number | null;
  actualProgress?: number | null;
}

function fmtPercentPoints(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const p = Number(v) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%p`;
}

function fmtSlip(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return `${n > 0 ? "+" : ""}${n}d`;
}

export function AlarmBadge({ value, todayGap, slipDays, actualProgress }: Props) {
  const cfg = CONFIG[value as Judgment];
  if (!cfg) {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-foreground">
        {value}
      </span>
    );
  }
  const Icon = cfg.icon;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
              cfg.cls,
            )}
          >
            <Icon
              className={cn("h-3 w-3 shrink-0", cfg.pulse && "motion-safe:animate-pulse")}
              strokeWidth={2.5}
            />
            <span>{value}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          <div className="flex flex-col gap-0.5">
            <div className="font-semibold">{value}</div>
            <div className="tabular-nums text-muted-foreground">
              T.Diff <span className="text-foreground">{fmtPercentPoints(todayGap)}</span>
              {" · "}Slip <span className="text-foreground">{fmtSlip(slipDays)}</span>
              {actualProgress != null && (
                <>
                  {" · "}Actual{" "}
                  <span className="text-foreground">
                    {(Number(actualProgress) * 100).toFixed(1)}%
                  </span>
                </>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}