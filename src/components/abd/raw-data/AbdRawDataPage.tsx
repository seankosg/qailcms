import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Route as AbdRawDataRoute } from "@/routes/_authenticated/closure/abd/raw-data";
import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search, RefreshCcw, Upload, Filter, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  ABD_COLUMNS,
  ABD_STATUSES,
  PLOT_COLORS,
  STATUS_COLORS,
  type AbdColumnDef,
} from "@/lib/abd/columns";
import {
  useAbdItemsQuery,
  useAbdCounts,
  useInvalidateAbd,
  type AbdItem,
  type AbdServerFilter,
  type AbdServerSort,
  type AbdStatusGroup,
  type AbdTeam,
} from "@/hooks/useAbdItems";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTeamOptions } from "@/lib/team/team-master";
import { canEditRawRow } from "@/lib/auth/roles";
import { EMPTY_TOKEN, DATE_FILTER_FIELDS } from "@/lib/abd/filter-fns";
import { getOriginHeaderStyle } from "@/lib/abd/origin-header-style";
import { AbdColumnFilterDropdown } from "./AbdColumnFilterDropdowns";
import { TopHorizontalScrollbar } from "@/components/defect-management/raw-data/TopHorizontalScrollbar";
import { AbdEditCellPopover } from "./AbdEditCellPopover";
import { AbdExportDialog } from "./AbdExportDialog";
import { AbdDetailSheet } from "./AbdDetailSheet";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import { AbdColumnOrderMenu } from "./AbdColumnOrderMenu";
import {
  useAbdDefaults,
  useAbdFieldHelpers,
  useInvalidateAbdFieldConfig,
  persistAbdFieldConfig,
} from "@/hooks/useAbdFieldConfig";
import { toast } from "sonner";

const SYSTEM_FROZEN_IDS: string[] = [];
const DEFAULT_ORDER = ABD_COLUMNS.map((c) => c.key);
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

function parseSortFromUrl(s: string): SortingState {
  if (!s) return [{ id: "sl_no", desc: false }];
  try {
    return s.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [id, dir] = p.split(":");
      return { id, desc: (dir ?? "asc").toLowerCase() === "desc" };
    });
  } catch { return [{ id: "sl_no", desc: false }]; }
}
function serializeSort(s: SortingState): string {
  return s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",");
}
function parseFiltersFromUrl(s: string): ColumnFiltersState {
  if (!s) return [];
  try {
    const obj = JSON.parse(s);
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj).map(([id, value]) => ({ id, value }));
  } catch { return []; }
}
function serializeFilters(f: ColumnFiltersState): string {
  if (!f.length) return "";
  const obj: Record<string, any> = {};
  for (const x of f) obj[x.id] = x.value;
  return JSON.stringify(obj);
}

function toServerFilters(f: ColumnFiltersState): AbdServerFilter[] {
  const out: AbdServerFilter[] = [];
  for (const cf of f) {
    const id = cf.id;
    const v: any = cf.value;
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      const hasEmpty = v.includes(EMPTY_TOKEN);
      const rest = v.filter((x) => x !== EMPTY_TOKEN);
      if (rest.length > 0) out.push({ column: id, op: hasEmpty ? "in_or_empty" : "in", value: rest });
      if (hasEmpty && rest.length === 0) out.push({ column: id, op: "empty", value: null });
      continue;
    }
    if (typeof v === "object") {
      if (v.emptyOnly) { out.push({ column: id, op: "empty", value: null }); continue; }
      if (DATE_FILTER_FIELDS.has(id) && (v.from || v.to)) {
        out.push({ column: id, op: "date_range", value: { from: v.from ?? "", to: v.to ?? "" } });
        continue;
      }
      if (typeof v.text === "string" && v.text.trim()) {
        out.push({ column: id, op: "text", value: v.text.trim() });
      }
    }
  }
  return out;
}

function toServerSort(s: SortingState): AbdServerSort[] {
  return s.map((x) => ({ column: x.id, desc: !!x.desc }));
}

function formatDdMmm(v: any): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en", { month: "short" })}-${String(d.getFullYear()).slice(2)}`;
}


const STATUS_TABS: { value: AbdStatusGroup; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved (A)" },
  { value: "in_progress", label: "In Progress" },
  { value: "not_started", label: "Not Started" },
];

