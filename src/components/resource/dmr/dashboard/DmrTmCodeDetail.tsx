import { useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildDailyPoints,
  fmtExtra,
  fmtPct,
  fmtProd,
  type DmrDailyCodeValue,
  type DmrManpowerRow,
  type ProductivityRow,
} from '@/lib/dmr/productivity';
import { ACTUAL_COLOR, LINE_COLORS, fmtDate } from './ui';
import { cn } from '@/lib/utils';

export function DmrTmCodeDetail({
  row,
  open,
  onOpenChange,
  dates,
  byDate,
  dmrRows,
  disabledReason,
}: {
  row: ProductivityRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dates: string[];
  byDate: Map<string, Map<string, DmrDailyCodeValue>> | undefined;
  dmrRows: DmrManpowerRow[];
  disabledReason: string | null;
}) {
  // 상세창도 화면과 같은 정본 배열을 쓴다 — 전용 산식을 만들지 않는다.
  const points = useMemo(() => {
    if (!row || !byDate) return [];
    return buildDailyPoints({
      dates,
      byDate,
      dmrRows,
      codeGroups: new Map([[row.task_no, [row.task_no]]]),
    });
  }, [row, byDate, dates, dmrRows]);

  const chart = points.map((p) => ({
    date: p.date,
    manpower: p.manpower,
    actual: p.actualProductivity == null ? null : p.actualProductivity * 100,
    plan: p.plannedProductivity == null ? null : p.plannedProductivity * 100,
    actualProgress: p.actualProgress * 100,
    planProgress: p.planProgress * 100,
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        {row && (
          <>
            <SheetHeader className="space-y-1">
              <SheetTitle className="font-mono text-base">{row.task_no}</SheetTitle>
              <div className="text-xs text-muted-foreground">{row.task_name}</div>
              <div className="flex flex-wrap gap-1 pt-1">
                {row.team && <Badge variant="outline" className="text-[10px]">{row.team}</Badge>}
                {row.plot && <Badge variant="outline" className="text-[10px]">Plot {row.plot}</Badge>}
                {row.work_type && <Badge variant="outline" className="text-[10px]">{row.work_type}</Badge>}
                {row.systems.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="기간 계획%" value={fmtPct(row.plan_pct) || '—'} />
              <Stat label="기간 실적%" value={fmtPct(row.actual_pct) || '—'} bad={(row.actual_pct ?? 0) < 0} />
              <Stat label="인원 (인·일)" value={row.manpower.toLocaleString()} />
              <Stat label="생산성" value={fmtProd(row.productivity) || '—'} />
              <Stat
                label="달성률"
                value={row.achievement == null ? '—' : `${(row.achievement * 100).toFixed(1)}%`}
              />
              <Stat label="계획 인원" value={row.plan_manpower.toLocaleString()} />
              <Stat label="기록일" value={`${row.record_days}일`} />
              <Stat
                label="추가 인원"
                value={row.plan_pct == null || row.plan_pct <= 0 ? '해당 없음' : fmtExtra(row.extra_manpower_per_day) || '0'}
              />
            </div>

            {row.note && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                {row.note}
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium">일별 생산성 (막대 = 인원, 선 = 생산성)</div>
              <div className="h-[260px]">
                {disabledReason ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {disabledReason}
                  </div>
                ) : chart.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    표시할 일자 데이터가 없습니다
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={fmtDate} />
                      <YAxis yAxisId="mp" tick={{ fontSize: 10 }} width={40} />
                      <YAxis yAxisId="pr" orientation="right" tick={{ fontSize: 10 }} width={56} />
                      <Tooltip labelFormatter={fmtDate} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="mp" dataKey="manpower" name="인원" fill={LINE_COLORS[4]} barSize={14} />
                      <Line
                        yAxisId="pr"
                        type="linear"
                        dataKey="actual"
                        name="생산성(실적)"
                        stroke={ACTUAL_COLOR}
                        strokeWidth={3}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                      <Line
                        yAxisId="pr"
                        type="linear"
                        dataKey="plan"
                        name="생산성(계획)"
                        stroke={ACTUAL_COLOR}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium">일별 값</div>
              <div className="max-h-[280px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">날짜</TableHead>
                      <TableHead className="text-right text-xs">계획%</TableHead>
                      <TableHead className="text-right text-xs">실적%</TableHead>
                      <TableHead className="text-right text-xs">인원</TableHead>
                      <TableHead className="text-right text-xs">생산성</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {points.map((p) => (
                      <TableRow key={p.date}>
                        <TableCell className="text-xs tabular-nums">{p.date}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtPct(p.planProgress)}</TableCell>
                        <TableCell className={cn('text-right text-xs tabular-nums', p.actualProgress < 0 && 'text-destructive')}>
                          {fmtPct(p.actualProgress)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{p.manpower.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtProd(p.actualProductivity) || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {points.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="p-4 text-center text-xs text-muted-foreground">
                          일자 데이터가 없습니다
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-xs font-medium">업체별 인원</div>
              <div className="rounded-md border p-2 text-xs">
                {row.contractors.length === 0 ? (
                  <span className="text-muted-foreground">업체 기록이 없습니다</span>
                ) : (
                  row.contractors.map((c) => (
                    <div key={c.name} className="flex justify-between py-0.5">
                      <span>{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{c.manpower.toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', bad && 'text-destructive')}>{value}</div>
    </div>
  );
}
