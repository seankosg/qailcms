import { cn } from "@/lib/utils";
import type { Stats } from "@/lib/defect-management/dashboard-shape";

type MetricSlot = "issued" | "open" | "rectified" | "reopen" | "closed" | "closurePct";

function fmtPct(pct: number): string {
  if (!Number.isFinite(pct)) return "-";
  return `${Math.round(pct * 100)}%`;
}

function closureColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  const p = pct * 100;
  if (p < 40) return "text-destructive font-semibold";
  if (p < 80) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

function closureBg(pct: number | null): string {
  if (pct == null) return "";
  const p = pct * 100;
  if (p < 40) return "bg-destructive/10";
  if (p < 80) return "bg-amber-500/10";
  return "bg-emerald-500/10";
}

export function DeSnagStatusCell({
  stats,
  onMetric,
  dim,
}: {
  stats: Stats;
  onMetric: (m: MetricSlot) => void;
  dim?: boolean;
}) {
  const { issued, open, rectified, reopen, closed, closurePct } = stats;
  const cell = (label: string, value: number, slot: MetricSlot, tone?: string) => (
    <button
      type="button"
      onClick={() => onMetric(slot)}
      className={cn(
        "w-full text-left px-1 py-0.5 rounded hover:bg-muted/60 transition tabular-nums",
        tone,
      )}
      title={`${label}: ${value} (${issued ? Math.round((value / issued) * 100) : 0}%)`}
    >
      <span className="text-[10px] text-muted-foreground mr-1">{label}</span>
      <span className="text-xs">{value.toLocaleString()}</span>
      {issued > 0 && slot !== "issued" && (
        <span className="text-[10px] text-muted-foreground ml-1">
          ({Math.round((value / issued) * 100)}%)
        </span>
      )}
    </button>
  );

  return (
    <div className={cn("grid grid-cols-3 gap-x-0.5 gap-y-0 text-[11px] leading-tight", dim && "opacity-60", closureBg(closurePct))}>
      {cell("ISSUED", issued, "issued", "font-medium")}
      {cell("Open", open, "open")}
      {cell("Rect.", rectified, "rectified")}
      {cell("Re-Op", reopen, "reopen")}
      {cell("Closed", closed, "closed")}
      <button
        type="button"
        onClick={() => onMetric("closurePct")}
        className={cn("w-full text-left px-1 py-0.5 rounded hover:bg-muted/60 transition tabular-nums", closureColor(closurePct))}
        title="Closure% = Closed / ISSUED"
      >
        <span className="text-[10px] text-muted-foreground mr-1">Cls%</span>
        <span className="text-xs">{closurePct == null ? "-" : fmtPct(closurePct)}</span>
      </button>
    </div>
  );
}