export function AbdRawDataPage() {
  const navigate = useNavigate();
  const urlSearch = AbdRawDataRoute.useSearch();
  const { data: user } = useCurrentUser();
  const isAdmin = !!user?.isAdmin;
  const { data: teamOptions = [] } = useTeamOptions();
  const canEditRow = useCallback(
    (row: AbdItem) => canEditRawRow(user ?? null, "abd_items_raw", row as unknown as Record<string, any>),
    [user],
  );
  const invalidate = useInvalidateAbd();

  // team_master 기반 동적 탭. 미매칭 시 첫 옵션 폴백.
  const teamTabs = useMemo(
    () => teamOptions.map((t) => ({ value: t.code, label: t.code })),
    [teamOptions],
  );
  const rawTab = String(urlSearch.tab ?? "").toUpperCase();
  const matchedTeam = teamOptions.find((t) => t.code.toUpperCase() === rawTab);
  const team: AbdTeam = ((matchedTeam?.code ?? teamOptions[0]?.code ?? "MECH") as unknown) as AbdTeam;
  const statusGroup: AbdStatusGroup = (["all", "approved", "in_progress", "not_started"].includes(urlSearch.status ?? "") ? urlSearch.status : "all") as AbdStatusGroup;
  // 비활성 레코드는 항상 제외 (관리자 페이지에서 별도 관리 예정)
  const includeInactive = false;
  const page = Math.max(1, Number(urlSearch.page) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(urlSearch.pageSize)) ? Number(urlSearch.pageSize) : 100;

  const viewPref = useUserViewPreference(`abd.raw-data.${team}.v1`);
  const { defaultOrder: cfgDefaultOrder, defaultVisibility: cfgDefaultVisibility } = useAbdDefaults();
  const { getLabel: labelOf } = useAbdFieldHelpers();
  const invalidateFieldConfig = useInvalidateAbdFieldConfig();

  const onServerReorder = useCallback(async (patches: Array<{ field_key: string; sort_order: number }>) => {
    if (!isAdmin) return;
    try {
      await persistAbdFieldConfig(patches);
      invalidateFieldConfig();
    } catch (e: any) {
      toast.error(`컬럼 순서 저장 실패: ${e?.message ?? e}`);
    }
  }, [isAdmin, invalidateFieldConfig]);

  const onServerVisibility = useCallback(async (field_key: string, visible: boolean) => {
    if (!isAdmin) return;
    try {
      await persistAbdFieldConfig([{ field_key, visible }]);
      invalidateFieldConfig();
    } catch (e: any) {
      toast.error(`컬럼 노출 저장 실패: ${e?.message ?? e}`);
    }
  }, [isAdmin, invalidateFieldConfig]);

  const onServerLabel = useCallback(async (field_key: string, label: string) => {
    if (!isAdmin) return;
    try {
      await persistAbdFieldConfig([{ field_key, label }]);
      invalidateFieldConfig();
      toast.success(`라벨 저장됨: ${label}`);
    } catch (e: any) {
      toast.error(`라벨 저장 실패: ${e?.message ?? e}`);
    }
  }, [isAdmin, invalidateFieldConfig]);

  const tableRef = useRef<HTMLDivElement | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [sorting, setSorting] = useState<SortingState>(parseSortFromUrl(urlSearch.sort));
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(parseFiltersFromUrl(urlSearch.filters));
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [searchInput, setSearchInput] = useState(urlSearch.q ?? "");
  const [exportOpen, setExportOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [frozenExtras, setFrozenExtras] = useState<string[]>([]);

  useEffect(() => {
    setSorting(parseSortFromUrl(urlSearch.sort));
    setColumnFilters(parseFiltersFromUrl(urlSearch.filters));
    setSearchInput(urlSearch.q ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  const serverFilters = useMemo(() => toServerFilters(columnFilters), [columnFilters]);
  const serverSort = useMemo(() => toServerSort(sorting), [sorting]);
  const q = (urlSearch.q ?? "").trim();

  const { data: itemsData, isFetching, refetch } = useAbdItemsQuery({
    team, statusGroup, includeInactive, q, filters: serverFilters, sort: serverSort, page, pageSize,
  });
  const rows = itemsData?.rows ?? [];
  const total = itemsData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const { data: counts } = useAbdCounts({ team, includeInactive });
  const dataDate = counts?.latest_data_date ?? null;

  // Restore view preferences
  useEffect(() => {
    if (!viewPref.ready) return;
    setStateLoaded(false);
    const s: any = viewPref.state ?? null;
    let baseSizing: ColumnSizingState = {};
    let baseOrder: string[] = DEFAULT_ORDER;
    let baseVisibility: VisibilityState = {};
    let baseFrozen: string[] = [];
    if (s && typeof s === "object") {
      baseSizing = s.columnSizing && typeof s.columnSizing === "object" ? s.columnSizing : {};
      const valid = new Set(DEFAULT_ORDER);
      const savedOrder: string[] = Array.isArray(s.order) ? s.order.filter((k: any) => typeof k === "string" && valid.has(k)) : [];
      if (savedOrder.length) {
        const savedSet = new Set(savedOrder);
        const merged = [...savedOrder];
        DEFAULT_ORDER.forEach((k, defIdx) => {
          if (savedSet.has(k)) return;
          let insertAt = merged.length;
          for (let i = defIdx - 1; i >= 0; i--) {
            const prev = DEFAULT_ORDER[i];
            const idx = merged.indexOf(prev);
            if (idx !== -1) { insertAt = idx + 1; break; }
          }
          merged.splice(insertAt, 0, k);
        });
        baseOrder = merged;
      }
      if (s.visibility && typeof s.visibility === "object") {
        for (const [k, v] of Object.entries(s.visibility)) if (valid.has(k)) baseVisibility[k] = !!v;
      }
      if (Array.isArray(s.frozenExtras)) {
        baseFrozen = s.frozenExtras.filter((k: any) => typeof k === "string" && valid.has(k));
      }
    }
    setColumnSizing(baseSizing);
    setOrder(baseOrder);
    setVisibility(baseVisibility);
    setFrozenExtras(baseFrozen);
    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPref.ready, team]);

  useEffect(() => {
    if (!stateLoaded) return;
    viewPref.save({ columnSizing, order, visibility, frozenExtras } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, columnSizing, order, visibility, frozenExtras]);

  const setUrl = useCallback((patch: Record<string, any>) => {
    navigate({
      to: ".",
      search: (prev: any) => {
        const next = { ...prev, ...patch };
        for (const key of Object.keys(next)) if (next[key] == null || next[key] === "") delete next[key];
        return next;
      },
      replace: true,
    });
  }, [navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((urlSearch.q ?? "") !== searchInput) setUrl({ q: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, urlSearch.q, setUrl]);

  useEffect(() => {
    if (!stateLoaded) return;
    const nextSort = serializeSort(sorting);
    const nextFilters = serializeFilters(columnFilters);
    if (nextSort !== (urlSearch.sort ?? "") || nextFilters !== (urlSearch.filters ?? "")) {
      setUrl({ sort: nextSort, filters: nextFilters, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, columnFilters, stateLoaded]);

  const orderedKeys = useMemo(() => {
    const frozenSet = new Set(frozenExtras);
    const rest = order.filter((k) => !frozenSet.has(k));
    return [...frozenExtras, ...rest];
  }, [order, frozenExtras]);

  const columns = useMemo<ColumnDef<AbdItem>[]>(() => {
    const byKey = new Map(ABD_COLUMNS.map((c) => [c.key, c] as const));
    const cols: ColumnDef<AbdItem>[] = [];
    for (const id of orderedKeys) {
      const c = byKey.get(id);
      if (!c) continue;
      cols.push(buildDataColumn(c, team, statusGroup, includeInactive, canEditRow, () => refetch()));
    }
    return cols;
  }, [orderedKeys, team, statusGroup, includeInactive, canEditRow, refetch]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = {};
    for (const c of columns) {
      const id = (c as any).id ?? (c as any).accessorKey;
      if (!id || id in vis) continue;
      if (id in visibility) { vis[id] = visibility[id] !== false; continue; }
      vis[id] = true;
    }
    return vis;
  }, [columns, visibility]);

  const table = useReactTable<AbdItem>({
    data: rows,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    enableColumnResizing: true,
    columnResizeMode: "onEnd",
    enableMultiSort: true,
    enableSortingRemoval: true,
    isMultiSortEvent: (event) => (event as unknown as MouseEvent).shiftKey,
    maxMultiSortColCount: 5,
    defaultColumn: { minSize: 50, maxSize: 640 },
    getRowId: (r) => r.id,
  });

  const activeChips = useMemo(() => {
    const chips: { id: string; label: string; onClear: () => void }[] = [];
    for (const f of columnFilters) {
      const col = table.getColumn(f.id);
      if (!col) continue;
      const label = String((col.columnDef.header as any) ?? f.id);
      const v = f.value as any;
      let text = "";
      if (Array.isArray(v)) text = v.map((x) => (x === EMPTY_TOKEN ? "(Empty)" : x)).join(", ");
      else if (v && typeof v === "object") {
        if (v.emptyOnly) text = "(Empty)";
        else if (v.text) text = v.text;
        else if (v.from || v.to) text = `${v.from ?? ""} ~ ${v.to ?? ""}`;
      }
      chips.push({ id: f.id, label: `${label}: ${text}`, onClear: () => col.setFilterValue(undefined) });
    }
    return chips;
  }, [columnFilters, table]);

  const totalCount = counts?.total_count ?? 0;
  const approvedCount = counts?.approved_count ?? 0;
  const inProgressCount = counts?.in_progress_count ?? 0;
  const notStartedCount = counts?.not_started_count ?? 0;

  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ABD Raw Data</h1>
          <p className="text-sm text-muted-foreground">As-Built Drawing 제출 계획 관리 · 최근 데이터: {dataDate ?? "—"}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/import-log/import" search={{ tab: "abd" }}><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <AbdColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            defaultOrder={cfgDefaultOrder}
            defaultVisibility={cfgDefaultVisibility}
            onOrderChange={setOrder}
            onVisibilityChange={(v) => setVisibility(v)}
            onFrozenChange={setFrozenExtras}
            isAdmin={isAdmin}
            onServerReorder={onServerReorder}
            onServerVisibility={onServerVisibility}
            onServerLabel={onServerLabel}
          />
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1.5 h-3.5 w-3.5" /> Export</Button>
          <Button variant="outline" size="sm" onClick={() => { invalidate(); refetch(); }} disabled={isFetching}>
            <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      <Tabs value={team} onValueChange={(v) => setUrl({ tab: v, page: 1 })}>
        <TabsList className="h-9">
          {teamTabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={statusGroup} onValueChange={(v) => setUrl({ status: v, page: 1 })}>
          <TabsList className="h-8">
            {STATUS_TABS.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="text-[11px]">
                {s.label}
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {s.value === "all" ? totalCount : s.value === "approved" ? approvedCount : s.value === "in_progress" ? inProgressCount : notStartedCount}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Active filters:</span>
          {activeChips.map((c) => (
            <button key={c.id} onClick={c.onClear} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80" title="Click to remove">
              {c.label} ✕
            </button>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setColumnFilters([])}>Clear all</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ABD 번호 · 제목 · PIC ... (comma = AND)" className="h-9 pl-8" />
        </div>
        <span className="self-center text-sm text-muted-foreground">{total.toLocaleString()} records</span>
        {sorting.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setSorting([{ id: "sl_no", desc: false }])}>Clear sort ({sorting.length})</Button>
        )}
        <span className="hidden self-center text-xs text-muted-foreground md:inline">Tip: Shift+Click 다중 정렬 · <Filter className="inline h-3 w-3" /> 컬럼 필터</span>
      </div>

      <AbdRawTableView
        table={table}
        tableRef={tableRef}
        loading={!stateLoaded || isFetching}
        frozenColIds={frozenExtras}
        onRowClick={(id) => setUrl({ detail: id })}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground">
          {total > 0 ? `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} / ${total.toLocaleString()}` : "0 / 0"}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">페이지 크기</span>
          <Select value={String(pageSize)} onValueChange={(v) => setUrl({ pageSize: Number(v), page: 1 })}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: 1 })}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: page - 1 })}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <span className="tabular-nums">{page} / {pageCount}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: page + 1 })}><ChevronRight className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: pageCount })}><ChevronsRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <AbdExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getRows={() => rows}
        columnHeaders={ABD_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
        filenamePrefix={`abd-${team}`}
      />
      <AbdDetailSheet
        id={(urlSearch.detail as string) || null}
        onOpenChange={(open) => { if (!open) setUrl({ detail: "" }); }}
      />
    </div>
  );
}

