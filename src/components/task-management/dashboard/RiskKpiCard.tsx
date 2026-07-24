import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "danger" | "warn" | "info" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  danger: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  neutral: "",
};

export interface RiskKpiBreakdownRow {
  label: string;
  count: number;
  onClick?: () => void;
  disabled?: boolean;
}

interface Props {
  label: string;
  count: number;
  percent?: number;
  sub?: string;
  tone?: Tone;
  showPercentFirst?: boolean;
  onClick?: () => void;
  action?: React.ReactNode;
  breakdown?: RiskKpiBreakdownRow[];
  /** hover 툴팁으로 노출할 산식 문자열 */
  formula?: string;
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
  breakdown,
  formula,
}: Props) {
  const primary =
    showPercentFirst && percent != null ? `${percent.toFixed(1)}%` : count.toLocaleString();
  const secondary =
    showPercentFirst && percent != null
      ? `${count.toLocaleString()} items`
      : percent != null
        ? `${percent.toFixed(1)}%`
        : undefined;
  const hasBreakdown = !!breakdown && breakdown.length > 0;
  return (
    <Card
      onClick={onClick}
      title={formula}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-primary/10")}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-normal break-words leading-tight">
                {label}
              </div>
              {action ? <div onClick={(e) => e.stopPropagation()}>{action}</div> : null}
            </div>
            <div
              className={cn(
                "text-3xl font-bold tabular-nums leading-tight",
                TONE_CLASSES[tone],
              )}
            >
              {primary}
            </div>
            {secondary && (
              <div className="text-[11px] text-muted-foreground tabular-nums">{secondary}</div>
            )}
            {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
          </div>
          {hasBreakdown && (
            <div
              className="flex max-h-28 min-w-[104px] flex-col gap-0.5 overflow-y-auto border-l pl-2"
              onClick={(e) => e.stopPropagation()}
            >
              {breakdown!.map((row, idx) =>
                row.disabled || !row.onClick ? (
                  <div
                    key={`${row.label}-${idx}`}
                    className="flex h-5 items-center justify-between gap-2 px-1 text-[11px] tabular-nums text-muted-foreground"
                  >
                    <span className="truncate">{row.label}</span>
                    <span className={cn("font-medium", TONE_CLASSES[tone])}>
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <button
                    key={`${row.label}-${idx}`}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      row.onClick?.();
                    }}
                    className="flex h-5 items-center justify-between gap-2 rounded px-1 text-[11px] tabular-nums transition-colors hover:bg-primary/10 cursor-pointer"
                  >
                    <span className="truncate">{row.label}</span>
                    <span className={cn("font-medium", TONE_CLASSES[tone])}>
                      {row.count.toLocaleString()}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}