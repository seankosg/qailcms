import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import { cn } from "@/lib/utils";

interface Props {
  counts: Record<string, number>;
}

const ORDER = ["완료", "정상", "주의", "지연", "위험"] as const;

// 시맨틱 토큰 매핑 (Recharts 없이 SVG 도넛으로 렌더)
const SEG_COLOR: Record<string, string> = {
  완료: "var(--schedule-actual)",
  정상: "var(--schedule-plan)",
  주의: "var(--warning)",
  지연: "var(--schedule-over)",
  위험: "var(--schedule-short)",
};

export function JudgmentDonut({ counts }: Props) {
  const total = ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const R = 60;
  const CX = 80;
  const CY = 80;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  const segs = ORDER.map((k) => {
    const v = counts[k] ?? 0;
    const frac = total > 0 ? v / total : 0;
    const dash = frac * CIRC;
    const off = -acc;
    acc += dash;
    return { k, v, dash, off };
  });

  return (
    <Card className="@container">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">자동 판정 분포</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 @[320px]:flex-row">
        <svg viewBox="0 0 160 160" className="h-32 w-32 shrink-0 @[380px]:h-40 @[380px]:w-40">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--muted)" strokeWidth="20" />
          {segs.map(
            (s) =>
              s.dash > 0 && (
                <circle
                  key={s.k}
                  cx={CX}
                  cy={CY}
                  r={R}
                  fill="none"
                  stroke={SEG_COLOR[s.k]}
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
            {total.toLocaleString()}
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
          {ORDER.map((k) => (
            <div key={k} className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: SEG_COLOR[k] }}
                />
                <Badge className={cn("truncate px-2 py-0", AUTO_JUDGMENT_COLORS[k])}>{k}</Badge>
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {(counts[k] ?? 0).toLocaleString()}
                {total > 0 && (
                  <span className="ml-1 text-[10px]">
                    ({(((counts[k] ?? 0) / total) * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}