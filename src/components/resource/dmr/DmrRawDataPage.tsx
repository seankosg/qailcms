import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, RotateCcw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUserViewPreference } from '@/hooks/useUserViewPreference';
import { useServerFn } from '@tanstack/react-start';
import { fetchDmrFilteredIds } from '@/lib/dmr-mutations.functions';
import {
  useDmrItemsQuery,
  useDmrContractorMaster,
  EMPTY_TOKEN,
  type DmrEntry,
  type DmrServerFilter,
} from '@/hooks/useDmrEntries';
import { DMR_COLUMNS, DMR_COLUMN_KEYS, DMR_COLUMN_BY_KEY, type DmrColumnDef } from '@/lib/dmr/columns';
import { DmrColumnFilterDropdown } from './DmrColumnFilterDropdown';
import { DmrColumnOrderMenu } from './DmrColumnOrderMenu';
import { DmrEditCellPopover } from './DmrEditCellPopover';
import { DmrBulkEditBar } from './DmrBulkEditBar';
import { exportDmrRawData } from '@/lib/dmr/export-dmr';
import { supabase } from '@/integrations/supabase/client';

// ── URL state helpers ────────────────────────────────────────────────────
function encodeState(v: unknown): string {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(v)))); } catch { return ''; }
}
function decodeState<T>(s: string, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as T; } catch { return fallback; }
}

// ── Filter conversion (TanStack ColumnFilters → server filters) ─────────
function toServerFilters(cf: ColumnFiltersState, byKey: Record<string, DmrColumnDef>): DmrServerFilter[] {
  const out: DmrServerFilter[] = [];
  for (const f of cf) {
    const col = byKey[f.id];
    if (!col) continue;
    const v = f.value as any;
    if (col.filterType === 'multi-select') {
      if (Array.isArray(v) && v.length) out.push({ column: f.id, op: f.id === 'direct_flag' ? 'direct_flag_in' : 'in', value: v });
    } else if (col.filterType === 'text') {
      if (v?.emptyOnly) out.push({ column: f.id, op: 'empty', value: null });
      else if (v?.text || typeof v === 'string') out.push({ column: f.id, op: 'text', value: v?.text ?? v });
    } else if (col.filterType === 'date-range') {
      if (v?.emptyOnly) out.push({ column: f.id, op: 'empty', value: null });
      else if (v?.from || v?.to) out.push({ column: f.id, op: 'date_range', value: { from: v.from, to: v.to } });
    } else if (col.filterType === 'number-range') {
      if (v?.min || v?.max) out.push({ column: f.id, op: 'num_range', value: { min: v.min, max: v.max } });
    }
  }
  return out;
}

function applyToSupabaseQuery(
  q: any,
  filters: DmrServerFilter[],
  sort: { column: string; desc: boolean }[],
  qtext: string,
  directMap: Map<string, boolean>,
) {
  if (qtext.trim()) {
    const t = qtext.trim();
    q = q.or(`system_name.ilike.%${t}%,contractor_name.ilike.%${t}%`);
  }
  const df = filters.find((f) => f.column === 'direct_flag');
  if (df) {
    const values: string[] = Array.isArray(df.value) ? df.value : [];
    if (values.length && values.length < 2) {
      const wantDirect = values.includes('direct');
      const names: string[] = [];
      directMap.forEach((isDirect, name) => { if (isDirect === wantDirect) names.push(name); });
      if (names.length === 0) q = q.eq('id', '00000000-0000-0000-0000-000000000000');
      else q = q.in('contractor_name', names);
    }
  }
  for (const f of filters) {
    if (f.column === 'direct_flag') continue;
    if (f.op === 'in') {
      const arr = (f.value as any[]).filter((v) => v !== EMPTY_TOKEN);
      if (arr.length) q = q.in(f.column, arr);
    } else if (f.op === 'empty') q = q.is(f.column, null);
    else if (f.op === 'text') { const t = String(f.value ?? '').trim(); if (t) q = q.ilike(f.column, `%${t}%`); }
    else if (f.op === 'date_range') { if (f.value.from) q = q.gte(f.column, f.value.from); if (f.value.to) q = q.lte(f.column, f.value.to); }
    else if (f.op === 'num_range') {
      if (f.value.min != null && f.value.min !== '') q = q.gte(f.column, Number(f.value.min));
      if (f.value.max != null && f.value.max !== '') q = q.lte(f.column, Number(f.value.max));
    }
  }
  if (sort.length === 0) {
    q = q.order('report_date', { ascending: false }).order('discipline', { ascending: true }).order('system_name', { ascending: true }).order('contractor_name', { ascending: true });
  } else {
    for (const s of sort) q = q.order(s.column, { ascending: !s.desc });
  }
  return q;
}

