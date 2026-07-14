import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RoomGroupCol, Stats } from "@/lib/defect-management/dashboard-shape";

type StatusSlot = "open" | "rectified" | "reopen" | "closed";

const STATUS_META: Record<
  StatusSlot,
  { label: string; dot: string; barFill: string; text: string; statusParam: string }
> = {
  open: {
    label: "Open",
    dot: "bg-amber-500",
    barFill: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    statusParam: "Open",
  },
  rectified: {
    label: "Rectified",
    dot: "bg-sky-500",
    barFill: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    statusParam: "Rectified",
  },
  reopen: {
    label: "Re-Opened",
    dot: "bg-rose-500",
    barFill: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    statusParam: "Re-Opened",
  },
  closed: {
    label: "Closed",
    dot: "bg-emerald-400",
    barFill: "bg-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
    statusParam: "Closed",
  },
};

function roomGroupParam(col: RoomGroupCol): string {
  if (col === "FACADE") return "FACADE,LANDSCAPE";
  if (col === "N/A") return "__EMPTY__";
  return col;
}

const SLOT_ORDER: StatusSlot[] = ["open", "reopen", "rectified", "closed"];

function StackedBar({
  stats,
  onSegment,
}: {
  stats: Stats;
  onSegment: (slot: StatusSlot) => void;
}) {
  const issued = stats.issued;
  const counts: Record<StatusSlot, number> = {
    open: stats.open,
    rectified: stats.rectified,
    reopen: stats.reopen,
    closed: stats.closed,
  };
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {SLOT_ORDER.map((slot) => {
        const c = counts[slot];
        if (c <= 0 || issued <= 0) return null;
        const pct = (c / issued) * 100;
        const meta = STATUS_META[slot];
        return (
          <button
            key={slot}
            type="button"
            title={`${meta.label}: ${c.toLocaleString()} (${Math.round(pct)}%)`}
            onClick={(e) => {
              e.stopPropagation();
              onSegment(slot);
            }}
            className={cn(
              "h-full transition-opacity hover:opacity-80",
              meta.barFill,
            )}
            style={{ width: `${pct}%` }}
            aria-label={`${meta.label} ${c} (${Math.round(pct)}%)`}
          />
        );
      })}
    </div>
  );
}

function LegendItem({
  slot,
  count,
  issued,
  onClick,
}: {
  slot: StatusSlot;
  count: number;
  issued: number;
  onClick: () => void;
}) {
  const meta = STATUS_META[slot];
  const pct = issued > 0 ? Math.round((count / issued) * 100) : 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/60"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
      <span className="text-[11px] font-medium text-muted-foreground">{meta.label}</span>
      <span className={cn("text-xs font-semibold tabular-nums", meta.text)}>
        {count.toLocaleString()}
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">· {pct}%</span>
    </button>
  );
}

export function DeSnagRoomGroupCards({
  entries,
  onNavigate,
}: {
  entries: Array<{ col: RoomGroupCol; stats: Stats }>;
  onNavigate: (params: Record<string, string>) => void;
}) {
  const visible = entries.filter((e) => e.stats.issued > 0);
  if (visible.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 p-3 md:p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Room Group별 현황</h2>
        <p className="text-[11px] text-muted-foreground">
          바 = 그룹 Issued 100% 기준 status 비중. 우측 붉은 숫자 = Open + Re-Opened.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map(({ col, stats }) => {
          const rg = roomGroupParam(col);
          const pending = stats.open + stats.reopen;
          const pendingPct = stats.issued > 0 ? Math.round((pending / stats.issued) * 100) : 0;
          return (
            <Card
              key={col}
              onClick={() => onNavigate({ roomGroup: rg })}
              className="group cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="p-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold uppercase tracking-wide text-foreground">
                    {col}
                  </p>
                  <p className="flex items-baseline gap-1.5 text-red-600 dark:text-red-500">
                    <span className="text-2xl font-bold tabular-nums">
                      {pending.toLocaleString()}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">· {pendingPct}%</span>
                  </p>
                </div>
                <div className="mb-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  / Issued {stats.issued.toLocaleString()}
                </div>
                <StackedBar
                  stats={stats}
                  onSegment={(slot) =>
                    onNavigate({ roomGroup: rg, status: STATUS_META[slot].statusParam })
                  }
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {SLOT_ORDER.map((slot) => (
                    <LegendItem
                      key={slot}
                      slot={slot}
                      count={
                        slot === "open"
                          ? stats.open
                          : slot === "rectified"
                            ? stats.rectified
                            : slot === "reopen"
                              ? stats.reopen
                              : stats.closed
                      }
                      issued={stats.issued}
                      onClick={() =>
                        onNavigate({ roomGroup: rg, status: STATUS_META[slot].statusParam })
                      }
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}