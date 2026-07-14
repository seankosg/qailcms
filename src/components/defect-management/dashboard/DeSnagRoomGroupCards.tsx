import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RoomGroupCol, Stats } from "@/lib/defect-management/dashboard-shape";

type StatusSlot = "open" | "rectified" | "reopen" | "closed";

const STATUS_META: Record<
  StatusSlot,
  { label: string; dot: string; barTrack: string; barFill: string; text: string; statusParam: string }
> = {
  open: {
    label: "Open",
    dot: "bg-amber-500",
    barTrack: "bg-amber-500/15",
    barFill: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    statusParam: "Open",
  },
  rectified: {
    label: "Rectified",
    dot: "bg-sky-500",
    barTrack: "bg-sky-500/15",
    barFill: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    statusParam: "Rectified",
  },
  reopen: {
    label: "Re-Opened",
    dot: "bg-rose-500",
    barTrack: "bg-rose-500/15",
    barFill: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    statusParam: "Re-Opened",
  },
  closed: {
    label: "Closed",
    dot: "bg-emerald-400",
    barTrack: "bg-emerald-400/15",
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

function StatusRow({
  slot,
  count,
  issued,
  onClick,
}: {
  slot: StatusSlot;
  count: number;
  issued: number;
  onClick?: () => void;
}) {
  const meta = STATUS_META[slot];
  const pct = issued > 0 ? (count / issued) * 100 : 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="group/row flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
        {meta.label}
      </span>
      <span className={cn("w-10 shrink-0 text-right text-xs font-semibold tabular-nums", meta.text)}>
        {count.toLocaleString()}
      </span>
      <div className={cn("relative h-1.5 flex-1 overflow-hidden rounded-full", meta.barTrack)}>
        <div
          className={cn("h-full rounded-full transition-all", meta.barFill)}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
        {issued > 0 ? `${Math.round(pct)}%` : "—"}
      </span>
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
          % = 그룹 Issued 대비. 카드/행 클릭 시 필터 이동.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map(({ col, stats }) => {
          const rg = roomGroupParam(col);
          return (
            <Card
              key={col}
              onClick={() => onNavigate({ roomGroup: rg })}
              className="group cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold uppercase tracking-wide text-foreground">
                    {col}
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {stats.issued.toLocaleString()}
                  </p>
                </div>
                <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Issued (그룹 총계)
                </p>
                <div className="flex flex-col gap-0.5">
                  <StatusRow
                    slot="open"
                    count={stats.open}
                    issued={stats.issued}
                    onClick={() => onNavigate({ roomGroup: rg, status: "Open" })}
                  />
                  <StatusRow
                    slot="rectified"
                    count={stats.rectified}
                    issued={stats.issued}
                    onClick={() => onNavigate({ roomGroup: rg, status: "Rectified" })}
                  />
                  <StatusRow
                    slot="reopen"
                    count={stats.reopen}
                    issued={stats.issued}
                    onClick={() => onNavigate({ roomGroup: rg, status: "Re-Opened" })}
                  />
                  <StatusRow
                    slot="closed"
                    count={stats.closed}
                    issued={stats.issued}
                    onClick={() => onNavigate({ roomGroup: rg, status: "Closed" })}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}