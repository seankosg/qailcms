import { Card, CardContent } from "@/components/ui/card";

export interface BreakdownRow {
  key: string;
  /** 항목 건수 */
  count: number;
  /** 진도율 0~100 (null = 산출 불가) */
  pct: number | null;
}

/** Top 4 + Others 5행으로 접는다(가중 평균 유지). */
export function foldTop4(
  rows: Array<{ key: string; count: number; actual: number }>,
): BreakdownRow[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4);
  const out: BreakdownRow[] = top.map((r) => ({
    key: r.key,
    count: r.count,
    pct: r.count > 0 ? (r.actual / r.count) * 100 : null,
  }));
  if (rest.length > 0) {
    const count = rest.reduce((s, r) => s + r.count, 0);
    const actual = rest.reduce((s, r) => s + r.actual, 0);
    out.push({ key: "Others", count, pct: count > 0 ? (actual / count) * 100 : null });
  }
  return out;
}

/** PDB 우측 카드 — 축(Work Type / Team)별 Top4 + Others 진도 5행. */
export function PdbBreakdownCard({
  label,
  rows,
  hint,
  emptyText = "데이터 없음",
}: {
  label: string;
  rows: BreakdownRow[];
  hint?: string;
  emptyText?: string;
}) {
  return (
    <Card title={hint}>
      <CardContent className="p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1.5 flex flex-col gap-1">
          {rows.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">{emptyText}</div>
          ) : (
            rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-[11px] font-medium" title={r.key}>
                  {r.key}
                </div>
                <div className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {r.count.toLocaleString()}
                </div>
                <div className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums">
                  {r.pct == null ? "—" : `${r.pct.toFixed(1)}%`}
                </div>
                <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:w-20">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, r.pct ?? 0))}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
