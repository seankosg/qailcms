import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { ChartPoint } from "@/lib/task-management/progress-chart.functions";

interface Props {
  planPoints?: ChartPoint[];
  actualPoints?: ChartPoint[];
  xStart?: string | null;
  xEnd?: string | null;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
}

const W = 120;
const H = 32;
const PAD_X = 2;
const PAD_Y = 3;

function toTime(s: string): number {
  return new Date(`${s}T00:00:00Z`).getTime();
}

function buildPath(
  points: ChartPoint[] | undefined,
  x0: number,
  x1: number,
): string {
  if (!points || points.length < 2 || x1 <= x0) return "";
  const dx = W - PAD_X * 2;
  const dy = H - PAD_Y * 2;
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const tx = PAD_X + (dx * (toTime(p.d) - x0)) / (x1 - x0);
    const ty = PAD_Y + dy * (1 - Math.max(0, Math.min(1, p.v)));
    d += (i === 0 ? "M" : "L") + tx.toFixed(1) + "," + ty.toFixed(1) + " ";
  }
  return d.trim();
}

export function MiniProgressChart({
  planPoints,
  actualPoints,
  xStart,
  xEnd,
  onClick,
  className,
  title,
}: Props) {
  const { planD, actualD, hasData } = useMemo(() => {
    // Compute effective X domain
    const allDates: number[] = [];
    for (const p of planPoints ?? []) allDates.push(toTime(p.d));
    for (const p of actualPoints ?? []) allDates.push(toTime(p.d));
    if (xStart) allDates.push(toTime(xStart));
    if (xEnd) allDates.push(toTime(xEnd));
    if (allDates.length < 2) {
      return { planD: "", actualD: "", hasData: false };
    }
    const x0 = Math.min(...allDates);
    const x1 = Math.max(...allDates);
    return {
      planD: buildPath(planPoints, x0, x1),
      actualD: buildPath(actualPoints, x0, x1),
      hasData: (planPoints?.length ?? 0) > 1 || (actualPoints?.length ?? 0) > 1,
    };
  }, [planPoints, actualPoints, xStart, xEnd]);

  if (!hasData) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? "차트 데이터 없음 · 클릭하여 다시 계산"}
        className={cn(
          "flex h-8 w-[120px] items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground",
          onClick && "cursor-pointer hover:bg-muted/50",
          className,
        )}
      >
        —
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? "클릭하여 상세 차트 보기"}
      className={cn(
        "rounded border bg-background transition-colors",
        onClick && "cursor-pointer hover:bg-muted/40",
        className,
      )}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        aria-label="progress mini chart"
      >
        {/* 100% baseline */}
        <line
          x1={PAD_X}
          y1={PAD_Y}
          x2={W - PAD_X}
          y2={PAD_Y}
          stroke="hsl(var(--muted-foreground) / 0.25)"
          strokeWidth={0.5}
          strokeDasharray="2 2"
        />
        {planD && (
          <path
            d={planD}
            fill="none"
            stroke="hsl(215 90% 55%)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {actualD && (
          <path
            d={actualD}
            fill="none"
            stroke="hsl(0 80% 55%)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}