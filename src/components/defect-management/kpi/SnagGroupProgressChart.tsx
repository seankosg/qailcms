// SM KPI Analysis 전용 그룹 진척 막대 차트.
// 모양은 TM 의 OwnerProgressChart 를 복제하되, 수치 정본은 getSnagProgressTotals 다.
// (TM 컴포넌트/유틸은 import 하지 않는다.)
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  GROUP_LABELS,
  STAGE_LABELS,
  type GroupBy,
  type Stage,
} from "@/lib/defect-management/progress-utils";
import type { SnagCurveUnit } from "./SnagKpiPlanVsActualCard";

const COLOR_PLAN = "color-mix(in oklab, var(--muted-foreground) 35%, transparent)";
const COLOR_ACTUAL = "var(--primary)";
const COLOR_BEHIND = "var(--destructive)";
const COLOR_AHEAD = "var(--success)";

export const SNAG_GROUP_DIMS: GroupBy[] = [
  "team",
  "hdec_pic_name",
  "hdec_eng_name",
  "subcontractor_name",
];

export interface SnagTotalsRow {
  group_key: string[];
  stage: string;
  total: number;
  done_upto: number;
  plan_upto: number;
  actual_upto: number;
  no_plan: number;
}

export interface GroupProgressRow {
  key: string;
  total: number;
  planCnt: number;
  actualCnt: number;
  planPct: number;
  actualPct: number;
  /** 표시 단위 기준 값 */
  plan: number;
  actual: number;
  diff: number;
}

interface Props {
  totals: SnagTotalsRow[];
  stage: Stage;
  dim: GroupBy;
  unit: SnagCurveUnit;
  onDimChange: (d: GroupBy) => void;
  onGroupClick?: (dim: GroupBy, key: string, row: GroupProgressRow) => void;
  limit?: number;
  asOfDate: string;
}

