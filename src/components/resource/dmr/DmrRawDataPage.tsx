import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { DMR_DISCIPLINES, DMR_PLOTS } from '@/lib/dmr/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DmrBulkEditBar } from './DmrBulkEditBar';
import { fetchDmrFilteredIds } from '@/lib/dmr-mutations.functions';

const PAGE_SIZE = 500;

type SortField =
  | 'report_date'
  | 'discipline'
  | 'system_name'
  | 'contractor_name'
  | 'plot'
  | 'plan_manpower'
  | 'actual_manpower'
  | 'diff_manpower';

interface SortSpec {
  field: SortField;
  asc: boolean;
}

const DEFAULT_SORT: SortSpec[] = [
  { field: 'report_date', asc: false },
  { field: 'discipline', asc: true },
  { field: 'system_name', asc: true },
  { field: 'contractor_name', asc: true },
];

export function DmrRawDataPage() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.canEdit || !!me?.isAdmin;
  const qc = useQueryClient();

  const [discipline, setDiscipline] = useState<string>('all');
  const [plot, setPlot] = useState<string>('all');
  const [systems, setSystems] = useState<string[]>([]);
  const [contractors, setContractors] = useState<string[]>([]);
  const [directOnly, setDirectOnly] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<SortSpec[]>(DEFAULT_SORT);
  const [selection, setSelection] = useState<Record<string, boolean>>({});

  const anyFilterActive =
    discipline !== 'all' ||
    plot !== 'all' ||
    systems.length > 0 ||
    contractors.length > 0 ||
    directOnly.length > 0 ||
    q.trim().length > 0 ||
    !!fromDate ||
    !!toDate;

  const resetFilters = () => {
    setDiscipline('all');
    setPlot('all');
    setSystems([]);
    setContractors([]);
    setDirectOnly([]);
    setQ('');
    setFromDate('');
    setToDate('');
  };

  // 마스터: 직영/협력사 판정 + 필터 옵션
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
    (contractorsQuery.data ?? []).forEach((c: any) => m.set(c.name, !!c.is_direct));
    return m;
  }, [contractorsQuery.data]);

  const systemsQuery = useQuery({
    queryKey: ['dmr_system_master'],
    queryFn: async () => {
      const { data } = await supabase.from('dmr_system_master').select('name').order('name');
      return (data ?? []) as { name: string }[];
    },
    staleTime: 60_000,
  });

  const contractorOptions = useMemo(() => {
    const arr = (contractorsQuery.data ?? []) as { name: string; is_direct: boolean }[];
    return arr.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [contractorsQuery.data]);

  const systemOptions = useMemo(
    () => (systemsQuery.data ?? []).map((r) => r.name),
    [systemsQuery.data],
  );

  // 실제 협력사 필터에 directOnly 반영
  const effectiveContractors = useMemo(() => {
    if (directOnly.length === 0 || directOnly.length === 2) return contractors;
    const wantDirect = directOnly.includes('direct');
    const filteredMaster = contractorOptions
      .filter((c) => !!c.is_direct === wantDirect)
      .map((c) => c.name);
    if (contractors.length === 0) return filteredMaster;
    return contractors.filter((n) => filteredMaster.includes(n));
  }, [contractors, directOnly, contractorOptions]);

  const filterKey = {
    discipline,
    plot,
    systems,
    effectiveContractors,
    q: q.trim(),
    fromDate,
    toDate,
  };

  const query = useQuery({
    queryKey: ['dmr_entries', filterKey, sort],
    queryFn: async () => {
      let sq = supabase.from('dmr_entries').select('*', { count: 'exact' });
      for (const s of sort) {
        sq = sq.order(s.field, { ascending: s.asc });
      }
      sq = sq.limit(PAGE_SIZE);
      if (discipline !== 'all') sq = sq.eq('discipline', discipline);
      if (plot !== 'all') sq = sq.eq('plot', plot);
      if (systems.length) sq = sq.in('system_name', systems);
      if (effectiveContractors.length) sq = sq.in('contractor_name', effectiveContractors);
      if (fromDate) sq = sq.gte('report_date', fromDate);
      if (toDate) sq = sq.lte('report_date', toDate);
      if (q.trim()) {
        const t = q.trim();
        sq = sq.or(`system_name.ilike.%${t}%,contractor_name.ilike.%${t}%`);
      }
      const { data, count, error } = await sq;
      if (error) throw error;
      return { rows: (data ?? []) as any[], count: count ?? 0 };
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? 0;
  const sumPlan = rows.reduce((a, r: any) => a + (r.plan_manpower ?? 0), 0);
  const sumActual = rows.reduce((a, r: any) => a + (r.actual_manpower ?? 0), 0);
  const sumDiff = sumActual - sumPlan;

  const selectedIds = useMemo(
    () => Object.entries(selection).filter(([, v]) => v).map(([k]) => k),
    [selection],
  );
  const selectedRows = useMemo(
    () => rows.filter((r) => selection[r.id]),
    [rows, selection],
  );
  const pageAllSelected = rows.length > 0 && rows.every((r) => selection[r.id]);
  const pageSomeSelected = !pageAllSelected && rows.some((r) => selection[r.id]);

  function togglePageAll(checked: boolean) {
    setSelection((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (checked) next[r.id] = true;
        else delete next[r.id];
      }
      return next;
    });
  }

  async function selectAllFiltered() {
    try {
      const res = await fetchDmrFilteredIds({
        data: {
          discipline,
          plot,
          systems,
          contractors: effectiveContractors,
          fromDate: fromDate || null,
          toDate: toDate || null,
          q: q.trim() || null,
          directOnly: directOnly as ('direct' | 'sub')[],
        },
      });
      const next: Record<string, boolean> = {};
      for (const id of res.ids) next[id] = true;
      setSelection(next);
      toast.success('필터된 전체 선택', { description: `${res.ids.length.toLocaleString()}건` });
    } catch (e: any) {
      toast.error('전체 선택 실패', { description: e?.message ?? String(e) });
    }
  }

  function toggleSort(field: SortField) {
    setSort((prev) => {
      const idx = prev.findIndex((s) => s.field === field);
      if (idx < 0) return [{ field, asc: true }];
      const cur = prev[idx];
      if (cur.asc) return [{ field, asc: false }];
      // desc → clear (기본 정렬로 복귀)
      return DEFAULT_SORT;
    });
  }

  const sortOf = (field: SortField): SortSpec | undefined =>
    sort.find((s) => s.field === field);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">DMR Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            일자별·공종별·협력사별 인원 실적 (롱포맷)
          </p>
        </div>
        {canEdit && (
          <Button asChild size="sm">
            <Link to="/resource/dmr/import">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Import
            </Link>
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">공종</div>
          <Select value={discipline} onValueChange={setDiscipline}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_DISCIPLINES.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Plot</div>
          <Select value={plot} onValueChange={setPlot}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_PLOTS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Metric</div>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {DMR_METRICS.map((m) => (
                <SelectItem key={m} value={m} className="capitalize">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">From</div>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">To</div>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 w-36 text-xs"
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">System</div>
          <ValueListFilter
            label="System"
            options={systemOptions}
            value={systems}
            onChange={setSystems}
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Contractor</div>
          <ValueListFilter
            label="Contractor"
            options={contractorOptions.map((c) => c.name)}
            value={contractors}
            onChange={setContractors}
            badgeFor={(name) =>
              directSet.get(name) === true
                ? '직영'
                : directSet.get(name) === false
                  ? '협력사'
                  : undefined
            }
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">유형</div>
          <ToggleGroup
            type="multiple"
            value={directOnly}
            onValueChange={setDirectOnly}
            className="gap-1"
          >
            <ToggleGroupItem
              value="direct"
              className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              직영
            </ToggleGroupItem>
            <ToggleGroupItem
              value="sub"
              className="h-8 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              협력사
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="min-w-40 flex-1">
          <div className="mb-1 text-[11px] text-muted-foreground">검색 (System / Contractor)</div>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 text-xs"
            placeholder="이름 검색…"
          />
        </div>

        {anyFilterActive && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={resetFilters}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            필터 초기화
          </Button>
        )}

        <div className="ml-auto flex flex-col text-right">
          <span className="text-[11px] text-muted-foreground">Rows / Manpower</span>
          <span className="text-sm font-semibold">
            {rows.length.toLocaleString()}
            {total > rows.length && ` / ${total.toLocaleString()}`} ·{' '}
            {sumManpower.toLocaleString()}명
          </span>
        </div>
      </div>

      {total > rows.length && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>
            최대 {PAGE_SIZE.toLocaleString()}행 표시 중 · 총 {total.toLocaleString()}건
          </span>
          <button
            className="text-primary underline-offset-2 hover:underline"
            onClick={selectAllFiltered}
          >
            필터된 전체 {total.toLocaleString()}건 선택
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[960px] text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-8 px-2 py-1">
                <Checkbox
                  checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
                  onCheckedChange={(c) => togglePageAll(!!c)}
                  className="h-3.5 w-3.5"
                  aria-label="현재 페이지 전체 선택"
                />
              </th>
              <SortHeader label="Date" field="report_date" sortOf={sortOf} onClick={toggleSort} />
              <SortHeader label="공종" field="discipline" sortOf={sortOf} onClick={toggleSort} />
              <SortHeader label="System" field="system_name" sortOf={sortOf} onClick={toggleSort} />
              <SortHeader label="Contractor" field="contractor_name" sortOf={sortOf} onClick={toggleSort} />
              <th className="px-2 py-1 text-left">유형</th>
              <SortHeader label="Plot" field="plot" sortOf={sortOf} onClick={toggleSort} />
              <SortHeader label="Metric" field="metric" sortOf={sortOf} onClick={toggleSort} />
              <SortHeader label="Manpower" field="manpower" sortOf={sortOf} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {query.isLoading && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-muted-foreground">
                  로딩 중…
                </td>
              </tr>
            )}
            {!query.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="p-4 text-center text-muted-foreground">
                  데이터가 없습니다
                </td>
              </tr>
            )}
            {rows.map((r: any) => {
              const direct = directSet.get(r.contractor_name);
              const checked = !!selection[r.id];
              return (
                <tr
                  key={r.id}
                  className={`border-t hover:bg-muted/30 ${checked ? 'bg-primary/5' : ''}`}
                >
                  <td className="px-2 py-1">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) =>
                        setSelection((prev) => {
                          const next = { ...prev };
                          if (c) next[r.id] = true;
                          else delete next[r.id];
                          return next;
                        })
                      }
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-2 py-1">{r.report_date}</td>
                  <td className="px-2 py-1">{r.discipline}</td>
                  <td className="px-2 py-1">{r.system_name}</td>
                  <td className="px-2 py-1">{r.contractor_name}</td>
                  <td className="px-2 py-1">
                    {direct === true ? (
                      <Badge variant="secondary">직영</Badge>
                    ) : direct === false ? (
                      <Badge variant="outline">협력사</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1">{r.plot}</td>
                  <td className="px-2 py-1 capitalize">{r.metric}</td>
                  <td className="px-2 py-1 text-right font-medium">
                    {Number(r.manpower ?? 0).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedIds.length > 0 && (
        <DmrBulkEditBar
          selectedRows={selectedRows}
          canEdit={canEdit}
          onClearSelection={() => setSelection({})}
          onApplied={() => {
            setSelection({});
            qc.invalidateQueries({ queryKey: ['dmr_entries'] });
            qc.invalidateQueries({ queryKey: ['dmr_dashboard'] });
          }}
        />
      )}
    </div>
  );
}

function SortHeader({
  label,
  field,
  sortOf,
  onClick,
  align = 'left',
}: {
  label: string;
  field: SortField;
  sortOf: (f: SortField) => SortSpec | undefined;
  onClick: (f: SortField) => void;
  align?: 'left' | 'right';
}) {
  const s = sortOf(field);
  const Icon = !s ? ArrowUpDown : s.asc ? ArrowUp : ArrowDown;
  return (
    <th className={`px-2 py-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onClick(field)}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted ${
          s ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function ValueListFilter({
  label,
  options,
  value,
  onChange,
  badgeFor,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  badgeFor?: (v: string) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const t = q.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(t));
  }, [q, options]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 min-w-[140px] justify-between px-2 text-xs ${
            value.length ? 'border-primary text-foreground' : 'text-muted-foreground'
          }`}
        >
          <span className="flex items-center gap-1 truncate">
            <Filter className="h-3 w-3" />
            {value.length ? `${label} · ${value.length}` : label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="검색…"
            className="h-7 text-xs"
          />
          {value.length > 0 && (
            <button
              className="text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange([])}
            >
              전체 해제
            </button>
          )}
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              값이 없습니다
            </div>
          )}
          {filtered.map((opt) => {
            const checked = value.includes(opt);
            const badge = badgeFor?.(opt);
            return (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => {
                    if (c) onChange([...value, opt]);
                    else onChange(value.filter((x) => x !== opt));
                  }}
                  className="h-3.5 w-3.5"
                />
                <span className="flex-1 truncate">{opt}</span>
                {badge && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    {badge}
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}