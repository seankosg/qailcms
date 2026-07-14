import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ListChecks,
  CircleDot,
  Wrench,
  RotateCcw,
  CheckCircle2,
  Target,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stats } from "@/lib/defect-management/dashboard-shape";

type MetricSlot = "issued" | "open" | "rectified" | "reopen" | "closed" | "closurePct";

function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "-";
  return `${Math.round(pct * 100)}%`;
}

function closureTone(pct: number | null): {
  text: string;
  ring: string;
  bg: string;
} {
  if (pct == null) return { text: "text-muted-foreground", ring: "", bg: "" };
  const p = pct * 100;
  if (p < 40)
    return {
      text: "text-destructive",
      ring: "border-destructive/40",
      bg: "bg-destructive/5",
    };
  if (p < 80)
    return {
      text: "text-amber-600 dark:text-amber-400",
      ring: "border-amber-500/40",
      bg: "bg-amber-500/5",
    };
  return {
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
  };
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
  ring,
  bg,
  progress,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  ring?: string;
  bg?: string;
  progress?: number | null;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden transition-colors",
        onClick && "cursor-pointer hover:bg-muted/40",
        ring,
        bg,
      )}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-0.5 text-2xl font-bold leading-tight tabular-nums",
              accent ?? "text-foreground",
            )}
          >
            {value}
          </p>
          {sub && (
            <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>
          )}
          {progress != null && (
            <Progress value={progress} className="mt-2 h-1.5" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DeSnagGrandTotalCards({
  plot,
  stats,
  onMetric,
  onAll,
}: {
  plot: string;
  stats: Stats;
  onMetric: (m: MetricSlot) => void;
  onAll: () => void;
}) {
  const { issued, open, rectified, reopen, closed, closurePct } = stats;
  const pct = (v: number) =>
    issued > 0 ? `${Math.round((v / issued) * 100)}% of ISSUED` : "—";
  const tone = closureTone(closurePct);
  const pctValue = closurePct == null ? null : Math.round(closurePct * 100);

  return (
    <section className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent p-3 md:p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/70">
            Plot {plot}
          </p>
          <h2 className="text-sm font-semibold tracking-tight">Grand Total</h2>
        </div>
        <button
          type="button"
          onClick={onAll}
          className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          전체 목록 <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
        <KpiCard
          icon={<ListChecks className="h-6 w-6 text-primary" />}
          label="Issued"
          value={issued.toLocaleString()}
          sub="Total snags"
          onClick={() => onMetric("issued")}
        />
        <KpiCard
          icon={<CircleDot className="h-6 w-6 text-sky-500" />}
          label="Open"
          value={open.toLocaleString()}
          sub={pct(open)}
          onClick={() => onMetric("open")}
        />
        <KpiCard
          icon={<Wrench className="h-6 w-6 text-amber-500" />}
          label="Rectified"
          value={rectified.toLocaleString()}
          sub={pct(rectified)}
          onClick={() => onMetric("rectified")}
        />
        <KpiCard
          icon={<RotateCcw className="h-6 w-6 text-rose-500" />}
          label="Re-Opened"
          value={reopen.toLocaleString()}
          sub={pct(reopen)}
          onClick={() => onMetric("reopen")}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-6 w-6 text-emerald-500" />}
          label="Closed"
          value={closed.toLocaleString()}
          sub={pct(closed)}
          onClick={() => onMetric("closed")}
        />
        <KpiCard
          icon={<Target className={cn("h-6 w-6", tone.text)} />}
          label="Closure %"
          value={fmtPct(closurePct)}
          sub="Closed ÷ Issued"
          accent={cn("font-bold", tone.text)}
          ring={tone.ring}
          bg={tone.bg}
          progress={pctValue}
          onClick={() => onMetric("closurePct")}
        />
      </div>
    </section>
  );
}
