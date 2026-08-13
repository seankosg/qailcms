import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { yesterdayInDoha } from '@/lib/time/doha';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown } from 'lucide-react';
import {
  PERIOD_LABEL,
  aggregateByContractor,
  aggregateByTeam,
  contractorSubtotals,
  fmtExtra,
  fmtPct,
  fmtProd,
  resolvePeriod,
  summarize,
  useProductivity,
  useTmHistoryStart,
  type PeriodKind,
  type ProductivityRow,
} from '@/lib/dmr/productivity';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';
import { DMR_DISCIPLINES, DISCIPLINE_LABEL, type DmrDiscipline } from '@/lib/dmr/types';
import { cn } from '@/lib/utils';

function subDays(iso: string, n: number) {
  // A-3: ISO(UTC 자정) 기준 Date 에는 반드시 UTC 메서드를 쓴다.
  // 로컬 메서드 혼용 시 음수 오프셋 브라우저에서 하루가 밀린다.
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  // 20-Jul
  if (!iso || iso.length < 10) return iso;
  const [, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d}-${months[Number(m) - 1] ?? m}`;
}

function niceMax(n: number) {
  if (n <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const rel = n / pow;
  const nice = rel <= 1 ? 1 : rel <= 2 ? 2 : rel <= 5 ? 5 : 10;
  return nice * pow;
}

const LINE_COLORS = [
  '#2563eb', '#ef4444', '#f59e0b', '#10b981', '#06b6d4',
  '#8b5cf6', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

type GroupBy = 'team' | 'plot' | 'sub' | 'wd';
const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'team', label: 'Team' },
  { value: 'plot', label: 'Plot' },
  { value: 'sub', label: 'Sub Contractor' },
  { value: 'wd', label: 'Work Description' },
];

export function DmrDashboardPage() {
  const [teams, setTeams] = useState<DmrDiscipline[]>([]);
  const [plots, setPlots] = useState<Array<'C' | 'D'>>([]);
  const [workDescriptions, setWorkDescriptions] = useState<string[]>([]);
  const [subContractors, setSubContractors] = useState<string[]>([]);
  const [contractorType, setContractorType] = useState<'all' | 'direct' | 'sub'>('all');
  const [asOf, setAsOf] = useState<string>('');
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(14);
  const [groupBy, setGroupBy] = useState<GroupBy>('team');
  const [recordTab, setRecordTab] = useState<'subcon' | 'system'>('system');

  // Latest date
  const latestQuery = useQuery({
    queryKey: ['dmr_latest_date'],
    queryFn: async () => {
      const { data } = await supabase.from('dmr_entries').select('report_date').order('report_date', { ascending: false }).limit(1);
      return data?.[0]?.report_date as string | undefined;
    },
  });
  const currentAsOf = asOf || latestQuery.data || '';

  // Contractor master (for direct filter)
  const contractorMaster = useQuery({
    queryKey: ['dmr_contractor_master_lite'],
    queryFn: async () => {
      const { data } = await supabase.from('dmr_contractor_master').select('name, is_direct');
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const directNames = useMemo(() => new Set((contractorMaster.data ?? []).filter((c) => c.is_direct).map((c) => c.name)), [contractorMaster.data]);

  // Load window of data
  const fromDate = currentAsOf ? subDays(currentAsOf, rangeDays - 1) : '';
  const entriesQuery = useQuery({
    enabled: !!currentAsOf,
    queryKey: ['dmr_entries_window_raw', currentAsOf, rangeDays],
    queryFn: async () => {
      const pageSize = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase.from('dmr_entries')
          .select('report_date, discipline, contractor_name, system_name, plot, plan_manpower, actual_manpower')
          .gte('report_date', fromDate).lte('report_date', currentAsOf)
          .in('plot', ['C', 'D'])
          .order('report_date', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = data ?? [];
        all.push(...chunk);
        if (chunk.length < pageSize) break;
      }
      return all;
    },
  });

  const src = entriesQuery.data ?? [];

  // Scope-dependent options — Team/Plot narrow both dropdowns; each dropdown
  // is independent from the other's selection so users can freely combine.
  const teamPlotScoped = useMemo(() => {
    const teamSet = new Set(teams);
    const plotSet = new Set(plots);
    return src.filter((r) => {
      if (teamSet.size > 0 && !teamSet.has(r.discipline as DmrDiscipline)) return false;
      if (plotSet.size > 0 && !plotSet.has(r.plot as 'C' | 'D')) return false;
      if (contractorType === 'direct' && !directNames.has(r.contractor_name)) return false;
      if (contractorType === 'sub' && directNames.has(r.contractor_name)) return false;
      return true;
    });
  }, [src, teams, plots, contractorType, directNames]);

  const workDescOptions = useMemo(
    () => Array.from(new Set(teamPlotScoped.map((r) => r.system_name).filter(Boolean) as string[])).sort(),
    [teamPlotScoped],
  );
  const subContractorOptions = useMemo(
    () => Array.from(new Set(teamPlotScoped.map((r) => r.contractor_name).filter(Boolean) as string[])).sort(),
    [teamPlotScoped],
  );

  // Prune selections that fall out of scope when upstream filters change.
  useEffect(() => {
    setWorkDescriptions((prev) => prev.filter((v) => workDescOptions.includes(v)));
  }, [workDescOptions]);
  useEffect(() => {
    setSubContractors((prev) => prev.filter((v) => subContractorOptions.includes(v)));
  }, [subContractorOptions]);

  const rows = useMemo(() => {
    const teamSet = new Set(teams);
    const plotSet = new Set(plots);
    const wdSet = new Set(workDescriptions);
    const scSet = new Set(subContractors);
    return src.filter((r) => {
      if (teamSet.size > 0 && !teamSet.has(r.discipline as DmrDiscipline)) return false;
      if (plotSet.size > 0 && !plotSet.has(r.plot as 'C' | 'D')) return false;
      if (wdSet.size > 0 && !wdSet.has(r.system_name ?? '')) return false;
      if (scSet.size > 0 && !scSet.has(r.contractor_name ?? '')) return false;
      if (contractorType === 'direct' && !directNames.has(r.contractor_name)) return false;
      if (contractorType === 'sub' && directNames.has(r.contractor_name)) return false;
      return true;
    });
  }, [src, teams, plots, workDescriptions, subContractors, contractorType, directNames]);

  // Aggregations
  const kpi = useMemo(() => {
    const same = rows.filter((r) => r.report_date === currentAsOf);
    const actual = same.reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
    const plan = same.reduce((a, r) => a + (r.plan_manpower ?? 0), 0);
    return { actual, plan, diff: actual - plan, achievement: plan > 0 ? (actual / plan) * 100 : 0 };
  }, [rows, currentAsOf]);

  const byDiscipline = useMemo(() => {
    return DMR_DISCIPLINES.map((d) => {
      const r = rows.filter((x) => x.discipline === d && x.report_date === currentAsOf);
      return {
        discipline: d,
        actual: r.reduce((a, x) => a + (x.actual_manpower ?? 0), 0),
        plan: r.reduce((a, x) => a + (x.plan_manpower ?? 0), 0),
      };
    });
  }, [rows, currentAsOf]);

  // Trend: multi-line per group value (Actual manpower)
  const groupKey = (r: (typeof rows)[number]): string => {
    switch (groupBy) {
      case 'team': return (r.discipline as string) ?? '';
      case 'plot': return (r.plot as string) ?? '';
      case 'sub': return r.contractor_name ?? '';
      case 'wd': return r.system_name ?? '';
    }
  };

  const trendSeries = useMemo(() => {
    // Collect group values from selected filters where meaningful, otherwise from rows
    const selectedFor: Record<GroupBy, string[]> = {
      team: teams,
      plot: plots,
      sub: subContractors,
      wd: workDescriptions,
    };
    const selected = selectedFor[groupBy];
    const groups = selected.length > 0
      ? [...selected]
      : Array.from(new Set(rows.map(groupKey).filter(Boolean))).sort();
    const dates = Array.from(new Set(rows.map((r) => r.report_date))).sort();
    // Build per-date bucket (Actual + Plan for each group)
    const perDate = new Map<string, Record<string, number>>();
    for (const d of dates) perDate.set(d, {});
    for (const r of rows) {
      const g = groupKey(r);
      if (!g) continue;
      if (selected.length > 0 && !selected.includes(g)) continue;
      const bucket = perDate.get(r.report_date);
      if (!bucket) continue;
      bucket[g] = (bucket[g] ?? 0) + (r.actual_manpower ?? 0);
      bucket[g + '_plan'] = (bucket[g + '_plan'] ?? 0) + (r.plan_manpower ?? 0);
    }
    const data = dates.map((d) => ({ date: d, ...(perDate.get(d) ?? {}) }));
    return { data, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupBy, teams, plots, subContractors, workDescriptions]);

  const yMax = useMemo(() => {
    let max = 0;
    for (const row of trendSeries.data) {
      for (const g of trendSeries.groups) {
        max = Math.max(max, (row as any)[g] ?? 0, (row as any)[g + '_plan'] ?? 0);
      }
    }
  return niceMax(max);
}, [trendSeries]);

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Period: ${rangeDays}d`);
    if (teams.length > 0) parts.push(`Team: ${teams.join(', ')}`);
    else parts.push('Team: All');
    if (plots.length > 0) parts.push(`Plot: ${plots.join(', ')}`);
    else parts.push('Plot: All');
    if (contractorType !== 'all') parts.push(`Type: ${contractorType === 'direct' ? '직영' : '협력사'}`);
    if (workDescriptions.length > 0) parts.push(`Work Description: ${workDescriptions.length} selected`);
    if (subContractors.length > 0) parts.push(`Sub Contractor: ${subContractors.length} selected`);
    return parts.join(' · ');
  }, [rangeDays, teams, plots, contractorType, workDescriptions, subContractors]);

  const todaysManpower = useMemo(() => {
    if (!currentAsOf) return 0;
    return rows
      .filter((r) => r.report_date === currentAsOf)
      .reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
  }, [rows, currentAsOf]);

  // Subcon / System × date matrix (actual)
  const subconMatrix = useMemo(() => {
    const dates = Array.from(new Set(rows.map((r) => r.report_date))).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const keys = Array.from(new Set(rows.map((r) => r.contractor_name))).sort();
    const cell = (k: string, d: string) => rows
      .filter((r) => r.contractor_name === k && r.report_date === d)
      .reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
    const systemsBy = new Map<string, string[]>();
    for (const r of rows) {
      const arr = systemsBy.get(r.contractor_name) ?? [];
      if (r.system_name && !arr.includes(r.system_name)) arr.push(r.system_name);
      systemsBy.set(r.contractor_name, arr);
    }
    return { dates, keys, cell, systemsBy };
  }, [rows]);

  const systemMatrix = useMemo(() => {
    const dates = Array.from(new Set(rows.map((r) => r.report_date))).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const SEP = '\u0001';
    const pairSet = new Set<string>();
    for (const r of rows) {
      const sys = r.system_name ?? '';
      const sub = r.contractor_name ?? '';
      if (!sys && !sub) continue;
      pairSet.add(`${sys}${SEP}${sub}`);
    }
    const pairs = Array.from(pairSet)
      .map((k) => {
        const [system, subcon] = k.split(SEP);
        return { key: k, system, subcon };
      })
      .sort((a, b) => a.system.localeCompare(b.system) || a.subcon.localeCompare(b.subcon));
    const cell = (system: string, subcon: string, d: string) => rows
      .filter((r) => (r.system_name ?? '') === system && (r.contractor_name ?? '') === subcon && r.report_date === d)
      .reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
    return { dates, pairs, cell };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-40 -mx-4 space-y-3 border-b bg-background px-4 pb-3 pt-2 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">DMR Dashboard</h1>
          <p className="text-xs text-muted-foreground">Daily Manpower Record — 실적 요약 및 추이</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Data Date</div>
          <Input type="date" value={currentAsOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40 text-xs" />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">TEAM</div>
          <div className="flex flex-wrap gap-1">
            {DMR_DISCIPLINES.map((d) => (
              <FilterToggleButton
                key={d}
                active={teams.includes(d)}
                onClick={() => setTeams((prev) => prev.includes(d) ? prev.filter((v) => v !== d) : [...prev, d])}
              >
                {d}
              </FilterToggleButton>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Plot</div>
          <div className="flex gap-1">
            {(['C', 'D'] as const).map((p) => (
              <FilterToggleButton
                key={p}
                active={plots.includes(p)}
                className="w-10 px-0"
                onClick={() => setPlots((prev) => prev.includes(p) ? prev.filter((v) => v !== p) : [...prev, p])}
              >
                {p}
              </FilterToggleButton>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Work Description</div>
          <MultiSelectPopover
            label="Work Description"
            options={workDescOptions}
            value={workDescriptions}
            onChange={setWorkDescriptions}
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Sub Contractor</div>
          <MultiSelectPopover
            label="Sub Contractor"
            options={subContractorOptions}
            value={subContractors}
            onChange={setSubContractors}
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">유형</div>
          <select
            value={contractorType}
            onChange={(e) => setContractorType(e.target.value as 'all' | 'direct' | 'sub')}
            className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="all">All</option>
            <option value="direct">직영</option>
            <option value="sub">협력사</option>
          </select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">기간</div>
          <div className="flex gap-1">
            {[7, 14, 30].map((n) => (
              <Button key={n} size="sm" variant={rangeDays === n ? 'default' : 'outline'} onClick={() => setRangeDays(n as any)} className="h-8 px-3 text-xs">{n}d</Button>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* KPI Strip */}
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Actual" value={kpi.actual} />
        <KpiCard label="Plan" value={kpi.plan} />
        <KpiCard label="Δ (Actual−Plan)" value={kpi.diff} sub={kpi.diff !== 0 ? `${kpi.diff > 0 ? '+' : ''}${kpi.diff}` : '—'} subColor={kpi.diff > 0 ? 'emerald' : kpi.diff < 0 ? 'red' : 'muted'} />
        <KpiCard label="달성률" value={`${kpi.achievement.toFixed(1)}%`} />
      </div>

      {/* Discipline cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {byDiscipline.map((d) => (
          <Card key={d.discipline}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{d.discipline} · <span className="text-xs font-normal text-muted-foreground">{DISCIPLINE_LABEL[d.discipline]}</span></CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-center">
                <MiniStat label="Actual" value={d.actual} />
                <MiniStat label="Plan" value={d.plan} />
              </div>
              <div className={cn('mt-2 text-center text-xs', d.actual - d.plan > 0 ? 'text-emerald-600' : d.actual - d.plan < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                Δ {d.actual - d.plan > 0 ? '+' : ''}{d.actual - d.plan}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 생산성 — 계산은 src/lib/dmr/productivity.ts 한 벌만 쓴다 */}
      <ProductivitySection baseDate={currentAsOf} />

      {/* Daily Manpower Record — Subcon / System tabs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="mb-2 text-sm">Daily Manpower Record</CardTitle>
          <Tabs value={recordTab} onValueChange={(v) => setRecordTab(v as 'subcon' | 'system')}>
            <TabsList className="h-7">
              <TabsTrigger value="subcon" className="px-3 text-xs">Subcon</TabsTrigger>
              <TabsTrigger value="system" className="px-3 text-xs">System</TabsTrigger>
            </TabsList>
            <TabsContent value="subcon" className="mt-2">
              <div className="max-h-[400px] overflow-auto rounded-md border">
                <table className="w-full min-w-[600px] text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="sticky left-0 top-0 z-30 bg-muted px-2 py-1 text-left min-w-[160px]">Sub Contractor</th>
                      <th className="sticky left-[160px] top-0 z-30 bg-muted px-2 py-1 text-left min-w-[160px]">System</th>
                      {subconMatrix.dates.map((d) => (
                        <th key={d} className="sticky top-0 z-20 bg-muted px-2 py-1 text-right whitespace-nowrap">{fmtDate(d)}</th>
                      ))}
                      <th className="sticky top-0 z-20 bg-muted px-2 py-1 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subconMatrix.keys.map((k) => {
                      const sum = subconMatrix.dates.reduce((a, d) => a + subconMatrix.cell(k, d), 0);
                      const sysList = (subconMatrix.systemsBy.get(k) ?? []).sort().join(', ');
                      return (
                        <tr key={k} className="border-t hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-background px-2 py-1 font-medium hover:bg-background min-w-[160px]">{k}{directNames.has(k) && <span className="ml-1 rounded bg-secondary px-1 text-[9px]">직영</span>}</td>
                          <td className="sticky left-[160px] z-10 bg-background px-2 py-1 text-muted-foreground hover:bg-background min-w-[160px]" title={sysList}>{sysList || '—'}</td>
                          {subconMatrix.dates.map((d) => {
                            const v = subconMatrix.cell(k, d);
                            return <td key={d} className="px-2 py-1 text-right text-muted-foreground">{v || ''}</td>;
                          })}
                          <td className="px-2 py-1 text-right font-semibold">{sum}</td>
                        </tr>
                      );
                    })}
                    {subconMatrix.keys.length === 0 && (
                      <tr><td colSpan={subconMatrix.dates.length + 3} className="p-4 text-center text-muted-foreground">데이터가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
            <TabsContent value="system" className="mt-2">
              <div className="max-h-[400px] overflow-auto rounded-md border">
                <table className="w-full min-w-[600px] text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="sticky left-0 top-0 z-30 bg-muted px-2 py-1 text-left min-w-[160px]">System</th>
                      <th className="sticky left-[160px] top-0 z-30 bg-muted px-2 py-1 text-left min-w-[160px]">Subcon</th>
                      {systemMatrix.dates.map((d) => (
                        <th key={d} className="sticky top-0 z-20 bg-muted px-2 py-1 text-right whitespace-nowrap">{fmtDate(d)}</th>
                      ))}
                      <th className="sticky top-0 z-20 bg-muted px-2 py-1 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemMatrix.pairs.map((p) => {
                      const sum = systemMatrix.dates.reduce((a, d) => a + systemMatrix.cell(p.system, p.subcon, d), 0);
                      return (
                        <tr key={p.key} className="border-t hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-background px-2 py-1 font-medium hover:bg-background min-w-[160px]">{p.system || '—'}</td>
                          <td className="sticky left-[160px] z-10 bg-background px-2 py-1 text-muted-foreground hover:bg-background min-w-[160px]">
                            {p.subcon || '—'}
                            {p.subcon && directNames.has(p.subcon) && <span className="ml-1 rounded bg-secondary px-1 text-[9px]">직영</span>}
                          </td>
                          {systemMatrix.dates.map((d) => {
                            const v = systemMatrix.cell(p.system, p.subcon, d);
                            return <td key={d} className="px-2 py-1 text-right text-muted-foreground">{v || ''}</td>;
                          })}
                          <td className="px-2 py-1 text-right font-semibold">{sum}</td>
                        </tr>
                      );
                    })}
                    {systemMatrix.pairs.length === 0 && (
                      <tr><td colSpan={systemMatrix.dates.length + 3} className="p-4 text-center text-muted-foreground">데이터가 없습니다</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardHeader>
      </Card>

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">Daily Manpower Trend(Plan vs Actual)</CardTitle>
              <span className="text-[11px] text-muted-foreground">{activeFilterSummary}</span>
            </div>
            <div className="flex gap-1">
              {GROUP_BY_OPTIONS.map((o) => (
                <FilterToggleButton
                  key={o.value}
                  active={groupBy === o.value}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setGroupBy(o.value)}
                >
                  {o.label}
                </FilterToggleButton>
              ))}
            </div>
          </div>
          <div className="mt-2 text-[22px] font-bold text-red-500 truncate">
            Today's Manpower: {todaysManpower.toLocaleString()}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            {trendSeries.groups.length === 0 || trendSeries.data.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No data for current selection</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendSeries.data} margin={{ top: 10, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, yMax]} allowDecimals={false} />
                  <Tooltip labelFormatter={fmtDate} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trendSeries.groups.flatMap((g, i) => {
                    const color = LINE_COLORS[i % LINE_COLORS.length];
                    return [
                      <Line
                        key={`${g}-actual`}
                        type="linear"
                        dataKey={g}
                        stroke={color}
                        strokeWidth={4}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        name={g}
                      />,
                      <Line
                        key={`${g}-plan`}
                        type="linear"
                        dataKey={`${g}_plan`}
                        stroke={color}
                        strokeWidth={4}
                        strokeDasharray="6 4"
                        dot={false}
                        activeDot={false}
                        name={`${g} (Plan)`}
                      />,
                    ];
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Link
          to="/resource/dmr/raw-data"
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Raw Data 열기 →
        </Link>
      </div>
    </div>
  );
}

function FilterToggleButton({
  active,
  className,
  children,
  onClick,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

function KpiCard({ label, value, sub, subColor = 'muted' }: { label: string; value: number | string; sub?: string; subColor?: 'emerald' | 'red' | 'muted' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        {sub && (
          <div className={cn('mt-1 text-xs font-medium', subColor === 'emerald' ? 'text-emerald-600' : subColor === 'red' ? 'text-red-600' : 'text-muted-foreground')}>{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function MultiSelectPopover({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options),
    [options, query],
  );
  const toggle = (o: string) => {
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  };
  const btnLabel = value.length === 0 ? `All ${label}` : `${value.length} selected`;
  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="h-8 min-w-[10rem] justify-between text-xs"
      >
        <span className="truncate">{btnLabel}</span>
        <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
        <Input
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="mb-2 flex justify-between text-[11px]">
          <button className="text-primary hover:underline" onClick={() => onChange(filtered)}>Select all</button>
          <button className="text-muted-foreground hover:underline" onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 && <div className="p-2 text-center text-xs text-muted-foreground">No options</div>}
          {filtered.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50">
              <input
                type="checkbox"
                checked={value.includes(o)}
                onChange={() => toggle(o)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
/* ────────────────────────── 생산성 ──────────────────────────
 * 계산은 src/lib/dmr/productivity.ts 한 벌만 쓴다. 여기서 다시 계산하지 않는다.
 * 스탯 타일 KpiCard · MiniStat · Tabs · Table · Badge 는 이 파일/공용 UI 의 기존 것을 그대로 쓴다.
 */
const PERIOD_KINDS: PeriodKind[] = ['day', 'week', 'month', 'range', 'all'];

function sortByProductivity(rows: ProductivityRow[]) {
  return [...rows].sort((a, b) => {
    const av = a.productivity;
    const bv = b.productivity;
    if (av == null && bv == null) return a.task_no.localeCompare(b.task_no);
    if (av == null) return 1; // 빈칸은 맨 아래
    if (bv == null) return -1;
    return bv - av;
  });
}

function ProductivitySection({ baseDate }: { baseDate: string }) {
  const [kind, setKind] = useState<PeriodKind>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'code' | 'team' | 'contractor'>('code');

  const historyQ = useTmHistoryStart();
  // 기준일이 아직 정해지기 전(빈 값)이면 계산을 걸지 않는다.
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(baseDate);
  const safeBase = ready ? baseDate : yesterdayInDoha();
  const period = useMemo(
    () => resolvePeriod(kind, safeBase, { from, to, historyStart: historyQ.data ?? null }),
    [kind, safeBase, from, to, historyQ.data],
  );

  const prodQ = useProductivity(period, ready);
  const rows = useMemo(() => sortByProductivity(prodQ.data?.rows ?? []), [prodQ.data]);
  const summary = useMemo(() => summarize(rows, period), [rows, period]);
  const teamRows = useMemo(() => aggregateByTeam(rows), [rows]);
  const contractor = useMemo(() => aggregateByContractor(rows), [rows]);
  const subtotals = useMemo(() => contractorSubtotals(contractor.rows), [contractor.rows]);

  // 인원 종류 칸은 foreman/supervisor 행이 하나라도 생겨야 나타난다.
  const kinds = useMemo(() => {
    const s = new Set<string>();
    for (const r of prodQ.data?.dmrRows ?? []) if (r.headcount_kind) s.add(r.headcount_kind);
    return s;
  }, [prodQ.data]);
  const showKindColumns = kinds.has('foreman') || kinds.has('supervisor');

  const loading = prodQ.isLoading || prodQ.isFetching;
  const ratio = summary.recordRatioMedian;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">생산성 (당일실적% ÷ 인원)</CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            {PERIOD_KINDS.map((k) => (
              <FilterToggleButton
                key={k}
                active={kind === k}
                className="h-7 px-2 text-[11px]"
                onClick={() => setKind(k)}
              >
                {PERIOD_LABEL[k]}
              </FilterToggleButton>
            ))}
            {kind === 'range' && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 w-36 text-xs" />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 w-36 text-xs" />
              </>
            )}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">{period.start} ~ {period.end}</Badge>
          {kind === 'all' && (
            <Badge variant="outline" className="text-[10px]">
              이력 개시일 기준 · 시작 {period.start}
            </Badge>
          )}
          <span>계획 생산성 회복 가정 · 인원과 진도가 비례한다고 봄</span>
        </div>

        {/* 믿을 수 있는 숫자인지 먼저 보여 준다 */}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <span className={cn('font-medium', ratio != null && ratio < 0.9 ? 'text-red-600' : 'text-muted-foreground')}>
            기록일 비율(중앙값) {ratio == null ? '—' : ratio.toFixed(2)}
            {ratio != null && ratio < 0.9 && ` · 분모가 기록된 날만 더해져 생산성이 약 ${(1 / ratio).toFixed(2)}배 부풀 수 있음`}
          </span>
          <span className={cn(summary.actualWithoutManpower > 0 ? 'text-red-600' : 'text-muted-foreground')}>
            인원 없이 실적만 오른 코드 {summary.actualWithoutManpower.toLocaleString()}건
          </span>
          <span className={cn(summary.dataDateGapCodes > 0 ? 'text-red-600' : 'text-muted-foreground')}>
            Data Date 격차 ≠ 0 코드 {summary.dataDateGapCodes.toLocaleString()}건
          </span>
        </div>
        <div className="mt-1 text-[11px] text-red-600">
          출면 데이터 정비 중 — 인원 합계가 실제와 다를 수 있습니다
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-5">
              <KpiCard label="인원 (인·일)" value={summary.manpower} />
              <KpiCard
                label="당일실적%"
                value={fmtPct(summary.actualSum) || '—'}
                sub={`당일계획% ${fmtPct(summary.planSum) || '—'}`}
              />
              <KpiCard
                label="생산성"
                value={fmtProd(summary.productivity) || '—'}
                sub={`계획 생산성 ${fmtProd(summary.planProductivity) || '—'}`}
              />
              <KpiCard
                label="계획 달성률"
                value={summary.achievement == null ? '—' : `${(summary.achievement * 100).toFixed(1)}%`}
                sub={summary.achievement == null ? '계획 구간 밖' : summary.achievement >= 1 ? '증원 불필요' : '계획 미달'}
                subColor={summary.achievement == null ? 'muted' : summary.achievement >= 1 ? 'emerald' : 'red'}
              />
              <KpiCard
                label="추가 필요 인원 (인·일)"
                value={summary.extraManpower > 0 ? fmtExtra(summary.extraManpower, '') : '0'}
                sub={summary.extraManpower > 0 ? '계획 생산성 회복 가정' : '증원 불필요'}
                subColor={summary.extraManpower > 0 ? 'red' : 'emerald'}
              />
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList className="h-7">
                <TabsTrigger value="code" className="px-3 text-xs">TM Code</TabsTrigger>
                <TabsTrigger value="team" className="px-3 text-xs">팀</TabsTrigger>
                <TabsTrigger value="contractor" className="px-3 text-xs">업체</TabsTrigger>
              </TabsList>

              <TabsContent value="code" className="mt-2">
                <div className="max-h-[420px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">TM Code</TableHead>
                        <TableHead className="text-xs">Task</TableHead>
                        <TableHead className="text-xs">Work Type</TableHead>
                        <TableHead className="text-xs">팀</TableHead>
                        <TableHead className="text-right text-xs">인원</TableHead>
                        {showKindColumns && <TableHead className="text-right text-xs">Foreman</TableHead>}
                        {showKindColumns && <TableHead className="text-right text-xs">Supervisor</TableHead>}
                        <TableHead className="text-right text-xs">기록일</TableHead>
                        <TableHead className="text-right text-xs">당일계획%</TableHead>
                        <TableHead className="text-right text-xs">당일실적%</TableHead>
                        <TableHead className="text-right text-xs">생산성</TableHead>
                        <TableHead className="text-right text-xs">달성률</TableHead>
                        <TableHead className="text-right text-xs">추가 인원</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.task_no}>
                          <TableCell className="font-mono text-xs">{r.task_no}</TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs" title={r.task_name}>{r.task_name}</TableCell>
                          <TableCell className="text-xs">{r.work_type}</TableCell>
                          <TableCell className="text-xs">{r.team}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.manpower.toLocaleString()}</TableCell>
                          {showKindColumns && <TableCell className="text-right text-xs tabular-nums">—</TableCell>}
                          {showKindColumns && <TableCell className="text-right text-xs tabular-nums">—</TableCell>}
                          <TableCell className="text-right text-xs tabular-nums">{r.record_days} / {summary.calendarDays}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtPct(r.plan_pct)}</TableCell>
                          <TableCell className={cn('text-right text-xs tabular-nums', (r.actual_pct ?? 0) < 0 && 'text-red-600')}>{fmtPct(r.actual_pct)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {r.productivity == null
                              ? <Badge variant="outline" className="text-[10px]">{r.kind === '다' ? '산출 불가' : '—'}</Badge>
                              : fmtProd(r.productivity)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {r.achievement == null
                              ? <Badge variant="outline" className="text-[10px]">계획 없음</Badge>
                              : <span className={r.achievement >= 1 ? 'text-emerald-600' : 'text-red-600'}>{(r.achievement * 100).toFixed(1)}%</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {r.plan_pct == null || r.plan_pct <= 0
                              ? <Badge variant="outline" className="text-[10px]">해당 없음</Badge>
                              : r.extra_manpower === 0
                                ? <span className="text-emerald-600">증원 불필요</span>
                                : <span className="text-red-600">{fmtExtra(r.extra_manpower_per_day)}</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={showKindColumns ? 14 : 12} className="p-6 text-center text-xs text-muted-foreground">표시할 코드가 없습니다</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="team" className="mt-2">
                <div className="max-h-[420px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">팀</TableHead>
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
                      {teamRows.map((t) => (
                        <TableRow key={t.team}>
                          <TableCell className="text-xs font-medium">{t.team}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{t.codes.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{t.manpower.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtPct(t.planSum)}</TableCell>
                          <TableCell className={cn('text-right text-xs tabular-nums', t.actualSum < 0 && 'text-red-600')}>{fmtPct(t.actualSum)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtProd(t.productivity) || '—'}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {t.achievement == null
                              ? <Badge variant="outline" className="text-[10px]">계획 없음</Badge>
                              : <span className={t.achievement >= 1 ? 'text-emerald-600' : 'text-red-600'}>{(t.achievement * 100).toFixed(1)}%</span>}
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
                      {teamRows.length === 0 && (
                        <TableRow><TableCell colSpan={8} className="p-6 text-center text-xs text-muted-foreground">표시할 팀이 없습니다</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="contractor" className="mt-2 space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  단독 코드 {contractor.soloCodes.toLocaleString()}건 · 공동 코드 {contractor.sharedCodes.toLocaleString()}건
                  {' · '}소계 실적은 단독 코드만 더한다
                </div>
                <div className="max-h-[420px] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">업체</TableHead>
                        <TableHead className="text-xs">TM Code</TableHead>
                        <TableHead className="text-xs">Task</TableHead>
                        <TableHead className="text-right text-xs">인원(그 업체)</TableHead>
                        <TableHead className="text-right text-xs">당일실적%</TableHead>
                        <TableHead className="text-right text-xs">생산성</TableHead>
                        <TableHead className="text-xs">비고</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contractor.rows.map((r) => (
                        <TableRow key={`${r.contractor}@@${r.task_no}`}>
                          <TableCell className="text-xs font-medium">{r.contractor}</TableCell>
                          <TableCell className="font-mono text-xs">{r.task_no}</TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs" title={r.task_name}>{r.task_name}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{r.manpower.toLocaleString()}</TableCell>
                          <TableCell className={cn('text-right text-xs tabular-nums', (r.actual_pct ?? 0) < 0 && 'text-red-600')}>{fmtPct(r.actual_pct)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtProd(r.productivity) || '—'}</TableCell>
                          <TableCell className="text-xs">
                            {r.shared
                              ? <Badge variant="secondary" className="text-[10px]">공동 {r.sharedCount}사 · 코드 전체 인원 {r.codeManpower.toLocaleString()} 기준</Badge>
                              : <Badge variant="outline" className="text-[10px]">단독</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {contractor.rows.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="p-6 text-center text-xs text-muted-foreground">표시할 업체가 없습니다</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="max-h-[240px] overflow-auto rounded-md border">
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
                      {subtotals.map((s) => (
                        <TableRow key={s.contractor}>
                          <TableCell className="text-xs font-medium">{s.contractor}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{s.soloManpower.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtPct(s.actualSum)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmtProd(s.productivity) || '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">공동 포함 인원 {(s.soloManpower + s.sharedManpower).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  );
}