// ── Header cell with sort + filter ───────────────────────────────────────
function HeaderCell({ header, col }: { header: any; col: DmrColumnDef }) {
  const sortState = header.column.getIsSorted();
  const canSort = col.type !== 'enum' || col.key === 'discipline' || col.key === 'plot' || col.key === 'direct_flag';
  const Icon = sortState === 'asc' ? ArrowUp : sortState === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <div className="flex h-full w-full items-center gap-1 px-2">
      <button
        type="button"
        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
        className={cn(
          'inline-flex flex-1 items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-semibold',
          canSort && 'hover:bg-muted',
          col.align === 'right' && 'justify-end text-right',
        )}
      >
        <span className="truncate">{col.label}</span>
        {canSort && <Icon className={cn('h-3 w-3 shrink-0', !sortState && 'text-muted-foreground/40')} />}
      </button>
      <DmrColumnFilterDropdown column={header.column} />
      <div
        onMouseDown={header.getResizeHandler()}
        onTouchStart={header.getResizeHandler()}
        className={cn(
          'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none opacity-0 hover:opacity-100 bg-primary/40',
          header.column.getIsResizing() && 'opacity-100',
        )}
      />
    </div>
  );
}

// ── Cell renderer ────────────────────────────────────────────────────────
function CellRenderer({ row, col, canEdit, directMap }: { row: DmrEntry; col: DmrColumnDef; canEdit: boolean; directMap: Map<string, boolean> }) {
  let content: React.ReactNode = null;
  const v = (row as any)[col.key];
  if (col.key === 'direct_flag') {
    const d = directMap.get(row.contractor_name);
    content = d === true ? <Badge variant="secondary" className="h-4 px-1 text-[10px]">직영</Badge>
      : d === false ? <Badge variant="outline" className="h-4 px-1 text-[10px]">협력사</Badge>
      : <span className="text-muted-foreground/60">—</span>;
  } else if (col.key === 'diff_manpower') {
    const n = Number(v ?? 0);
    content = <span className={cn('tabular-nums', n > 0 ? 'text-emerald-600' : n < 0 ? 'text-red-600' : 'text-muted-foreground')}>{n > 0 ? '+' : ''}{n.toLocaleString()}</span>;
  } else if (col.type === 'number') {
    content = <span className="tabular-nums">{Number(v ?? 0).toLocaleString()}</span>;
  } else if (v == null || v === '') {
    content = <span className="text-muted-foreground/40">—</span>;
  } else {
    content = String(v);
  }

  if (col.editable && canEdit) {
    return (
      <DmrEditCellPopover rowId={row.id} column={col} value={v} canEdit={canEdit}>
        {content}
      </DmrEditCellPopover>
    );
  }
  return <>{content}</>;
}

