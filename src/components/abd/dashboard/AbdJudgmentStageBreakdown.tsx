import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAbdDashboardJudgmentMix } from "@/lib/abd/dashboard.functions";

const JUDGMENT_KEY_ORDER = ["완료", "정상", "주의", "지연", "악화"] as const;
const STAGE_ORDER: Array<"NS" | "DS" | "UR" | "Approved"> = ["NS", "DS", "UR", "Approved"];
const STAGE_LABEL: Record<string, string> = {
  NS: "NS (Not Started)",
  DS: "DS (Draft)",
  // 'UR' 은 내부 stage 키(의미 = 회신 대기(RS)). 화면 라벨만 정정.
  UR: "RS (Awaiting Response)",
  Approved: "Approved",
};
const COLOR: Record<string, string> = {
  완료: "var(--schedule-actual)",
  정상: "var(--schedule-plan)",
  주의: "var(--warning)",
  지연: "var(--schedule-over)",
  악화: "var(--schedule-short)",
};

export function AbdJudgmentStageBreakdown({ batchNo, plots = [] }: { batchNo: string[]; plots?: string[] }) {
  const fn = useServerFn(getAbdDashboardJudgmentMix);
  const q = useQuery({
    queryKey: ["abd-dash-judgment-mix", plots.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { batch_no: batchNo, plots } }),
    staleTime: 60_000,
  });
  const byStage = new Map((q.data ?? []).map((r) => [r.stage, r] as const));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">스테이지별 판정 스택</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-2">
        {STAGE_ORDER.map((stage) => {
          const r = byStage.get(stage);
          const counts: Record<string, number> = {
            완료: Number(r?.approved ?? 0),
            정상: Number(r?.normal ?? 0),
            주의: Number(r?.caution ?? 0),
            지연: Number(r?.delayed ?? 0),
            악화: Number(r?.critical ?? 0),
          };
          const total = Number(r?.total ?? 0);
          return (
            <div key={stage} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">{STAGE_LABEL[stage]}</span>
                <span className="tabular-nums text-muted-foreground">{total}</span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
                {JUDGMENT_KEY_ORDER.map((k) => {
                  const v = counts[k] ?? 0;
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={k}
                      title={`${k}: ${v} (${pct.toFixed(1)}%)`}
                      style={{ width: `${pct}%`, background: COLOR[k] }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {JUDGMENT_KEY_ORDER.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 tabular-nums">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR[k] }} />
                    {k} {counts[k] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}