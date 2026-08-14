import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DmrDailyProductivityPoint } from '@/lib/dmr/productivity';
import type { TrendGroupBy } from '@/lib/dmr/dashboard-model';
import { FilterToggleButton, LINE_COLORS, fmtDate } from './ui';
import {
  ProgressChartLegend,
  defaultMetrics,
} from '@/components/shared/charts/ProgressChartLegend';

const GROUP_OPTIONS: Array<{ value: TrendGroupBy; label: string }> = [
  { value: 'total', label: '전체' },
  { value: 'team', label: 'Team' },
  { value: 'plot', label: 'Plot' },
  { value: 'contractor', label: 'Sub Contractor' },
  { value: 'system', label: 'System' },
];

type Metric = 'productivity' | 'progress' | 'manpower';
const METRICS: Array<{ value: Metric; label: string }> = [
  { value: 'productivity', label: '생산성 (%p/인·일)' },
  { value: 'progress', label: '진도 합계 (%p)' },
  { value: 'manpower', label: '투입인원 (인·일)' },
];

const MAX_SERIES = 10;

export function DmrTrendCard({
  points,
  dates,
  groupBy,
  onGroupBy,
  loading,
  disabledReason,
}: {
  points: DmrDailyProductivityPoint[];
  dates: string[];
  groupBy: TrendGroupBy;
  onGroupBy: (g: TrendGroupBy) => void;
  loading: boolean;
  disabledReason: string | null;
}) {
  const [metric, setMetric] = useState<Metric>('productivity');

  const { data, groups, hiddenGroups } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of points) totals.set(p.group, (totals.get(p.group) ?? 0) + p.manpower);
    const ordered = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const shown = ordered.slice(0, MAX_SERIES);
    const shownSet = new Set(shown);
    const byDate = new Map<string, Record<string, number | null>>();
    for (const d of dates) byDate.set(d, { });
    for (const p of points) {
      if (!shownSet.has(p.group)) continue;
      const row = byDate.get(p.date);
      if (!row) continue;
      if (metric === 'productivity') {
        row[p.group] = p.actualProductivity == null ? null : p.actualProductivity * 100;
        row[`${p.group}__plan`] = p.plannedProductivity == null ? null : p.plannedProductivity * 100;
      } else if (metric === 'progress') {
        row[p.group] = p.actualProgress * 100;
        row[`${p.group}__plan`] = p.planProgress * 100;
      } else {
        row[p.group] = p.manpower;
      }
    }
    return {
      data: dates.map((d) => ({ date: d, ...(byDate.get(d) ?? {}) })),
      groups: shown,
      hiddenGroups: Math.max(0, ordered.length - shown.length),
    };
  }, [points, dates, metric]);

  const unit = metric === 'manpower' ? '인·일' : metric === 'progress' ? '%p' : '%p/인·일';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">생산성 추이 — 계획 생산성 vs 실제 생산성</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              실선 = 실적 · 점선 = 계획
            </Badge>
            {hiddenGroups > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                상위 {MAX_SERIES}개만 표시 · {hiddenGroups}개 생략
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {METRICS.map((m) => (
              <FilterToggleButton
                key={m.value}
                active={metric === m.value}
                className="h-7 px-2 text-[11px]"
                onClick={() => setMetric(m.value)}
              >
                {m.label}
              </FilterToggleButton>
            ))}
            <span className="mx-1 w-px bg-border" />
            {GROUP_OPTIONS.map((o) => (
              <FilterToggleButton
                key={o.value}
                active={groupBy === o.value}
                className="h-7 px-2 text-[11px]"
                onClick={() => onGroupBy(o.value)}
              >
                {o.label}
              </FilterToggleButton>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!disabledReason && !loading && groups.length > 0 && (
          <ProgressChartLegend
            className="mb-2"
            mode="line-plan-actual"
            lang="ko"
            metrics={defaultMetrics("line-plan-actual", "ko")}
            series={groups.map((g, i) => ({
              key: g,
              label: g,
              color: LINE_COLORS[i % LINE_COLORS.length],
            }))}
            axes={{ left: `${METRICS.find((m) => m.value === metric)?.label ?? ""} (${unit || "-"})` }}
          />
        )}
        <div className="h-[320px]">
          {disabledReason ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {disabledReason}
            </div>
          ) : loading ? (
            <Skeleton className="h-full w-full" />
          ) : groups.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              표시할 데이터가 없습니다
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={78}
                  tickFormatter={(v) => `${Number(v).toFixed(metric === 'manpower' ? 0 : 2)}${unit}`}
                />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v: any, n: any) => [
                    v == null ? '—' : `${Number(v).toFixed(metric === 'manpower' ? 0 : 3)}${unit}`,
                    String(n).replace('__plan', ' (Plan)'),
                  ]}
                />
                {groups.flatMap((g, i) => {
                  const color = LINE_COLORS[i % LINE_COLORS.length];
                  const out = [
                    <Line
                      key={`${g}-actual`}
                      type="linear"
                      dataKey={g}
                      name={g}
                      stroke={color}
                      strokeWidth={3}
                      dot={{ r: 2 }}
                      connectNulls
                    />,
                  ];
                  if (metric !== 'manpower') {
                    out.push(
                      <Line
                        key={`${g}-plan`}
                        type="linear"
                        dataKey={`${g}__plan`}
                        name={`${g} (Plan)`}
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls
                      />,
                    );
                  }
                  return out;
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
