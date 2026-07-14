import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stats } from "@/lib/defect-management/dashboard-shape";

export type MetricSlot = "issued" | "open" | "rectified" | "reopen" | "closed";

type Tone = {
  border: string;
  bg: string;
  value: string;
  label: string;
  barTrack: string;
  barFill: string;
};

const TONES: Record<MetricSlot, Tone> = {
  issued: {
    border: "",
    bg: "",
    value: "text-foreground",
    label: "text-muted-foreground",
    barTrack: "bg-muted",
    barFill: "bg-foreground/70",
  },
  open: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    value: "text-amber-600 dark:text-amber-400",
    label: "text-amber-700/80 dark:text-amber-300/80",
    barTrack: "bg-amber-500/15",
    barFill: "bg-amber-500",
  },
  rectified: {
    border: "border-sky-500/40",
    bg: "bg-sky-500/10",
    value: "text-sky-600 dark:text-sky-400",
    label: "text-sky-700/80 dark:text-sky-300/80",
    barTrack: "bg-sky-500/15",
    barFill: "bg-sky-500",
  },
  reopen: {
    border: "border-rose-500/40",
    bg: "bg-rose-500/10",
    value: "text-rose-600 dark:text-rose-400",
    label: "text-rose-700/80 dark:text-rose-300/80",
    barTrack: "bg-rose-500/15",
    barFill: "bg-rose-500",
  },
  closed: {
    border: "border-emerald-400/40",
    bg: "bg-emerald-400/10",
    value: "text-emerald-600 dark:text-emerald-400",
    label: "text-emerald-700/80 dark:text-emerald-300/80",
    barTrack: "bg-emerald-400/15",
    barFill: "bg-emerald-400",
  },
};

function ColoredBar({ pct, tone }: { pct: number; tone: Tone }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={cn("mt-3 h-2 w-full overflow-hidden rounded-full", tone.barTrack)}>
      <div
        className={cn("h-full rounded-full transition-all", tone.barFill)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

function KpiCard({
  slot,
  label,
  value,
  pct,
  showBar,
  onClick,
}: {
  slot: MetricSlot;
  label: string;
  value: number;
  pct: number | null;
  showBar: boolean;
  onClick?: () => void;
}) {
  const tone = TONES[slot];
  return (
    <Card
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden transition-all",
        tone.border,
        tone.bg,
        onClick && "cursor-pointer hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <CardContent className="flex flex-col gap-1 p-5">
        <p
          className={cn(
            "text-sm font-semibold uppercase tracking-wide",
            tone.label,
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-4xl font-bold leading-none tabular-nums md:text-5xl",
            tone.value,
          )}
        >
          {value.toLocaleString()}
        </p>
        <p className={cn("mt-1 text-sm font-medium tabular-nums", tone.label)}>
          {pct == null ? "—" : `${Math.round(pct)}%`}
        </p>
        {showBar && <ColoredBar pct={pct ?? 0} tone={tone} />}
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
  const { issued, open, rectified, reopen, closed } = stats;
  const ratio = (v: number) => (issued > 0 ? (v / issued) * 100 : null);

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <KpiCard
          slot="issued"
          label="Issued"
          value={issued}
          pct={issued > 0 ? 100 : null}
          showBar={false}
          onClick={() => onMetric("issued")}
        />
        <KpiCard
          slot="open"
          label="Open"
          value={open}
          pct={ratio(open)}
          showBar
          onClick={() => onMetric("open")}
        />
        <KpiCard
          slot="rectified"
          label="Rectified"
          value={rectified}
          pct={ratio(rectified)}
          showBar
          onClick={() => onMetric("rectified")}
        />
        <KpiCard
          slot="reopen"
          label="Re-Opened"
          value={reopen}
          pct={ratio(reopen)}
          showBar
          onClick={() => onMetric("reopen")}
        />
        <KpiCard
          slot="closed"
          label="Closed"
          value={closed}
          pct={ratio(closed)}
          showBar
          onClick={() => onMetric("closed")}
        />
      </div>
    </section>
  );
}
