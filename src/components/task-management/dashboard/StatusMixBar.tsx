import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  total: number;
  completed: number;
  wip: number;
  notStarted: number;
  onSegmentClick?: (seg: "completed" | "wip" | "not_started") => void;
}

export function StatusMixBar({ total, completed, wip, notStarted, onSegmentClick }: Props) {
  const safe = total || 1;
  const cPct = (completed / safe) * 100;
  const wPct = (wip / safe) * 100;
  const nPct = (notStarted / safe) * 100;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Status Mix</span>
          <span className="tabular-nums">
            {total.toLocaleString()} items · Completed {completed.toLocaleString()} · WIP {wip.toLocaleString()} · Not Started {notStarted.toLocaleString()}
          </span>
        </div>
        <div className="flex h-6 w-full overflow-hidden rounded-md border">
          <Segment
            pct={cPct}
            className="bg-emerald-500"
            label="Completed"
            count={completed}
            onClick={onSegmentClick ? () => onSegmentClick("completed") : undefined}
          />
          <Segment
            pct={wPct}
            className="bg-blue-500"
            label="WIP"
            count={wip}
            onClick={onSegmentClick ? () => onSegmentClick("wip") : undefined}
          />
          <Segment
            pct={nPct}
            className="bg-slate-300 dark:bg-slate-600"
            label="Not Started"
            count={notStarted}
            onClick={onSegmentClick ? () => onSegmentClick("not_started") : undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Segment({
  pct,
  className,
  label,
  count,
  onClick,
}: {
  pct: number;
  className: string;
  label: string;
  count: number;
  onClick?: () => void;
}) {
  if (pct <= 0) return null;
  return (
    <button
      type="button"
      style={{ width: `${pct}%` }}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center px-1 text-[10px] font-medium text-white transition-opacity hover:opacity-80",
        className,
        !onClick && "cursor-default",
      )}
      title={`${label}: ${count.toLocaleString()} (${pct.toFixed(1)}%)`}
    >
      {pct >= 8 ? `${label} ${pct.toFixed(0)}%` : ""}
    </button>
  );
}