// ── Column builder ────────────────────────────────────────────────────
function buildDataColumn(
  c: AbdColumnDef,
  team: AbdTeam,
  statusGroup: AbdStatusGroup,
  includeInactive: boolean,
  canEditRow: (row: AbdItem) => boolean,
  refetch: () => void,
): ColumnDef<AbdItem> {
  const filterType =
    DATE_FILTER_FIELDS.has(c.key) ? "date-range" :
    "multi-select";
  const serverFacet = c.key;
  const filterOptions = c.key === "latest_status" ? ABD_STATUSES.map((s) => ({ value: s, label: s })) :
    c.key === "plot" ? [{ value: "C", label: "C" }, { value: "D", label: "D" }] :
    c.key === "is_active" ? [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }] :
    [];
  return {
    id: c.key,
    accessorKey: c.key,
    header: c.label,
    size: c.width,
    enableSorting: true,
    meta: { filterType, filterOptions, serverFacet, team, statusGroup, includeInactive, origin: c.origin ?? "system" },
    cell: ({ row, getValue }) => {
      const v: any = getValue();
      const display = renderAbdCell(c, v, row.original);
      if (c.editable && c.editorType && canEditRow(row.original)) {
        return (
          <AbdEditCellPopover
            id={row.original.id}
            field={c.key}
            label={c.label}
            editorType={c.editorType}
            options={c.options}
            currentValue={v}
            onSaved={() => refetch()}
          >{display}</AbdEditCellPopover>
        );
      }
      return display;
    },
  };
}

