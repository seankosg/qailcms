import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JudgmentDonut } from "./JudgmentDonut";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  classifyStart,
  classifyFinish,
  classifyAlarm,
  STATE_LABEL,
  ALARM_LABEL,
  type StageState,
  type AlarmState,
} from "@/components/task-management/raw-data/TaskStageProgress";

interface Props {
  items: TaskItem[];
  asOfDate: string;
}

// Raw Data 3-스테이지(Start / Alarm / Finish) 판정 색상 (TaskStageProgress 와 동일 팔레트)
const START_STATE_ORDER: StageState[] = ["completed", "delay", "plan", "empty"];
const FINISH_STATE_ORDER: StageState[] = [
  "completed",
  "completed_late",
  "wip",
  "delay",
  "plan",
  "empty",
];
const ALARM_STATE_ORDER: AlarmState[] = ["done", "ok", "caution", "late", "risk", "empty"];

const STATE_COLOR: Record<StageState, string> = {
  completed: "hsl(160 84% 39%)", // emerald-600
  completed_late: "hsl(160 84% 39%)",
  wip: "hsl(43 96% 56%)", // amber-400
  delay: "hsl(var(--destructive))",
  plan: "hsl(var(--muted-foreground) / 0.4)",
  empty: "hsl(var(--muted-foreground) / 0.2)",
};

const ALARM_COLOR: Record<AlarmState, string> = {
  done: "hsl(160 84% 39%)",
  ok: "hsl(199 89% 48%)", // sky-500
  caution: "hsl(43 96% 56%)",
  late: "hsl(21 90% 48%)", // orange-600
  risk: "hsl(347 77% 50%)", // rose-600
  empty: "hsl(var(--muted-foreground) / 0.2)",
};

// donut 은 auto_judgment 기준 유지 (Alarm 스테이지와 동일 소스)
const JUDGMENT_KEYS = ["완료", "정상", "주의", "지연", "위험"] as const;

function usePatternHatched() {
  // completed_late 는 completed 와 색이 같아서 시각적 구분을 위해 라벨 텍스트로 구분한다.
}

export function JudgmentStageBreakdown({ items, asOfDate }: Props) {
  const { judgmentCounts, startCounts, alarmCounts, finishCounts, total } = useMemo(() => {
    const dd = asOfDate || null;
    const judgmentCounts: Record<string, number> = { 완료: 0, 정상: 0, 주의: 0, 지연: 0, 위험: 0 };
    const startCounts: Record<StageState, number> = {
      completed: 0, completed_late: 0, wip: 0, delay: 0, plan: 0, empty: 0,
    };
    const alarmCounts: Record<AlarmState, number> = {
      done: 0, ok: 0, caution: 0, late: 0, risk: 0, empty: 0,
    };
    const finishCounts: Record<StageState, number> = {
      completed: 0, completed_late: 0, wip: 0, delay: 0, plan: 0, empty: 0,
    };
    for (const it of items) {
      const j = String((it as any).auto_judgment ?? "").trim();
      if (j in judgmentCounts) judgmentCounts[j]++;
      startCounts[classifyStart(it as any, dd)]++;
      alarmCounts[classifyAlarm(it as any)]++;
      finishCounts[classifyFinish(it as any, dd)]++;
    }
    return { judgmentCounts, startCounts, alarmCounts, finishCounts, total: items.length };
  }, [items, asOfDate]);

  const stages: Array<{
    key: string;
    label: string;
    order: readonly string[];
    counts: Record<string, number>;
    color: Record<string, string>;
    labelOf: Record<string, string>;
  }> = [
    {
      key: "start",
      label: "Start",
      order: START_STATE_ORDER,
      counts: startCounts,
      color: STATE_COLOR,
      labelOf: STATE_LABEL,
    },
    {
      key: "alarm",
      label: "Alarm",
      order: ALARM_STATE_ORDER,
      counts: alarmCounts,
      color: ALARM_COLOR,
      labelOf: ALARM_LABEL,
    },
    {
      key: "finish",
      label: "Finish",
      order: FINISH_STATE_ORDER,
      counts: finishCounts,
      color: STATE_COLOR,
      labelOf: STATE_LABEL,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JudgmentDonut counts={judgmentCounts} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">스테이지별 판정 스택</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Raw Data 의 Start · Alarm · Finish 3-스테이지 상태를 그대로 집계합니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {stages.map(({ key, label, order, counts, color, labelOf }) => (
            <div key={key} className="space-y-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">{total}</span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
                {order.map((k) => {
                  const v = counts[k] ?? 0;
                  const pct = total > 0 ? (v / total) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={k}
                      title={`${labelOf[k]}: ${v} (${pct.toFixed(1)}%)`}
                      style={{ width: `${pct}%`, background: color[k] }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {order.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 tabular-nums">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: color[k] }}
                    />
                    {labelOf[k]} {counts[k] ?? 0}
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