export function SnagGroupProgressChart({
  totals,
  stage,
  dim,
  unit,
  onDimChange,
  onGroupClick,
  limit = 15,
  asOfDate,
}: Props) {
  const isPct = unit === "pct";

  const rows = useMemo<GroupProgressRow[]>(() => {
    const map = new Map<string, { total: number; plan: number; actual: number }>();
    for (const t of totals) {
      if (t.stage !== stage) continue;
      const key = (t.group_key ?? []).join(" · ") || "(미지정)";
      const cur = map.get(key) ?? { total: 0, plan: 0, actual: 0 };
      cur.total += t.total;
      cur.plan += t.plan_upto;
      cur.actual += t.actual_upto;
      map.set(key, cur);
    }
    const out: GroupProgressRow[] = [];
    for (const [key, v] of map) {
      const planPct = v.total > 0 ? (v.plan / v.total) * 100 : 0;
      const actualPct = v.total > 0 ? (v.actual / v.total) * 100 : 0;
      const plan = isPct ? planPct : v.plan;
      const actual = isPct ? actualPct : v.actual;
      out.push({
        key,
        total: v.total,
        planCnt: v.plan,
        actualCnt: v.actual,
        planPct,
        actualPct,
        plan,
        actual,
        diff: actual - plan,
      });
    }
    // 실적이 계획에 가장 못 미치는 순
    return out.sort((a, b) => a.diff - b.diff || a.key.localeCompare(b.key, "ko"));
  }, [totals, stage, isPct]);

  const data = useMemo(() => rows.slice(0, limit), [rows, limit]);

  const summary = useMemo(() => {
    let total = 0;
    let plan = 0;
    let actual = 0;
    for (const r of rows) {
      total += r.total;
      plan += r.planCnt;
      actual += r.actualCnt;
    }
    return {
      total,
      plan,
      actual,
      planPct: total ? (plan / total) * 100 : 0,
      actualPct: total ? (actual / total) * 100 : 0,
    };
  }, [rows]);

  const needsScroll = data.length > 10;
  const chartWidth = needsScroll ? data.length * 72 : undefined;
  const fmt = (v: number) => (isPct ? `${v.toFixed(0)}%` : v.toLocaleString());

  const renderPlanLabel = (props: any) => {
    const { x, y, width, value } = props;
    if (typeof value !== "number") return null;
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        textAnchor="middle"
        fontSize={10}
        fill="var(--muted-foreground)"
      >
        {fmt(value)}
      </text>
    );
  };

  const renderActualLabel = (props: any) => {
    const { x, y, width, value, index } = props;
    const r = data[index];
    if (!r || typeof value !== "number") return null;
    const gapColor = r.diff >= 0 ? COLOR_AHEAD : COLOR_BEHIND;
    return (
      <g>
        <text x={x + width / 2} y={y - 33} textAnchor="middle" fontSize={9} fontWeight={700}>
          <tspan fill="var(--muted-foreground)">{r.total.toLocaleString()}건</tspan>
        </text>
        <text
          x={x + width / 2}
          y={y - 19}
          textAnchor="middle"
          fontSize={10}
          fontWeight={600}
          fill={gapColor}
        >
          {r.diff >= 0 ? "+" : ""}
          {isPct ? `${r.diff.toFixed(1)}pp` : r.diff.toLocaleString()}
        </text>
        <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fill="var(--foreground)">
          {fmt(value)}
        </text>
      </g>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Group Progress</CardTitle>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
              {STAGE_LABELS[stage]}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Planned vs Actual — 막대 클릭 시 드릴다운 · as of {asOfDate}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
              전체 {summary.total.toLocaleString()}건
            </Badge>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
              {isPct
                ? `실적 ${summary.actualPct.toFixed(1)}% / 계획 ${summary.planPct.toFixed(1)}%`
                : `실적 ${summary.actual.toLocaleString()}건 / 계획 ${summary.plan.toLocaleString()}건`}
            </Badge>
            <span
              className={
                summary.actual - summary.plan >= 0
                  ? "text-[10px] font-semibold tabular-nums text-[var(--success)]"
                  : "text-[10px] font-semibold tabular-nums text-destructive"
              }
            >
              {summary.actual - summary.plan >= 0 ? "+" : ""}
              {isPct
                ? `${(summary.actualPct - summary.planPct).toFixed(1)}pp`
                : `${(summary.actual - summary.plan).toLocaleString()}건`}
            </span>
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={dim}
          onValueChange={(v) => {
            if (v) onDimChange(v as GroupBy);
          }}
          className="flex-wrap gap-1"
        >
          {SNAG_GROUP_DIMS.map((d) => (
            <ToggleGroupItem
              key={d}
              value={d}
              className="h-8 px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {GROUP_LABELS[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardHeader>
      <CardContent className="pt-1">
        {data.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <div className={needsScroll ? "overflow-x-auto" : ""}>
            <div
              className="h-[360px]"
              style={chartWidth ? { width: chartWidth, minWidth: "100%" } : { width: "100%" }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  barGap={2}
                  barCategoryGap="20%"
                  margin={{ top: 46, right: 8, left: -16, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="key"
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={64}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    domain={isPct ? [0, 100] : [0, "auto"]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v) => (isPct ? `${v}%` : `${v}`)}
                    width={44}
                  />
                  <Tooltip
                    cursor={{
                      fill: "color-mix(in oklab, var(--muted) 60%, transparent)",
                      radius: 4,
                    }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as GroupProgressRow;
                      return (
                        <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-semibold text-popover-foreground">{r.key}</div>
                          <div className="tabular-nums text-muted-foreground">
                            Plan {fmt(r.plan)} / Actual {fmt(r.actual)}
                          </div>
                          <div
                            className={
                              r.diff < 0
                                ? "tabular-nums text-destructive"
                                : "tabular-nums text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            Gap {r.diff >= 0 ? "+" : ""}
                            {isPct ? `${r.diff.toFixed(1)}pp` : r.diff.toLocaleString()}
                          </div>
                          <div className="tabular-nums text-muted-foreground">
                            대상 {r.total.toLocaleString()}건
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="plan"
                    name="Plan"
                    fill={COLOR_PLAN}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                    onClick={(d: any) =>
                      onGroupClick?.(dim, d?.payload?.key, d?.payload as GroupProgressRow)
                    }
                    className="cursor-pointer"
                  >
                    <LabelList dataKey="plan" content={renderPlanLabel} />
                  </Bar>
                  <Bar
                    dataKey="actual"
                    name="Actual"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                    onClick={(d: any) =>
                      onGroupClick?.(dim, d?.payload?.key, d?.payload as GroupProgressRow)
                    }
                    className="cursor-pointer"
                  >
                    {data.map((r) => (
                      <Cell key={r.key} fill={r.diff < 0 ? COLOR_BEHIND : COLOR_ACTUAL} />
                    ))}
                    <LabelList dataKey="actual" content={renderActualLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_PLAN }} />{" "}
            Plan
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> Actual
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /> Actual (계획 미달)
          </span>
          <span>n건 = 스테이지 대상 문서 수</span>
        </div>
      </CardContent>
    </Card>
  );
}