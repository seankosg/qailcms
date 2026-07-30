import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAbdDataDate } from "@/hooks/useAbdDataDate";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAbdDashboardJudgmentMix } from "@/lib/abd/dashboard.functions";

type Seg = "Approved" | "UR" | "DS";

const ORDER: { key: Seg; label: string; color: string }[] = [
  { key: "Approved", label: "Approved", color: "var(--schedule-actual)" },
  { key: "UR", label: "UR", color: "var(--warning)" },
  { key: "DS", label: "DS", color: "var(--schedule-plan)" },
];

export function AbdStatusMixDonut({ batchNo, plots = [] }: { batchNo: string[]; plots?: string[] }) {
  const fn = useServerFn(getAbdDashboardJudgmentMix);
  const [asOf] = useAbdDataDate();
  const q = useQuery({
    queryKey: ["abd-dash-judgment-mix", asOf, plots.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { batch_no: batchNo, plots, as_of: asOf || null } }),
    staleTime: 60_000,
  });

  const values = useMemo(() => {
    const m: Record<Seg, number> = { Approved: 0, UR: 0, DS: 0 };
    for (const r of q.data ?? []) {
      const k = (r.stage === "NS" ? "DS" : r.stage) as Seg; // NS 폐지 하위호환
      if (k in m) m[k] += Number(r.total ?? 0);
    }
    return m;
  }, [q.data]);
  const total = values.Approved + values.UR + values.DS;

  const R = 60, CX = 80, CY = 80;
  const CIRC = 2 * Math.PI * R;
  let acc = 0;
  const segs = ORDER.map((s) => {
    const v = values[s.key];
    const frac = total > 0 ? v / total : 0;
    const dash = frac * CIRC;
    const off = -acc;
    acc += dash;
    return { ...s, v, dash, off };
  });

  return (
    <Card className="@container flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Status Mix</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center gap-2 @[320px]:flex-row @[320px]:items-center">
        <svg viewBox="0 0 160 160" className="h-28 w-28 shrink-0 @[380px]:h-32 @[380px]:w-32">
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
          <text x={CX} y={CY - 4} textAnchor="middle" className="fill-foreground" style={{ font: "600 20px sans-serif" }}>
            {total.toLocaleString()}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" className="fill-muted-foreground" style={{ font: "10px sans-serif" }}>
            총 Docs
          </text>
        </svg>
        <div className="flex w-full min-w-0 flex-1 flex-col gap-1 text-xs">
          {segs.map((s) => {
            const pct = total > 0 ? (s.v / total) * 100 : 0;
            return (
              <div key={s.key} className="flex min-w-0 items-center justify-between gap-2 rounded px-1 py-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                  <Badge variant="outline" className="truncate px-2 py-0 font-medium">
                    {s.label}
                  </Badge>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {s.v.toLocaleString()}
                  {total > 0 && <span className="ml-1 text-[10px]">({pct.toFixed(0)}%)</span>}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}