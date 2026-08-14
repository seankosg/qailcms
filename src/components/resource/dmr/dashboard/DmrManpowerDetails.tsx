import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { buildManpowerMatrix } from '@/lib/dmr/dashboard-model';
import type { DmrManpowerRow } from '@/lib/dmr/productivity';
import { fmtDate } from './ui';

type Kind = 'team' | 'contractor' | 'system';

export function DmrManpowerDetails({
  dmrRows,
  directNames,
}: {
  dmrRows: DmrManpowerRow[];
  directNames: Set<string>;
}) {
  const [kind, setKind] = useState<Kind>('contractor');
  const [metric, setMetric] = useState<'actual' | 'plan' | 'diff'>('actual');
  const m = useMemo(() => buildManpowerMatrix(dmrRows, kind), [dmrRows, kind]);

  const pick = (v: { plan: number; actual: number }) =>
    metric === 'actual' ? v.actual : metric === 'plan' ? v.plan : v.actual - v.plan;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Manpower 상세 분석</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
              <TabsList className="h-7">
                <TabsTrigger value="actual" className="px-3 text-xs">실적</TabsTrigger>
                <TabsTrigger value="plan" className="px-3 text-xs">계획</TabsTrigger>
                <TabsTrigger value="diff" className="px-3 text-xs">Δ</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <TabsList className="h-7">
                <TabsTrigger value="contractor" className="px-3 text-xs">Subcon</TabsTrigger>
                <TabsTrigger value="system" className="px-3 text-xs">System</TabsTrigger>
                <TabsTrigger value="team" className="px-3 text-xs">Team</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          선택된 코드에 붙은 인원만 셉니다 · 합계 실적 {m.total.actual.toLocaleString()} · 계획 {m.total.plan.toLocaleString()}
        </div>
      </CardHeader>
      <CardContent>
        <div className="max-h-[420px] overflow-auto rounded-md border">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[180px] bg-muted px-2 py-1 text-left">
                  {kind === 'contractor' ? 'Sub Contractor' : kind === 'system' ? 'System' : 'Team'}
                </th>
                <th className="sticky left-[180px] top-0 z-30 min-w-[180px] bg-muted px-2 py-1 text-left">
                  {kind === 'contractor' ? 'System' : 'Sub Contractor'}
                </th>
                {m.dates.map((d) => (
                  <th key={d} className="sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-1 text-right">
                    {fmtDate(d)}
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-muted px-2 py-1 text-right">합계</th>
              </tr>
            </thead>
            <tbody>
              {m.keys.map((k) => (
                <tr key={k.key} className="border-t hover:bg-muted/30">
                  <td className="sticky left-0 z-10 min-w-[180px] bg-background px-2 py-1 font-medium">
                    {k.label}
                    {directNames.has(k.label) && (
                      <span className="ml-1 rounded bg-secondary px-1 text-[9px]">직영</span>
                    )}
                  </td>
                  <td className="sticky left-[180px] z-10 min-w-[180px] bg-background px-2 py-1 text-muted-foreground" title={k.sub}>
                    <span className="line-clamp-1">{k.sub || '—'}</span>
                  </td>
                  {m.dates.map((d) => {
                    const v = pick(m.cell(k.key, d));
                    return (
                      <td key={d} className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                        {v || ''}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{pick(m.rowTotal(k.key))}</td>
                </tr>
              ))}
              {m.keys.length === 0 && (
                <tr>
                  <td colSpan={m.dates.length + 3} className="p-4 text-center text-muted-foreground">
                    데이터가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/40 font-medium">
                <td className="sticky left-0 z-10 bg-muted/40 px-2 py-1" colSpan={2}>일자 합계</td>
                {m.dates.map((d) => (
                  <td key={d} className="px-2 py-1 text-right tabular-nums">{pick(m.colTotal(d))}</td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums">{pick(m.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-2">
          <Badge variant="outline" className="text-[10px]">
            {m.keys.length.toLocaleString()} rows · {m.dates.length.toLocaleString()} days
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
