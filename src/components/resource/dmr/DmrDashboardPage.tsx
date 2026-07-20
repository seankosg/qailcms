import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';
import { DMR_DISCIPLINES, DISCIPLINE_LABEL, type DmrDiscipline } from '@/lib/dmr/types';
import { cn } from '@/lib/utils';

function subDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DmrDashboardPage() {
  const [discipline, setDiscipline] = useState<'all' | DmrDiscipline>('all');
  const [contractorType, setContractorType] = useState<'all' | 'direct' | 'sub'>('all');
  const [asOf, setAsOf] = useState<string>('');
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(14);

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
    queryKey: ['dmr_entries_window', currentAsOf, rangeDays, discipline],
    queryFn: async () => {
      let sq = supabase.from('dmr_entries').select('report_date, discipline, contractor_name, system_name, plot, metric, manpower')
        .gte('report_date', fromDate).lte('report_date', currentAsOf)
        .eq('plot', 'TOTAL');
      if (discipline !== 'all') sq = sq.eq('discipline', discipline);
      const { data, error } = await sq;
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const src = entriesQuery.data ?? [];
    if (contractorType === 'all') return src;
    return src.filter((r) => contractorType === 'direct' ? directNames.has(r.contractor_name) : !directNames.has(r.contractor_name));
  }, [entriesQuery.data, contractorType, directNames]);

  // Aggregations
  const kpi = useMemo(() => {
    const today = rows.filter((r) => r.report_date === currentAsOf && r.metric === 'today').reduce((a, r) => a + (r.manpower ?? 0), 0);
    const yest = rows.filter((r) => r.report_date === currentAsOf && r.metric === 'yesterday').reduce((a, r) => a + (r.manpower ?? 0), 0);
    const target = rows.filter((r) => r.report_date === currentAsOf && r.metric === 'target').reduce((a, r) => a + (r.manpower ?? 0), 0);
    return { today, yest, target, diff: today - yest, achievement: target > 0 ? (today / target) * 100 : 0 };
  }, [rows, currentAsOf]);

  const byDiscipline = useMemo(() => {
    return DMR_DISCIPLINES.map((d) => {
      const r = rows.filter((x) => x.discipline === d && x.report_date === currentAsOf);
      return {
        discipline: d,
        today: r.filter((x) => x.metric === 'today').reduce((a, x) => a + x.manpower, 0),
        yest: r.filter((x) => x.metric === 'yesterday').reduce((a, x) => a + x.manpower, 0),
        target: r.filter((x) => x.metric === 'target').reduce((a, x) => a + x.manpower, 0),
      };
    });
  }, [rows, currentAsOf]);

  // Trend: today vs target per day
  const trend = useMemo(() => {
    const map = new Map<string, { date: string; today: number; target: number }>();
    for (const r of rows) {
      const cur = map.get(r.report_date) ?? { date: r.report_date, today: 0, target: 0 };
      if (r.metric === 'today') cur.today += r.manpower;
      if (r.metric === 'target') cur.target += r.manpower;
      map.set(r.report_date, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // Contractor × date matrix (today)
  const matrix = useMemo(() => {
    const dates = Array.from(new Set(rows.map((r) => r.report_date))).sort();
    const contractors = Array.from(new Set(rows.map((r) => r.contractor_name))).sort();
    const cell = (c: string, d: string) => rows
      .filter((r) => r.contractor_name === c && r.report_date === d && r.metric === 'today')
      .reduce((a, r) => a + r.manpower, 0);
    return { dates, contractors, cell };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">DMR Dashboard</h1>
        <p className="text-xs text-muted-foreground">Daily Manpower Report — 실적 요약 및 추이</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Data Date</div>
          <Input type="date" value={currentAsOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40 text-xs" />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">공종</div>
          <Select value={discipline} onValueChange={(v) => setDiscipline(v as any)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">유형</div>
          <Select value={contractorType} onValueChange={(v) => setContractorType(v as any)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="direct">직영</SelectItem>
              <SelectItem value="sub">협력사</SelectItem>
            </SelectContent>
          </Select>
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

      {/* KPI Strip */}
      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Today" value={kpi.today} />
        <KpiCard label="Yesterday" value={kpi.yest} sub={kpi.diff !== 0 ? `${kpi.diff > 0 ? '+' : ''}${kpi.diff}` : '—'} subColor={kpi.diff > 0 ? 'emerald' : kpi.diff < 0 ? 'red' : 'muted'} />
        <KpiCard label="Target" value={kpi.target} />
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
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Today" value={d.today} />
                <MiniStat label="Yest." value={d.yest} />
                <MiniStat label="Target" value={d.target} />
              </div>
              <div className={cn('mt-2 text-center text-xs', d.today - d.yest > 0 ? 'text-emerald-600' : d.today - d.yest < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                Δ {d.today - d.yest > 0 ? '+' : ''}{d.today - d.yest}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">일자별 총원 추이 (Today vs Target)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="today" stroke="hsl(var(--primary))" strokeWidth={2} name="Today" />
                <Line type="monotone" dataKey="target" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" name="Target" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Contractor × Date Matrix */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Contractor × 일자 매트릭스 (Today)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/80 px-2 py-1 text-left">Contractor</th>
                  {matrix.dates.map((d) => (
                    <th key={d} className="px-2 py-1 text-right whitespace-nowrap">{d.slice(5)}</th>
                  ))}
                  <th className="px-2 py-1 text-right">합계</th>
                </tr>
              </thead>
              <tbody>
                {matrix.contractors.map((c) => {
                  const sum = matrix.dates.reduce((a, d) => a + matrix.cell(c, d), 0);
                  return (
                    <tr key={c} className="border-t hover:bg-muted/30">
                      <td className="sticky left-0 z-[5] bg-background px-2 py-1 font-medium">{c}{directNames.has(c) && <span className="ml-1 rounded bg-secondary px-1 text-[9px]">직영</span>}</td>
                      {matrix.dates.map((d) => {
                        const v = matrix.cell(c, d);
                        return <td key={d} className="px-2 py-1 text-right text-muted-foreground">{v || ''}</td>;
                      })}
                      <td className="px-2 py-1 text-right font-semibold">{sum}</td>
                    </tr>
                  );
                })}
                {matrix.contractors.length === 0 && (
                  <tr><td colSpan={matrix.dates.length + 2} className="p-4 text-center text-muted-foreground">데이터가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm"><Link to="/resource/dmr/raw-data">Raw Data 열기 →</Link></Button>
      </div>
    </div>
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