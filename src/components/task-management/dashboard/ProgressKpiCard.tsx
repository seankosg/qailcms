import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Tone = "emerald" | "neutral" | "amber";

const BAR: Record<Tone, string> = {
  emerald: "[&>div]:bg-emerald-500",
  neutral: "[&>div]:bg-slate-400",
  amber: "[&>div]:bg-amber-500",
};

interface Props {
  label: string;
  percent: number;
  sub?: string;
  barTone?: Tone;
  onClick?: () => void;
}

export function ProgressKpiCard({ label, percent, sub, barTone = "emerald", onClick }: Props) {
  const raw = Number.isFinite(percent) ? percent : 0;
  const pct = Math.max(0, Math.min(100, raw));
  const isNegative = raw < 0;
  return (
    <Card
      onClick={onClick}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-primary/10")}
    >
      <CardContent className="flex flex-col gap-1 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "text-3xl font-bold tabular-nums leading-tight",
            isNegative && "text-destructive",
          )}
        >
          {pct.toFixed(1)}%
        </div>
        <Progress value={pct} className={cn("h-1.5", BAR[barTone])} />
        {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
      </CardContent>
    </Card>
  );
}