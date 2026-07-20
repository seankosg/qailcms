import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from 'recharts';
import { DMR_DISCIPLINES, DISCIPLINE_LABEL, type DmrDiscipline } from '@/lib/dmr/types';
import { cn } from '@/lib/utils';

function subDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DmrDashboardPage() {
  const [teams, setTeams] = useState<DmrDiscipline[]>([]);
  const [plots, setPlots] = useState<Array<'C' | 'D'>>([]);
  const [workDescriptions, setWorkDescriptions] = useState<string[]>([]);
  const [subContractors, setSubContractors] = useState<string[]>([]);
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
    queryKey: ['dmr_entries_window_raw', currentAsOf, rangeDays],
    queryFn: async () => {
      const { data, error } = await supabase.from('dmr_entries')
        .select('report_date, discipline, contractor_name, system_name, plot, plan_manpower, actual_manpower')
        .gte('report_date', fromDate).lte('report_date', currentAsOf)
        .in('plot', ['C', 'D']);
      if (error) throw error;
      return data ?? [];
    },
  });

  const src = entriesQuery.data ?? [];

  // Distinct options for pulldown filters (from loaded window)
  const workDescOptions = useMemo(
    () => Array.from(new Set(src.map((r) => r.system_name).filter(Boolean) as string[])).sort(),
    [src],
  );
  const subContractorOptions = useMemo(
    () => Array.from(new Set(src.map((r) => r.contractor_name).filter(Boolean) as string[])).sort(),
    [src],
  );

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

  // Trend: actual vs plan per day
  const trend = useMemo(() => {
    const map = new Map<string, { date: string; actual: number; plan: number }>();
    for (const r of rows) {
      const cur = map.get(r.report_date) ?? { date: r.report_date, actual: 0, plan: 0 };
      cur.actual += r.actual_manpower ?? 0;
      cur.plan += r.plan_manpower ?? 0;
      map.set(r.report_date, cur);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // Contractor × date matrix (actual)
  const matrix = useMemo(() => {
    const dates = Array.from(new Set(rows.map((r) => r.report_date))).sort();
    const contractors = Array.from(new Set(rows.map((r) => r.contractor_name))).sort();
    const cell = (c: string, d: string) => rows
      .filter((r) => r.contractor_name === c && r.report_date === d)
      .reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
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
          <div className="mb-1 text-[11px] text-muted-foreground">TEAM</div>
          <ToggleGroup type="multiple" value={teams} onValueChange={(v) => setTeams(v as DmrDiscipline[])} className="flex flex-wrap gap-1">
            {DMR_DISCIPLINES.map((d) => (
              <ToggleGroupItem key={d} value={d} className="h-8 px-2 text-xs">{d}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Plot</div>
          <ToggleGroup type="multiple" value={plots} onValueChange={(v) => setPlots(v as Array<'C' | 'D'>)} className="flex gap-1">
            {(['C', 'D'] as const).map((p) => (
              <ToggleGroupItem key={p} value={p} className="h-8 w-10 text-xs">{p}</ToggleGroupItem>
            ))}
          </ToggleGroup>
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

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">일자별 총원 추이 (Actual vs Plan)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="actual" stroke="#2563eb" strokeWidth={2} name="Actual" dot={{ r: 3 }} />
                <Line type="monotone" dataKey="plan" stroke="#9ca3af" strokeDasharray="4 4" strokeWidth={2} name="Plan" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Contractor × Date Matrix */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Sub Contractor × 일자 매트릭스 (Actual)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted/80 px-2 py-1 text-left">Sub Contractor</th>
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 min-w-[10rem] justify-between text-xs">
          <span className="truncate">{btnLabel}</span>
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
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
              <Checkbox checked={value.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}