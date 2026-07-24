import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Seg = "completed" | "wip" | "not_started";

interface Props {
  total: number;
  completed: number;
  wip: number;
  notStarted: number;
  onSegmentClick?: (seg: Seg) => void;
}

const ORDER: { key: Seg; label: string; color: string }[] = [
  { key: "completed", label: "Completed", color: "var(--schedule-actual)" },
  { key: "wip", label: "WIP", color: "var(--schedule-plan)" },
  { key: "not_started", label: "Not Started", color: "hsl(var(--muted-foreground))" },
];

export function StatusMixDonut({ total, completed, wip, notStarted, onSegmentClick }: Props) {
  const values: Record<Seg, number> = {
    completed,
    wip,
    not_started: notStarted,
  };
  const safeTotal = total || 0;
  const R = 60;
  const CX = 80;
  const CY = 80;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  const segs = ORDER.map((s) => {
    const v = values[s.key];
    const frac = safeTotal > 0 ? v / safeTotal : 0;
    const dash = frac * CIRC;
    const off = -acc;
    acc += dash;
    return { ...s, v, dash, off };
  });

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Status Mix</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center gap-4 @[320px]:flex-row @[320px]:items-center">
        <svg viewBox="0 0 160 160" className="h-32 w-32 shrink-0 @[380px]:h-40 @[380px]:w-40">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--muted)" strokeWidth="20" />
          {segs.map(
            (s) =>
              s.dash > 0 && (
                <circle
                  key={s.key}
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="20"
                  strokeDasharray={`${s.dash} ${CIRC - s.dash}`}
                  strokeDashoffset={s.off}
                  transform={`rotate(-90 ${CX} ${CY})`}
                />
              ),
          )}
          <text
            x={CX}
            y={CY - 4}
            textAnchor="middle"
            className="fill-foreground"
            style={{ font: "600 20px sans-serif" }}
          >
            {safeTotal.toLocaleString()}
          </text>
          <text
            x={CX}
            y={CY + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ font: "10px sans-serif" }}
          >
            총 Task
          </text>
        </svg>
        <div className="flex w-full min-w-0 flex-1 flex-col gap-1 text-xs">
          {segs.map((s) => {
            const pct = safeTotal > 0 ? (s.v / safeTotal) * 100 : 0;
            return (
              <button
                key={s.key}
                type="button"
                onClick={onSegmentClick ? () => onSegmentClick(s.key) : undefined}
                disabled={!onSegmentClick}
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors",
                  onSegmentClick
                    ? "hover:bg-muted/70 cursor-pointer"
                    : "cursor-default",
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm"
                    style={{ background: s.color }}
                  />
                  <Badge variant="outline" className="truncate px-2 py-0 font-medium">
                    {s.label}
                  </Badge>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {s.v.toLocaleString()}
                  {safeTotal > 0 && (
                    <span className="ml-1 text-[10px]">({pct.toFixed(0)}%)</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
