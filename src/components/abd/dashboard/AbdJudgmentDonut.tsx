import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAbdDataDate } from "@/hooks/useAbdDataDate";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import { cn } from "@/lib/utils";
import { getAbdDashboardJudgmentMix, type AbdJudgmentMixRow } from "@/lib/abd/dashboard.functions";

const ORDER = ["완료", "정상", "주의", "지연", "악화"] as const;
const SEG_COLOR: Record<string, string> = {
  완료: "var(--schedule-actual)",
  정상: "var(--schedule-plan)",
  주의: "var(--warning)",
  지연: "var(--schedule-over)",
  악화: "var(--schedule-short)",
};

export function sumJudgmentMix(rows: AbdJudgmentMixRow[] | undefined): Record<string, number> {
  const out: Record<string, number> = { 완료: 0, 정상: 0, 주의: 0, 지연: 0, 악화: 0 };
  for (const r of rows ?? []) {
    out["완료"] += Number(r.approved ?? 0);
    out["정상"] += Number(r.normal ?? 0);
    out["주의"] += Number(r.caution ?? 0);
    out["지연"] += Number(r.delayed ?? 0);
    out["악화"] += Number(r.critical ?? 0);
  }
  return out;
}

export function AbdJudgmentDonut({ batchNo, plots = [] }: { batchNo: string[]; plots?: string[] }) {
  const fn = useServerFn(getAbdDashboardJudgmentMix);
  const [asOf] = useAbdDataDate();
  const q = useQuery({
    queryKey: ["abd-dash-judgment-mix", asOf, plots.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { batch_no: batchNo, plots, as_of: asOf || null } }}),
    staleTime: 60_000,
  });
  const counts = useMemo(() => sumJudgmentMix(q.data), [q.data]);
  const total = ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const R = 60, CX = 80, CY = 80;
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
    <Card className="@container flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">자동 판정 분포</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center gap-2 @[320px]:flex-row">
        <svg viewBox="0 0 160 160" className="h-28 w-28 shrink-0 @[380px]:h-32 @[380px]:w-32">
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
          <text x={CX} y={CY - 4} textAnchor="middle" className="fill-foreground" style={{ font: "600 20px sans-serif" }}>
            {total.toLocaleString()}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" className="fill-muted-foreground" style={{ font: "10px sans-serif" }}>
            총 Docs
          </text>
        </svg>
        <div className="flex w-full min-w-0 flex-1 flex-col gap-1 text-xs">
          {ORDER.map((k) => (
            <div key={k} className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: SEG_COLOR[k] }} />
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