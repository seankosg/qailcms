import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { fmtExtra, fmtPct, fmtProd, type ProductivityRow } from '@/lib/dmr/productivity';
import type { DmrDashboardModel } from '@/lib/dmr/dashboard-model';

function sortByProductivity(rows: ProductivityRow[]) {
  return [...rows].sort((a, b) => {
    const av = a.productivity;
    const bv = b.productivity;
    if (av == null && bv == null) return a.task_no.localeCompare(b.task_no);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
}

export function DmrDetailTables({
  model,
  onSelectCode,
}: {
  model: DmrDashboardModel;
  onSelectCode: (r: ProductivityRow) => void;
}) {
  const [tab, setTab] = useState<'code' | 'team' | 'contractor'>('code');
  const rows = useMemo(() => sortByProductivity(model.rows), [model.rows]);
  const s = model.summary;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">생산성 상세 분석</CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {rows.length.toLocaleString()} / {model.populationCodes.toLocaleString()} codes
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="h-7">
            <TabsTrigger value="code" className="px-3 text-xs">TM Code</TabsTrigger>
            <TabsTrigger value="team" className="px-3 text-xs">공종</TabsTrigger>
            <TabsTrigger value="contractor" className="px-3 text-xs">업체</TabsTrigger>
          </TabsList>

          <TabsContent value="code" className="mt-2">
            <div className="max-h-[460px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">TM Code</TableHead>
                    <TableHead className="text-xs">Task</TableHead>
                    <TableHead className="text-xs">Work Type</TableHead>
                    <TableHead className="text-xs">공종</TableHead>
                    <TableHead className="text-xs">Plot</TableHead>
                    <TableHead className="text-right text-xs">인원</TableHead>
                    <TableHead className="text-right text-xs">기록일</TableHead>
                    <TableHead className="text-right text-xs">계획%</TableHead>
                    <TableHead className="text-right text-xs">실적%</TableHead>
                    <TableHead className="text-right text-xs">생산성</TableHead>
                    <TableHead className="text-right text-xs">달성률</TableHead>
                    <TableHead className="text-right text-xs">추가 인원</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.task_no}
                      onClick={() => onSelectCode(r)}
                      className={cn('cursor-pointer', r.kind === '다' && 'bg-destructive/5')}
                    >
                      <TableCell className="font-mono text-xs">{r.task_no}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs" title={r.task_name}>{r.task_name}</TableCell>
                      <TableCell className="text-xs">{r.work_type}</TableCell>
                      <TableCell className="text-xs">{r.team}</TableCell>
                      <TableCell className="text-xs">{r.plot}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.manpower.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.record_days} / {s.calendarDays}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtPct(r.plan_pct)}</TableCell>
                      <TableCell className={cn('text-right text-xs tabular-nums', (r.actual_pct ?? 0) < 0 && 'text-destructive')}>
                        {fmtPct(r.actual_pct)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.productivity == null ? (
                          <Badge variant="outline" className="text-[10px]">{r.kind === '다' ? '산출 불가' : '—'}</Badge>
                        ) : (
                          fmtProd(r.productivity)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.achievement == null ? (
                          <Badge variant="outline" className="text-[10px]">계획 없음</Badge>
                        ) : (
                          <span className={r.achievement >= 1 ? 'text-emerald-600' : 'text-destructive'}>
                            {(r.achievement * 100).toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {r.plan_pct == null || r.plan_pct <= 0 ? (
                          <Badge variant="outline" className="text-[10px]">해당 없음</Badge>
                        ) : r.extra_manpower === 0 ? (
                          <span className="text-emerald-600">증원 불필요</span>
                        ) : (
                          <span className="text-destructive">{fmtExtra(r.extra_manpower_per_day)}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="p-6 text-center text-xs text-muted-foreground">
                        표시할 코드가 없습니다
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="team" className="mt-2">
            <div className="max-h-[460px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">공종</TableHead>
                    <TableHead className="text-right text-xs">코드 수</TableHead>
                    <TableHead className="text-right text-xs">인원</TableHead>
                    <TableHead className="text-right text-xs">Σ계획%</TableHead>
                    <TableHead className="text-right text-xs">Σ실적%</TableHead>
                    <TableHead className="text-right text-xs">생산성</TableHead>
                    <TableHead className="text-right text-xs">달성률</TableHead>
                    <TableHead className="text-right text-xs">추가 인원(인·일)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.teamRows.map((t) => (
                    <TableRow key={t.team}>
                      <TableCell className="text-xs font-medium">{t.team}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.codes.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{t.manpower.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtPct(t.planSum)}</TableCell>
                      <TableCell className={cn('text-right text-xs tabular-nums', t.actualSum < 0 && 'text-destructive')}>
                        {fmtPct(t.actualSum)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtProd(t.productivity) || '—'}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {t.achievement == null ? (
                          <Badge variant="outline" className="text-[10px]">계획 없음</Badge>
                        ) : (
                          <span className={t.achievement >= 1 ? 'text-emerald-600' : 'text-destructive'}>
                            {(t.achievement * 100).toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {t.extraManpower > 0 ? fmtExtra(t.extraManpower, '') : '0'}
                        {t.crossTeamCodes.length > 0 && (
                          <Badge variant="secondary" className="ml-1 text-[10px]" title={t.crossTeamCodes.join(', ')}>
                            두 공종 코드 {t.crossTeamCodes.length}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {model.teamRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="p-6 text-center text-xs text-muted-foreground">표시할 공종이 없습니다</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="contractor" className="mt-2 space-y-2">
            <div className="text-[11px] text-muted-foreground">
              단독 코드 {model.contractor.soloCodes.toLocaleString()}건 · 공동 코드 {model.contractor.sharedCodes.toLocaleString()}건 · 소계 실적은 단독 코드만 더한다
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">업체</TableHead>
                    <TableHead className="text-xs">TM Code</TableHead>
                    <TableHead className="text-xs">Task</TableHead>
                    <TableHead className="text-right text-xs">인원(그 업체)</TableHead>
                    <TableHead className="text-right text-xs">실적%</TableHead>
                    <TableHead className="text-right text-xs">생산성</TableHead>
                    <TableHead className="text-xs">비고</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.contractor.rows.map((r) => (
                    <TableRow key={`${r.contractor}@@${r.task_no}`}>
                      <TableCell className="text-xs font-medium">{r.contractor}</TableCell>
                      <TableCell className="font-mono text-xs">{r.task_no}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs" title={r.task_name}>{r.task_name}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{r.manpower.toLocaleString()}</TableCell>
                      <TableCell className={cn('text-right text-xs tabular-nums', (r.actual_pct ?? 0) < 0 && 'text-destructive')}>
                        {fmtPct(r.actual_pct)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtProd(r.productivity) || '—'}</TableCell>
                      <TableCell className="text-xs">
                        {r.shared ? (
                          <Badge variant="secondary" className="text-[10px]">
                            공동 {r.sharedCount}사 · 코드 전체 인원 {r.codeManpower.toLocaleString()} 기준
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">단독</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {model.contractor.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="p-6 text-center text-xs text-muted-foreground">표시할 업체가 없습니다</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="max-h-[260px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">업체 소계 (단독 코드 기준)</TableHead>
                    <TableHead className="text-right text-xs">단독 인원</TableHead>
                    <TableHead className="text-right text-xs">Σ실적%</TableHead>
                    <TableHead className="text-right text-xs">생산성</TableHead>
                    <TableHead className="text-xs">공동 포함 인원</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.contractorSubtotals.map((x) => (
                    <TableRow key={x.contractor}>
                      <TableCell className="text-xs font-medium">{x.contractor}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{x.soloManpower.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtPct(x.actualSum)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{fmtProd(x.productivity) || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(x.soloManpower + x.sharedManpower).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
