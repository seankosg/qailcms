import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload } from 'lucide-react';
import { DMR_DISCIPLINES, DMR_PLOTS, DMR_METRICS } from '@/lib/dmr/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';

const PAGE_SIZE = 200;

export function DmrRawDataPage() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.canEdit || !!me?.isAdmin;

  const [discipline, setDiscipline] = useState<string>('all');
  const [plot, setPlot] = useState<string>('all');
  const [metric, setMetric] = useState<string>('all');
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const query = useQuery({
    queryKey: ['dmr_entries', { discipline, plot, metric, q, fromDate, toDate }],
    queryFn: async () => {
      let sq = supabase.from('dmr_entries').select('*', { count: 'exact' })
        .order('report_date', { ascending: false })
        .order('discipline').order('system_name').order('contractor_name')
        .limit(PAGE_SIZE);
      if (discipline !== 'all') sq = sq.eq('discipline', discipline);
      if (plot !== 'all') sq = sq.eq('plot', plot);
      if (metric !== 'all') sq = sq.eq('metric', metric);
      if (fromDate) sq = sq.gte('report_date', fromDate);
      if (toDate) sq = sq.lte('report_date', toDate);
      if (q.trim()) {
        const t = q.trim();
        sq = sq.or(`system_name.ilike.%${t}%,contractor_name.ilike.%${t}%`);
      }
      const { data, count, error } = await sq;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const contractorsQuery = useQuery({
    queryKey: ['dmr_contractor_master'],
    queryFn: async () => {
      const { data } = await supabase.from('dmr_contractor_master').select('name, is_direct');
      return data ?? [];
    },
    staleTime: 60_000,
  });
  const directSet = useMemo(() => {
    const m = new Map<string, boolean>();
    (contractorsQuery.data ?? []).forEach((c) => m.set(c.name, !!c.is_direct));
    return m;
  }, [contractorsQuery.data]);

  const total = query.data?.count ?? 0;
  const rows = query.data?.rows ?? [];
  const sumManpower = rows.reduce((a, r: any) => a + (r.manpower ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">DMR Raw Data</h1>
          <p className="text-xs text-muted-foreground">일자별·공종별·협력사별 인원 실적 (롱포맷)</p>
        </div>
        {canEdit && (
          <Button asChild size="sm">
            <Link to="/resource/dmr/import"><Upload className="mr-2 h-3.5 w-3.5" />Import</Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">공종</div>
          <Select value={discipline} onValueChange={setDiscipline}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Plot</div>
          <Select value={plot} onValueChange={setPlot}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_PLOTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Metric</div>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_METRICS.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">From</div>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">To</div>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>
        <div className="min-w-40 flex-1">
          <div className="mb-1 text-[11px] text-muted-foreground">검색 (System / Contractor)</div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-xs" placeholder="이름 검색…" />
        </div>
        <div className="ml-auto flex flex-col text-right">
          <span className="text-[11px] text-muted-foreground">Rows / Manpower</span>
          <span className="text-sm font-semibold">{total.toLocaleString()} · {sumManpower.toLocaleString()}명</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-left">공종</th>
              <th className="px-2 py-1 text-left">System</th>
              <th className="px-2 py-1 text-left">Contractor</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Plot</th>
              <th className="px-2 py-1 text-left">Metric</th>
              <th className="px-2 py-1 text-right">Manpower</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">로딩 중…</td></tr>
            )}
            {!query.isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">데이터가 없습니다</td></tr>
            )}
            {rows.map((r: any) => {
              const direct = directSet.get(r.contractor_name);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1">{r.report_date}</td>
                  <td className="px-2 py-1">{r.discipline}</td>
                  <td className="px-2 py-1">{r.system_name}</td>
                  <td className="px-2 py-1">{r.contractor_name}</td>
                  <td className="px-2 py-1">
                    {direct ? <Badge variant="secondary">직영</Badge> : direct === false ? <Badge variant="outline">협력사</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1">{r.plot}</td>
                  <td className="px-2 py-1 capitalize">{r.metric}</td>
                  <td className="px-2 py-1 text-right font-medium">{r.manpower.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > PAGE_SIZE && (
        <div className="text-center text-xs text-muted-foreground">최대 {PAGE_SIZE}행 표시 중 · 필터로 좁혀보세요 (총 {total.toLocaleString()}건)</div>
      )}
    </div>
  );
}