// ── Main page ────────────────────────────────────────────────────────────
export function DmrRawDataPage() {
  const { data: me } = useCurrentUser();
  const canEdit = !!me?.canEdit || !!me?.isAdmin;
  const navigate = useNavigate({ from: '/resource/dmr/raw-data' });
  const search = useSearch({ from: '/_authenticated/resource/dmr/raw-data' });
  const fetchIds = useServerFn(fetchDmrFilteredIds);

  // URL-synced state
  const columnFilters: ColumnFiltersState = useMemo(
    () => decodeState(search.filters, [] as ColumnFiltersState),
    [search.filters],
  );
  const sorting: SortingState = useMemo(
    () => decodeState(search.sort, [] as SortingState),
    [search.sort],
  );
  const [qInput, setQInput] = useState(search.q ?? '');
  useEffect(() => setQInput(search.q ?? ''), [search.q]);

  const setColumnFilters = useCallback((updater: any) => {
    const next = typeof updater === 'function' ? updater(columnFilters) : updater;
    navigate({ to: '.', search: (prev: any) => ({ ...prev, filters: encodeState(next), page: 1 }) });
  }, [columnFilters, navigate]);
  const setSorting = useCallback((updater: any) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    navigate({ to: '.', search: (prev: any) => ({ ...prev, sort: encodeState(next) }) });
  }, [sorting, navigate]);
  const setPage = (page: number) => navigate({ to: '.', search: (prev: any) => ({ ...prev, page }) });
  const setPageSize = (pageSize: number) => navigate({ to: '.', search: (prev: any) => ({ ...prev, pageSize, page: 1 }) });
  const setQ = (q: string) => navigate({ to: '.', search: (prev: any) => ({ ...prev, q, page: 1 }) });

  // View preferences
  const { state: viewPref, ready: prefReady, save: savePref } = useUserViewPreference('dmr-raw-data');
  const [order, setOrder] = useState<string[]>(DMR_COLUMN_KEYS);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [frozenExtras, setFrozenExtras] = useState<string[]>([]);
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});
  const loadedPrefRef = useRef(false);
  useEffect(() => {
    if (!prefReady || loadedPrefRef.current) return;
    loadedPrefRef.current = true;
    if (viewPref) {
      const p: any = viewPref;
      if (Array.isArray(p.order)) setOrder([...new Set([...p.order, ...DMR_COLUMN_KEYS])].filter((k) => DMR_COLUMN_KEYS.includes(k)));
      if (p.visibility) setVisibility(p.visibility);
      if (Array.isArray(p.frozenExtras)) setFrozenExtras(p.frozenExtras);
      if (p.columnSizing) setColumnSizing(p.columnSizing);
    }
  }, [prefReady, viewPref]);
  const persistPref = useCallback((patch: Record<string, unknown>) => {
    savePref({ order, visibility, frozenExtras, columnSizing, ...patch } as any);
  }, [savePref, order, visibility, frozenExtras, columnSizing]);

  // Master data
  const { data: contractorMaster } = useDmrContractorMaster();
  const directMap = useMemo(() => {
    const m = new Map<string, boolean>();
    (contractorMaster ?? []).forEach((c) => m.set(c.name, !!c.is_direct));
    return m;
  }, [contractorMaster]);

  // Fetch data
  const serverFilters = useMemo(() => toServerFilters(columnFilters), [columnFilters]);
  const serverSort = useMemo(() => sorting.map((s) => ({ column: s.id, desc: !!s.desc })), [sorting]);
  const pageIndex = Math.max(1, Number(search.page ?? 1));
  const pageSize = Math.max(20, Number(search.pageSize ?? 100));

  const query = useDmrItemsQuery({
    q: qInput,
    filters: serverFilters,
    sort: serverSort,
    page: pageIndex,
    pageSize,
    directMap,
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Selection
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.entries(selection).filter(([, v]) => v).map(([k]) => k), [selection]);
  const selectedRows = useMemo(() => rows.filter((r) => selection[r.id]), [rows, selection]);
  const pageAllSelected = rows.length > 0 && rows.every((r) => selection[r.id]);
  const pageSomeSelected = !pageAllSelected && rows.some((r) => selection[r.id]);

  const togglePageAll = (c: boolean) => setSelection((prev) => {
    const next = { ...prev };
    for (const r of rows) { if (c) next[r.id] = true; else delete next[r.id]; }
    return next;
  });

  const selectAllFiltered = async () => {
    try {
      const disciplineF = serverFilters.find((f) => f.column === 'discipline' && f.op === 'in')?.value as string[] | undefined;
      const plotF = serverFilters.find((f) => f.column === 'plot' && f.op === 'in')?.value as string[] | undefined;
      const systemsF = serverFilters.find((f) => f.column === 'system_name' && f.op === 'in')?.value as string[] | undefined;
      const contractorsF = serverFilters.find((f) => f.column === 'contractor_name' && f.op === 'in')?.value as string[] | undefined;
      const dateF = serverFilters.find((f) => f.column === 'report_date' && f.op === 'date_range')?.value as any;
      const directF = serverFilters.find((f) => f.column === 'direct_flag')?.value as string[] | undefined;
      const res = await fetchIds({
        data: {
          discipline: disciplineF?.length === 1 ? disciplineF[0] : 'all',
          plot: plotF?.length === 1 ? plotF[0] : 'all',
          systems: systemsF ?? [],
          contractors: contractorsF ?? [],
          fromDate: dateF?.from ?? null,
          toDate: dateF?.to ?? null,
          q: qInput.trim() || null,
          directOnly: (directF ?? []) as ('direct' | 'sub')[],
        },
      });
      const next: Record<string, boolean> = {};
      for (const id of res.ids) next[id] = true;
      setSelection(next);
      toast.success('전체 선택', { description: `${res.ids.length.toLocaleString()}건` });
    } catch (e: any) {
      toast.error('전체 선택 실패', { description: e?.message ?? String(e) });
    }
  };

  // TanStack Table setup
  const columns = useMemo<ColumnDef<DmrEntry>[]>(() => {
    const selectCol: ColumnDef<DmrEntry> = {
      id: '__select',
      size: 34,
      minSize: 34,
      maxSize: 34,
      enableResizing: false,
      header: () => (
        <div className="flex h-full items-center justify-center">
          <Checkbox
            checked={pageAllSelected ? true : pageSomeSelected ? 'indeterminate' : false}
            onCheckedChange={(c) => togglePageAll(!!c)}
            className="h-3.5 w-3.5"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex h-full items-center justify-center">
          <Checkbox
            checked={!!selection[row.original.id]}
            onCheckedChange={(c) => setSelection((prev) => {
              const next = { ...prev };
              if (c) next[row.original.id] = true; else delete next[row.original.id];
              return next;
            })}
            className="h-3.5 w-3.5"
          />
        </div>
      ),
    };
    const dataCols: ColumnDef<DmrEntry>[] = order.map((k) => {
      const c = DMR_COLUMN_BY_KEY[k];
      if (!c) return null as any;
      return {
        id: k,
        accessorKey: k,
        size: columnSizing[k] ?? c.width,
        minSize: 60,
        enableSorting: !c.derived || k === 'diff_manpower',
        enableColumnFilter: true,
        meta: {
          filterType: c.filterType,
          filterOptions: (c.enumOptions ?? []).map((v) => ({ value: v, label: v })),
          serverFacet: c.serverFacet,
        },
        header: ({ header }) => <HeaderCell header={header} col={c} />,
        cell: ({ row }) => <CellRenderer row={row.original} col={c} canEdit={canEdit} directMap={directMap} />,
      } as ColumnDef<DmrEntry>;
    }).filter(Boolean);
    return [selectCol, ...dataCols];
  }, [order, columnSizing, canEdit, directMap, selection, pageAllSelected, pageSomeSelected, rows]);

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility: visibility,
      columnSizing,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? (updater as any)(visibility) : updater;
      setVisibility(next); persistPref({ visibility: next });
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? (updater as any)(columnSizing) : updater;
      setColumnSizing(next); persistPref({ columnSizing: next });
    },
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    columnResizeMode: 'onEnd', // Tier1 #6: unify resize mode across raw-data tables
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });

  // Sticky column offsets: __select + frozenExtras (in current order)
  const stickyKeys = useMemo(() => ['__select', ...frozenExtras.filter((k) => order.includes(k))], [frozenExtras, order]);
  const stickyOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    for (const k of stickyKeys) {
      offsets[k] = acc;
      const size = k === '__select' ? 34 : (columnSizing[k] ?? DMR_COLUMN_BY_KEY[k]?.width ?? 120);
      acc += size;
    }
    return offsets;
  }, [stickyKeys, columnSizing]);

  const visibleHeaders = table.getFlatHeaders();
  // Reorder headers so sticky keys come first
  const orderedHeaders = useMemo(() => {
    const map = new Map(visibleHeaders.map((h) => [h.column.id, h]));
    const out: typeof visibleHeaders = [];
    for (const k of stickyKeys) { const h = map.get(k); if (h) out.push(h); }
    for (const h of visibleHeaders) { if (!stickyKeys.includes(h.column.id)) out.push(h); }
    return out;
  }, [visibleHeaders, stickyKeys]);

  const totalWidth = orderedHeaders.reduce((a, h) => a + h.getSize(), 0);

  // Summary
  const sumPlan = rows.reduce((a, r) => a + (r.plan_manpower ?? 0), 0);
  const sumActual = rows.reduce((a, r) => a + (r.actual_manpower ?? 0), 0);
  const sumDiff = sumActual - sumPlan;

  const resetFilters = () => {
    setColumnFilters([]);
    setQ('');
  };

  const anyFilterActive = columnFilters.length > 0 || (qInput ?? '').trim().length > 0;

  // Export
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const visibleKeys = order.filter((k) => visibility[k] !== false);
      const summary = {
        filters: columnFilters.map((f) => `${DMR_COLUMN_BY_KEY[f.id]?.label ?? f.id}=${JSON.stringify(f.value)}`).join(', ') || '—',
        sort: sorting.map((s) => `${DMR_COLUMN_BY_KEY[s.id]?.label ?? s.id} ${s.desc ? 'DESC' : 'ASC'}`).join(', ') || 'default',
      };
      await exportDmrRawData({
        visibleKeys,
        directMap,
        applyFiltersToQuery: (q) => applyToSupabaseQuery(q, serverFilters, [], qInput, directMap),
        applySortToQuery: (q) => {
          for (const s of serverSort) q = q.order(s.column, { ascending: !s.desc });
          if (serverSort.length === 0) q = q.order('report_date', { ascending: false });
          return q;
        },
        summary,
      });
      toast.success('Excel export 완료');
    } catch (e: any) {
      toast.error('Export 실패', { description: e?.message ?? String(e) });
    } finally { setExporting(false); }
  };

  return (
    <div className="flex h-full flex-col space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">DMR Raw Data</h1>
          <p className="text-xs text-muted-foreground">일자별·TEAM별·협력사별 인원 실적 (롱포맷)</p>
        </div>
        <div className="flex items-center gap-2">
          <DmrColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            onOrderChange={(o) => { setOrder(o); persistPref({ order: o }); }}
            onVisibilityChange={(v) => { setVisibility(v); persistPref({ visibility: v }); }}
            onFrozenChange={(f) => { setFrozenExtras(f); persistPref({ frozenExtras: f }); }}
            onSaveLayout={() => {
              persistPref({});
              toast.success('컬럼 설정을 저장했습니다');
            }}
          />
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link to="/import-log/import" search={{ tab: "dmr" }}><Upload className="mr-1 h-3.5 w-3.5" />Import</Link>
            </Button>
          )}
          <Button size="sm" onClick={doExport} disabled={exporting || total === 0}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Export {exporting ? '…' : ''}
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onBlur={() => qInput !== search.q && setQ(qInput)}
          onKeyDown={(e) => { if (e.key === 'Enter') setQ(qInput); }}
          placeholder="Work Description / Sub Contractor 검색…"
          className="h-8 w-full text-xs sm:w-64"
        />
        {anyFilterActive && (
          <Button size="sm" variant="ghost" className="h-8" onClick={resetFilters}>
            <RotateCcw className="mr-1 h-3 w-3" />필터 초기화
          </Button>
        )}
        <div className="ml-auto flex flex-col text-right">
          <span className="text-[11px] text-muted-foreground">Rows · Plan / Actual / Δ</span>
          <span className="text-sm font-semibold">
            {rows.length.toLocaleString()}{total > rows.length && ` / ${total.toLocaleString()}`} ·{' '}
            <span className="text-muted-foreground">{sumPlan.toLocaleString()}</span> /{' '}
            <span>{sumActual.toLocaleString()}</span> /{' '}
            <span className={sumDiff > 0 ? 'text-emerald-600' : sumDiff < 0 ? 'text-red-600' : 'text-muted-foreground'}>
              {sumDiff > 0 ? '+' : ''}{sumDiff.toLocaleString()}
            </span>
          </span>
        </div>
      </div>

      {total > rows.length && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>현재 페이지 {rows.length.toLocaleString()}행 · 총 {total.toLocaleString()}건</span>
          <button className="text-primary underline-offset-2 hover:underline" onClick={selectAllFiltered}>
            필터된 전체 {total.toLocaleString()}건 선택
          </button>
        </div>
      )}

      {selectedIds.length > 0 && (
        <DmrBulkEditBar
          selectedIds={selectedIds}
          sampleRows={selectedRows}
          canEdit={canEdit}
          onClearSelection={() => setSelection({})}
          onApplied={() => { setSelection({}); query.refetch(); }}
        />
      )}

      <div className="flex items-center justify-between rounded-md border p-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Rows per page:</span>
          <select className="h-7 rounded border bg-background px-2" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Page {pageIndex} / {totalPages}</span>
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={pageIndex <= 1} onClick={() => setPage(1)}>«</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={pageIndex <= 1} onClick={() => setPage(pageIndex - 1)}>‹</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={pageIndex >= totalPages} onClick={() => setPage(pageIndex + 1)}>›</Button>
          <Button size="sm" variant="outline" className="h-7 px-2" disabled={pageIndex >= totalPages} onClick={() => setPage(totalPages)}>»</Button>
        </div>
      </div>

      {/* Table */}
      <div ref={parentRef} className="relative flex-1 overflow-auto rounded-md border">
        <div style={{ width: totalWidth, minWidth: '100%' }} className="relative">
          {/* Header */}
          <div className="sticky top-0 z-30 flex h-9 border-b bg-muted/60 backdrop-blur">
            {orderedHeaders.map((h) => {
              const isSticky = stickyKeys.includes(h.column.id);
              const size = h.getSize();
              const col = DMR_COLUMN_BY_KEY[h.column.id];
              return (
                <div
                  key={h.id}
                  className={cn(
                    'relative flex h-full items-center border-r text-xs',
                    isSticky && 'sticky z-30 bg-muted',
                  )}
                  style={{ width: size, minWidth: size, left: isSticky ? stickyOffsets[h.column.id] : undefined }}
                >
                  {h.column.id === '__select' ? flexRender(h.column.columnDef.header, h.getContext()) :
                    col ? <HeaderCell header={h} col={col} /> : null}
                </div>
              );
            })}
          </div>
          {/* Rows */}
          {query.isLoading && <div className="p-6 text-center text-xs text-muted-foreground">로딩 중…</div>}
          {!query.isLoading && rows.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">데이터가 없습니다</div>}
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((v) => {
              const row = table.getRowModel().rows[v.index];
              if (!row) return null;
              const selected = !!selection[row.original.id];
              return (
                <div
                  key={row.id}
                  data-index={v.index}
                  ref={virt.measureElement}
                  className={cn('absolute left-0 right-0 flex border-b hover:bg-muted/30', selected && 'bg-primary/5')}
                  style={{ transform: `translateY(${v.start}px)`, height: 30, width: totalWidth }}
                >
                  {orderedHeaders.map((h) => {
                    const cell = row.getAllCells().find((c) => c.column.id === h.column.id);
                    if (!cell) return null;
                    const isSticky = stickyKeys.includes(h.column.id);
                    const size = h.getSize();
                    return (
                      <div
                        key={cell.id}
                        className={cn(
                          'flex items-center overflow-hidden border-r px-2 text-xs',
                          isSticky && 'sticky z-20 bg-background',
                          selected && isSticky && 'bg-primary/5',
                          DMR_COLUMN_BY_KEY[h.column.id]?.align === 'right' && 'justify-end',
                        )}
                        style={{ width: size, minWidth: size, left: isSticky ? stickyOffsets[h.column.id] : undefined }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>


    </div>
  );
}

// avoid unused-import lint for supabase (kept for possible extension)
export const __unused_supabase = supabase;