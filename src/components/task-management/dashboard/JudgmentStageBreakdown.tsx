import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JudgmentDonut } from "./JudgmentDonut";
import {
  computeJudgmentStageBreakdown,
  JUDGMENT_KEY_ORDER,
} from "@/lib/task-management/delay-utils";
import { TASK_STAGE_LABELS, type TaskItem } from "@/lib/task-management/schedule-utils";

interface Props {
  items: TaskItem[];
  asOfDate: string;
}

const COLOR: Record<string, string> = {
  완료: "var(--schedule-actual)",
  정상: "var(--schedule-plan)",
  주의: "var(--warning)",
  지연: "var(--schedule-over)",
  위험: "var(--schedule-short)",
};

export function JudgmentStageBreakdown({ items, asOfDate }: Props) {
  const breakdown = useMemo(
    () => computeJudgmentStageBreakdown(items, asOfDate),
    [items, asOfDate],
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JudgmentDonut counts={breakdown.judgmentCounts} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">스테이지별 판정 스택</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {breakdown.stageJudgment.map(({ stage, counts, total }) => (
            <div key={stage} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">{TASK_STAGE_LABELS[stage]}</span>
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
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: COLOR[k] }}
                    />
                    {k} {counts[k] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}