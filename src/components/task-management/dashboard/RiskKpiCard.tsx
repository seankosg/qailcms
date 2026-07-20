import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "danger" | "warn" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  neutral: "",
};

interface Props {
  label: string;
  count: number;
  percent?: number;
  sub?: string;
  tone?: Tone;
  showPercentFirst?: boolean;
  onClick?: () => void;
  action?: React.ReactNode;
}

export function RiskKpiCard({
  label,
  count,
  percent,
  sub,
  tone = "neutral",
  showPercentFirst = false,
  onClick,
  action,
}: Props) {
  const primary =
    showPercentFirst && percent != null ? `${percent.toFixed(1)}%` : count.toLocaleString();
  const secondary =
    showPercentFirst && percent != null
      ? `${count.toLocaleString()} items`
      : percent != null
        ? `${percent.toFixed(1)}%`
        : undefined;
  return (
    <Card
      onClick={onClick}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-accent/40")}
    >
      <CardContent className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {action ? <div onClick={(e) => e.stopPropagation()}>{action}</div> : null}
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums leading-tight", TONE_CLASSES[tone])}>
          {primary}
        </div>
        {secondary && (
          <div className="text-[11px] text-muted-foreground tabular-nums">{secondary}</div>
        )}
        {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
      </CardContent>
    </Card>
  );
}