function renderAbdCell(c: AbdColumnDef, v: any, row: AbdItem): React.ReactNode {
  if (v == null || v === "") return <span className="text-muted-foreground/50">—</span>;
  if (c.key === "plot") return <Badge className={cn("text-[10px]", PLOT_COLORS[String(v)] ?? "bg-zinc-500/15 text-zinc-700")}>{String(v)}</Badge>;
  if (c.key === "latest_status") {
    const key = String(v).toUpperCase();
    return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS_COLORS[key] ?? "bg-zinc-500/15 text-zinc-700")}>{v}</span>;
  }
  if (c.key === "is_active") return v ? <Badge variant="secondary" className="text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>;
  if (c.type === "date") return <span className="tabular-nums text-xs">{formatDdMmm(v)}</span>;
  if (c.type === "number") return <span className="tabular-nums text-xs">{String(v)}</span>;
  return <span className="text-xs">{String(v)}</span>;
}

// ── Table view ─────────────────────────────────────────────────────────
interface TableViewProps {
  table: ReturnType<typeof useReactTable<AbdItem>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  frozenColIds: string[];
  onRowClick?: (id: string) => void;
}

function AbdRawTableView({ table, tableRef, loading, frozenColIds, onRowClick }: TableViewProps) {
  const leaf = table.getVisibleLeafColumns();
  const frozenSet = useMemo(() => new Set(frozenColIds), [frozenColIds]);
  const { stickyLefts, lastFrozenIndex, frozenWidth } = useMemo(() => {
    const lefts = new Map<string, number>();
    let acc = 0; let lastIdx = -1;
    for (let i = 0; i < leaf.length; i++) {
      const c = leaf[i];
      if (!frozenSet.has(c.id)) continue;
      lefts.set(c.id, acc);
      acc += c.getSize();
      lastIdx = i;
    }
    return { stickyLefts: lefts, lastFrozenIndex: lastIdx, frozenWidth: acc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaf, frozenSet, table.getState().columnSizing]);
  const totalWidth = useMemo(() => leaf.reduce((s, c) => s + c.getSize(), 0), [leaf, table.getState().columnSizing]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowsModel = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rowsModel.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });
  const vRows = rowVirtualizer.getVirtualItems();
  const paddingTop = vRows.length > 0 ? vRows[0].start : 0;
  const paddingBottom = vRows.length > 0 ? rowVirtualizer.getTotalSize() - vRows[vRows.length - 1].end : 0;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const stickyBg = (row: AbdItem, index: number): string => {
    const inactive = !row.is_active;
    const approved = row.status_group === "approved" || String(row.latest_status ?? "").toUpperCase() === "A";
    // 스티키 컬럼은 항상 완전 불투명이어야 스크롤 시 뒤 컬럼이 비쳐 보이지 않는다.
    // 주의:
    //  - 프로젝트 컬러 토큰은 oklch(...) 리터럴이므로 hsl(var(--token)) 래핑은 무효값이 되어 painting 되지 않는다. var(--token) 을 그대로 사용.
    //  - `background: <color>, linear-gradient(...)` 다중 레이어 문법은 첫 레이어가 <bg-image> 여야 유효하므로,
    //    color-mix() 결과를 그냥 나열하면 declaration 전체가 무효가 된다. 단일 색상 값으로 반환한다.
    //  - 두 operand 모두 완전 불투명이므로 color-mix 결과도 완전 불투명이다.
    if (hoveredIndex === index)
      return "color-mix(in oklab, var(--muted) 95%, var(--background))";
    if (inactive)
      return "color-mix(in oklab, var(--muted) 45%, var(--background))";
    if (approved)
      return "color-mix(in oklab, var(--muted) 55%, var(--background))";
    return "var(--background)";
  };

  return (
    <div className="flex max-h-[calc(100vh-280px)] flex-col overflow-hidden rounded-md border bg-background">
      <TopHorizontalScrollbar targetRef={tableRef} width={totalWidth} frozenWidth={frozenWidth} />
      <div ref={tableRef} className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <Table style={{ width: totalWidth, tableLayout: "fixed" }}>
          <TableHeader className="bg-background">
            <TableRow className="border-b bg-background [&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:bg-background">
              {table.getHeaderGroups().at(-1)?.headers.map((header, i) => {
                const isSticky = frozenSet.has(header.column.id);
                const leftPx = isSticky ? stickyLefts.get(header.column.id) ?? 0 : undefined;
                const isLastFrozen = i === lastFrozenIndex;
                const originStyle = getOriginHeaderStyle((header.column.columnDef.meta as any)?.origin);
                return (
                  <TableHead
                    key={header.id}
                    data-column-id={header.column.id}
                    title={typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id}
                    style={{
                      width: header.getSize(), minWidth: header.getSize(), maxWidth: header.getSize(),
                      ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 3, background: originStyle.stickyBg } : {}),
                    }}
                    className={cn("relative h-9 cursor-pointer select-none whitespace-nowrap border-b px-3 py-0 text-left text-xs font-medium",
                      !isSticky && (originStyle.bg || "bg-background"), originStyle.border,
                      isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        {header.column.getIsSorted() && <span className="flex-shrink-0">{header.column.getIsSorted() === "asc" ? "▲" : "▼"}</span>}
                      </span>
                      {header.column.getCanFilter() && (
                        <span onClick={(e) => e.stopPropagation()}><AbdColumnFilterDropdown column={header.column} /></span>
                      )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        className={cn("absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40",
                          header.column.getIsResizing() && "bg-primary/60")}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={leaf.length} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : rowsModel.length === 0 ? (
              <TableRow><TableCell colSpan={leaf.length} className="py-8 text-center text-muted-foreground">데이터가 없습니다. Import 페이지에서 Excel을 업로드하세요.</TableCell></TableRow>
            ) : (
              <>
                {paddingTop > 0 && <tr style={{ height: paddingTop }} aria-hidden><td colSpan={leaf.length} style={{ padding: 0, border: 0 }} /></tr>}
                {vRows.map((vr) => {
                  const row = rowsModel[vr.index];
                  const r = row.original;
                  const approved = r.status_group === "approved" || String(r.latest_status ?? "").toUpperCase() === "A";
                  return (
                    <TableRow
                      key={row.id}
                      style={{ height: 34 }}
                      className={cn(
                        "cursor-default",
                        !r.is_active && "bg-muted/30 text-muted-foreground",
                        approved && r.is_active && "bg-muted/40 text-muted-foreground/70",
                        "hover:bg-muted/50",
                      )}
                      onMouseEnter={() => setHoveredIndex(vr.index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button, a, input, [role="button"], [role="menuitem"], [data-radix-popper-content-wrapper]')) return;
                        onRowClick?.(r.id);
                      }}
                    >
                      {row.getVisibleCells().map((cell, i) => {
                        const isSticky = frozenSet.has(cell.column.id);
                        const leftPx = isSticky ? stickyLefts.get(cell.column.id) ?? 0 : undefined;
                        const isLastFrozen = i === lastFrozenIndex;
                        return (
                          <TableCell
                            key={cell.id}
                            data-column-id={cell.column.id}
                            style={{
                              width: cell.column.getSize(), minWidth: cell.column.getSize(), maxWidth: cell.column.getSize(),
                              height: 34, maxHeight: 34, overflow: "hidden",
                              ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 1, background: stickyBg(r, vr.index) } : {}),
                            }}
                            className={cn("truncate whitespace-nowrap py-1.5 text-xs px-3", isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && <tr style={{ height: paddingBottom }} aria-hidden><td colSpan={leaf.length} style={{ padding: 0, border: 0 }} /></tr>}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}