import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Route as RawDataRoute } from "@/routes/_authenticated/closure/defect-management/raw-data";
import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type RowSelectionState,
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
import { Search, RefreshCcw, Upload, LayoutDashboard, FileClock, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  DEFECT_COLUMNS,
  DEFECT_TEAMS,
  TEAM_COLORS,
  TEAM_FALLBACK_COLOR,
  PRIORITY_COLORS,
  type DefectColumnDef,
} from "@/lib/defect-management/columns";
import {
  useDefectItemsQuery,
  useDefectStatusCounts,
  useDefectDashboardSummary,
  useInvalidateDefects,
  type DefectItem,
  type DefectServerFilter,
  type DefectServerSort,
  type DefectStatusGroup,
} from "@/hooks/useDefectItems";
import { useDefectFieldConfig, useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EMPTY_TOKEN,
  TEXT_FILTER_FIELDS,
  DATE_FILTER_FIELDS,
  PROGRESS_FIELDS,
} from "@/lib/defect-management/filter-fns";
import { classifyDefectStage, formatDdMmm, isOverdueDefect } from "@/lib/defect-management/stage-utils";
import { ColumnFilterDropdown } from "./ColumnFilterDropdowns";
import { TopHorizontalScrollbar } from "./TopHorizontalScrollbar";
import { DefectStatusBadge } from "./DefectStatusBadge";
import { CriticalPendingBar } from "./CriticalPendingBar";
import { BulkEditBar } from "./BulkEditBar";
import { ExportDialog } from "./ExportDialog";
import { EditCellPopover } from "./EditCellPopover";
import { DefectColumnOrderMenu } from "./DefectColumnOrderMenu";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";

const SYSTEM_FROZEN_IDS = ["__select", "is_critical", "stage_progress"];
const DEFAULT_ORDER = DEFECT_COLUMNS.map((c) => c.key).filter((k) => k !== "is_critical");
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

// ── URL <-> table state helpers ────────────────────────────────────────────
function parseSortFromUrl(s: string): SortingState {
  if (!s) return [{ id: "source_issue_no", desc: true }];
  try {
    return s.split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [id, dir] = p.split(":");
        return { id, desc: (dir ?? "asc").toLowerCase() === "desc" };
      });
  } catch { return [{ id: "source_issue_no", desc: true }]; }
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

// TanStack Table columnFilters → server filter payload
function toServerFilters(f: ColumnFiltersState): DefectServerFilter[] {
  const out: DefectServerFilter[] = [];
  for (const cf of f) {
    const id = cf.id;
    const v: any = cf.value;
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      const hasEmpty = v.includes(EMPTY_TOKEN);
      const rest = v.filter((x) => x !== EMPTY_TOKEN);
      if (rest.length > 0) out.push({ column: id, op: "in", value: rest });
      // "(Empty)" 단독 선택은 op:empty
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
        if (PROGRESS_FIELDS.has(id)) {
          // progress: 숫자로 파싱 시 num_range로 처리; 아니면 skip
          const n = Number(v.text.replace(/[^0-9.-]/g, ""));
          if (Number.isFinite(n)) out.push({ column: id, op: "num_range", value: { min: n, max: n } });
        } else {
          out.push({ column: id, op: "text", value: v.text.trim() });
        }
      }
    }
  }
  return out;
}

function toServerSort(s: SortingState): DefectServerSort[] {
  return s.map((x) => ({ column: x.id, desc: !!x.desc }));
}

function formatPct(v: any): string {
  if (v == null) return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "";
  const pct = n > 1 ? n : n * 100;
  return `${pct.toFixed(1)}%`;
}

function uniqueOptions(items: DefectItem[], field: keyof DefectItem) {
  const set = new Set<string>();
  for (const r of items) {
    const v = r[field];
    if (v && typeof v === "string") set.add(v);
  }
  return [...set].sort().map((v) => ({ value: v, label: v }));
}

const URL_MAP: Record<string, string> = {
  team: "team",
  subcontractor: "subcontractor_name",
  subsub: "subsub_name",
  hdecPic: "hdec_pic_name",
  hdecEng: "hdec_eng_name",
  capturedBy: "captured_by_name",
  level: "area_level",
  mainTrade: "main_trade",
  subTrade: "sub_trade",
  workType: "work_type",
  classificationSource: "classification_source",
  status: "status_raw",
  closureStatus: "closure_status",
  issueNo: "source_issue_no",
  subcontractorIssueNo: "subcontractor_issue_no",
  critical: "is_critical",
  priority: "priority",
};

const DRILLDOWN_PARAMS = [
  "source", "actualComplete", "closureComplete", "overdue", "atRisk", "dueOn",
  ...Object.keys(URL_MAP), "dateStart", "dateEnd", "dateField",
];

export function DefectRawDataPage() {
  const navigate = useNavigate();
  const urlSearch = RawDataRoute.useSearch();
  const { data: user } = useCurrentUser();
  const { data: fieldConfig = [] } = useDefectFieldConfig();
  const helpers = useDefectFieldHelpers();
  const isAdmin = !!user?.isAdmin;
  const invalidateDefects = useInvalidateDefects();

  const tab: DefectStatusGroup = (urlSearch.tab === "closed" ? "closed" : "unclosed") as DefectStatusGroup;
  const includeInactive = !!urlSearch.includeInactive;
  const page = Math.max(1, Number(urlSearch.page) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(urlSearch.pageSize)) ? Number(urlSearch.pageSize) : 100;

  // View preference: per-tab
  const viewPref = useUserViewPreference(`defect-management.raw-data.${tab}.v2`);

  const tableRef = useRef<HTMLDivElement | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [sorting, setSorting] = useState<SortingState>(parseSortFromUrl(urlSearch.sort));
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(parseFiltersFromUrl(urlSearch.filters));
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchInput, setSearchInput] = useState(urlSearch.q ?? "");
  const [criticalPending, setCriticalPending] = useState<Map<string, boolean>>(new Map());
  const [exportOpen, setExportOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [frozenExtras, setFrozenExtras] = useState<string[]>([]);

  // Sync URL → local (탭 전환 시 URL의 sort/filters를 초기화 반영)
  useEffect(() => {
    setSorting(parseSortFromUrl(urlSearch.sort));
    setColumnFilters(parseFiltersFromUrl(urlSearch.filters));
    setSearchInput(urlSearch.q ?? "");
    setRowSelection({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Server data ─────────────────────────────────────────────────────────
  const serverFilters = useMemo(() => toServerFilters(columnFilters), [columnFilters]);
  const serverSort = useMemo(() => toServerSort(sorting), [sorting]);
  const q = (urlSearch.q ?? "").trim();
  const {
    data: itemsData,
    isFetching,
    refetch,
  } = useDefectItemsQuery({
    statusGroup: tab,
    includeInactive,
    q,
    filters: serverFilters,
    sort: serverSort,
    page,
    pageSize,
  });
  const rows = itemsData?.rows ?? [];
  const total = itemsData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const { data: counts } = useDefectStatusCounts({ includeInactive });
  const { data: summary } = useDefectDashboardSummary({ includeInactive });
  const dataDate = summary?.latest_data_date ?? null;

  // ── Restore view pref (per-tab: order/visibility/frozenExtras/columnSizing) ─
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
      const validKeys = new Set(DEFAULT_ORDER);
      const savedOrder: string[] = Array.isArray(s.order)
        ? s.order.filter((k: any) => typeof k === "string" && validKeys.has(k))
        : [];
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
        for (const [k, v] of Object.entries(s.visibility)) {
          if (validKeys.has(k)) baseVisibility[k] = !!v;
        }
      }
      if (Array.isArray(s.frozenExtras)) {
        baseFrozen = s.frozenExtras.filter((k: any) => typeof k === "string" && validKeys.has(k)).slice(0, 3);
      }
    }
    setColumnSizing(baseSizing);
    setOrder(baseOrder);
    setVisibility(baseVisibility);
    setFrozenExtras(baseFrozen);
    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPref.ready, tab]);

  // Save view pref (columnSizing/order/visibility/frozenExtras)
  useEffect(() => {
    if (!stateLoaded) return;
    viewPref.save({ columnSizing, order, visibility, frozenExtras } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, columnSizing, order, visibility, frozenExtras]);

  // ── Sync local (columnFilters/sorting/q) → URL (debounced) ──────────────
  const setUrl = useCallback(
    (patch: Record<string, any>) => {
      navigate({ to: ".", search: (prev: any) => ({ ...prev, ...patch }), replace: true });
    },
    [navigate],
  );

  // Debounced global search input → URL q
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((urlSearch.q ?? "") !== searchInput) setUrl({ q: searchInput, page: 1 });
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, urlSearch.q, setUrl]);

  // sort/columnFilters → URL
  useEffect(() => {
    if (!stateLoaded) return;
    const nextSort = serializeSort(sorting);
    const nextFilters = serializeFilters(columnFilters);
    if (nextSort !== (urlSearch.sort ?? "") || nextFilters !== (urlSearch.filters ?? "")) {
      setUrl({ sort: nextSort, filters: nextFilters, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, columnFilters, stateLoaded]);

  // ── Local optimistic patch (for edit popover) ───────────────────────────
  const patchLocalItem = useCallback((_id: string, _patch: Record<string, any>) => {
    // 낙관적 갱신은 refetch로 대체 — 서버 페이지네이션 특성상 갱신 반영이 명확함.
  }, []);

  const orderedKeys = useMemo(() => {
    const frozenSet = new Set(frozenExtras);
    const rest = order.filter((k) => !frozenSet.has(k));
    return [...SYSTEM_FROZEN_IDS, ...frozenExtras, ...rest];
  }, [order, frozenExtras]);

  // Closed 탭에서는 status_raw 컬럼 숨김(모두 Closed)
  const hiddenByTab = useMemo(() => {
    const s = new Set<string>();
    if (tab === "closed") s.add("status_raw");
    return s;
  }, [tab]);

  const columns = useMemo<ColumnDef<DefectItem>[]>(() => {
    // Static select column
    const selectCol: ColumnDef<DefectItem> = {
      id: "__select", size: 36, enableSorting: false, enableColumnFilter: false, enableResizing: false,
      header: ({ table }) => (
        <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
          <Checkbox
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(c) => table.toggleAllRowsSelected(!!c)}
            className="h-3.5 w-3.5"
          />
        </span>
      ),
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
          <Checkbox checked={row.getIsSelected()} onCheckedChange={(c) => row.toggleSelected(!!c)} className="h-3.5 w-3.5" />
        </span>
      ),
    };

    // Critical column
    const criticalCol: ColumnDef<DefectItem> = {
      id: "is_critical", accessorKey: "is_critical", header: "Critical", size: 72, enableSorting: true, enableColumnFilter: true,
      filterFn: multiSelectFilterFn,
      meta: { filterType: "multi-select", filterOptions: [{ value: "true", label: "Critical" }, { value: "false", label: "Non-critical" }] },
      accessorFn: (r) => ((r as any).is_critical ? "true" : "false"),
      cell: ({ row }) => {
        const id = row.original.id;
        const original = !!(row.original as any).is_critical;
        const pv = criticalPending.get(id);
        const checked = pv !== undefined ? pv : original;
        const pending = pv !== undefined && pv !== original;
        return (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
            <Checkbox
              checked={checked}
              onCheckedChange={(c) => {
                const nv = !!c;
                setCriticalPending((prev) => {
                  const map = new Map(prev);
                  if (nv === original) map.delete(id); else map.set(id, nv);
                  return map;
                });
              }}
              className={cn("h-3.5 w-3.5", pending && "ring-2 ring-amber-500/70 ring-offset-1 rounded-sm")}
            />
          </span>
        );
      },
    };

    // Stage progress virtual column
    const stageCol: ColumnDef<DefectItem> = {
      id: "stage_progress", header: "Progress", size: 110, enableSorting: true, enableColumnFilter: true,
      accessorFn: (r) => classifyDefectStage(r as any, dataDate),
      filterFn: multiSelectFilterFn,
      meta: {
        filterType: "multi-select",
        filterOptions: [
          { value: "Not Started", label: "Not Started" }, { value: "In Progress", label: "In Progress" },
          { value: "Completed", label: "Completed" }, { value: "Closed", label: "Closed" }, { value: "Delayed", label: "Delayed" },
        ],
      },
      cell: ({ getValue }) => {
        const v = getValue() as string;
        const cls =
          v === "Delayed" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" :
          v === "Closed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" :
          v === "Completed" ? "bg-teal-500/15 text-teal-700 dark:text-teal-300" :
          v === "In Progress" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
          "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
        return <Badge className={cn("text-[10px] font-medium", cls)}>{v}</Badge>;
      },
    };

    // Data columns from DEFECT_COLUMNS, ordered by user-configured orderedKeys
    const byKey = new Map(
      DEFECT_COLUMNS.filter((c) => c.key !== "is_critical").map((c) => [c.key, c] as const),
    );
    const cols: ColumnDef<DefectItem>[] = [];
    for (const id of orderedKeys) {
      if (id === "__select") { cols.push(selectCol); continue; }
      if (id === "is_critical") { cols.push(criticalCol); continue; }
      if (id === "stage_progress") { cols.push(stageCol); continue; }
      if (hiddenByTab.has(id)) continue;
      const c = byKey.get(id);
      if (!c) continue;
      cols.push(buildDataColumn(c, tab, includeInactive, dataDate, isAdmin, patchLocalItem, () => refetch()));
    }
    return cols;
  }, [orderedKeys, hiddenByTab, tab, includeInactive, dataDate, criticalPending, isAdmin, patchLocalItem, refetch]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = { __select: true, is_critical: true, stage_progress: true };
    const configured = new Map(fieldConfig.map((r) => [r.field_name, r]));
    const frozenSet = new Set(frozenExtras);
    for (const c of columns) {
      const id = (c as any).id ?? (c as any).accessorKey;
      if (!id || id in vis) continue;
      if (frozenSet.has(id)) { vis[id] = true; continue; }
      if (id in visibility) { vis[id] = visibility[id] !== false; continue; }
      const row = configured.get(id);
      vis[id] = row ? !!row.is_visible : true;
    }
    return vis;
  }, [columns, fieldConfig, visibility, frozenExtras]);

  const table = useReactTable<DefectItem>({
    data: rows,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getRowId: (r) => r.id,
  });

  const selectedIds = Object.keys(rowSelection);
  const criticalPendingCount = summary?.critical_pending ?? 0;
  const unclosedCount = counts?.unclosed_count ?? 0;
  const closedCount = counts?.closed_count ?? 0;

  // Active filter chips
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

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Defect Management — Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()}건 (전체 Unclosed {unclosedCount.toLocaleString()} · Closed {closedCount.toLocaleString()})
            {tab === "unclosed" ? ` · Critical ${criticalPendingCount.toLocaleString()}` : ""}
            {dataDate ? ` · Latest Data Date ${dataDate}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/dashboard"><LayoutDashboard className="mr-1 h-3.5 w-3.5" /> Dashboard</Link></Button>
          <DefectColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            onOrderChange={setOrder}
            onVisibilityChange={setVisibility}
            onFrozenChange={setFrozenExtras}
          />
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1 h-3.5 w-3.5" /> Export</Button>
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/import"><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/import/logs"><FileClock className="mr-1 h-3.5 w-3.5" /> Import Logs</Link></Button>
          <Button variant="outline" size="sm" onClick={() => { invalidateDefects(); refetch(); }} disabled={isFetching}>
            <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v, page: 1 })}>
        <TabsList className="h-9">
          <TabsTrigger value="unclosed" className="text-xs">
            Unclosed <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{unclosedCount.toLocaleString()}</Badge>
          </TabsTrigger>
          <TabsTrigger value="closed" className="text-xs">
            Closed <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{closedCount.toLocaleString()}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-1">
          {DEFECT_TEAMS.map((t) => {
            const col = table.getColumn("team");
            const sel = (col?.getFilterValue() as string[]) ?? [];
            const active = sel.includes(t);
            return (
              <Button key={t} size="sm" variant={active ? "default" : "outline"} className="h-7"
                onClick={() => col?.setFilterValue(active ? sel.filter((x) => x !== t) : [...sel, t])}
              >{t}</Button>
            );
          })}
        </div>
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="전역 검색 (설명/ID/위치/협력사/PIC 등)"
            className="pl-7 h-8 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeInactive} onCheckedChange={(v) => setUrl({ includeInactive: !!v, page: 1 })} className="h-3.5 w-3.5" />
          비활성 포함
        </label>
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((c) => (
            <button key={c.id} onClick={c.onClear} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] hover:bg-muted">
              {c.label} <X className="h-2.5 w-2.5" />
            </button>
          ))}
          <button onClick={() => setColumnFilters([])} className="text-[11px] text-muted-foreground hover:underline">Clear all</button>
        </div>
      )}

      <DefectRawTableView
        table={table}
        tableRef={tableRef}
        loading={!stateLoaded || isFetching}
        dataDate={dataDate}
        frozenColIds={[...SYSTEM_FROZEN_IDS, ...frozenExtras]}
        onRowClick={(r) => navigate({ to: "/closure/defect-management/detail/$id", params: { id: r.id } })}
      />

      {/* Pagination controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground">
          {total > 0
            ? `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} / ${total.toLocaleString()}`
            : "0 / 0"}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">페이지 크기</span>
          <Select value={String(pageSize)} onValueChange={(v) => setUrl({ pageSize: Number(v), page: 1 })}>
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: 1 })}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: page - 1 })}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <span className="tabular-nums">{page} / {pageCount}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: page + 1 })}><ChevronRight className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: pageCount })}><ChevronsRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getRows={() => rows}
        columnHeaders={DEFECT_COLUMNS.map((c) => ({ key: c.key, label: helpers.getLabel(c.key) }))}
      />

      <CriticalPendingBar
        pending={criticalPending}
        onApplied={() => {
          setCriticalPending(new Map());
          invalidateDefects();
        }}
        onDiscard={() => setCriticalPending(new Map())}
      />

      <BulkEditBar
        selectedIds={selectedIds}
        onCleared={() => setRowSelection({})}
        onApplied={() => { setRowSelection({}); invalidateDefects(); }}
      />
    </div>
  );
}

// ── Data column builder ────────────────────────────────────────────────────
function buildDataColumn(
  c: DefectColumnDef,
  statusGroup: DefectStatusGroup,
  includeInactive: boolean,
  dataDate: string | null,
  isAdmin: boolean,
  patchLocal: (id: string, patch: Record<string, any>) => void,
  refetch: () => void,
): ColumnDef<DefectItem> {
  const filterType =
    DATE_FILTER_FIELDS.has(c.key) ? "date-range" :
    (TEXT_FILTER_FIELDS.has(c.key) || PROGRESS_FIELDS.has(c.key)) ? "text" :
    "multi-select";
  // multi-select 컬럼은 서버 facet 사용
  const serverFacet = filterType === "multi-select" ? c.key : null;
  return {
    id: c.key,
    accessorKey: c.key,
    header: c.label,
    size: c.width,
    // manualFiltering=true 상태이므로 filterFn 불필요
    enableSorting: !PROGRESS_FIELDS.has(c.key) || c.type === "percent",
    meta: { filterType, filterOptions: [], serverFacet, statusGroup, includeInactive },
    cell: ({ row, getValue }) => {
      const v: any = getValue();
      const display = renderDefectCell(c, v, row.original, dataDate);
      if (c.editable && isAdmin && c.editorType) {
        const locked =
          (c.key === "priority" && (row.original as any).priority_locked) ||
          (c.key === "hdec_verification" && (row.original as any).hdec_verification_locked);
        return (
          <EditCellPopover
            id={row.original.id}
            field={c.key}
            label={c.label}
            editorType={c.editorType}
            options={c.options}
            currentValue={v}
            locked={locked}
            onSaved={(nv) => { patchLocal(row.original.id, { [c.key]: nv }); refetch(); }}
          >{display}</EditCellPopover>
        );
      }
      return display;
    },
  };
}

function renderDefectCell(c: DefectColumnDef, v: any, row: DefectItem, _dataDate: string | null): React.ReactNode {
  if (v == null || v === "") return <span className="text-muted-foreground/50">—</span>;
  if (c.key === "team") return <Badge className={cn("text-[10px]", TEAM_COLORS[String(v)] ?? TEAM_FALLBACK_COLOR)}>{String(v)}</Badge>;
  if (c.key === "priority" || c.key === "hdec_verification") {
    const cls = PRIORITY_COLORS[String(v)] ?? TEAM_FALLBACK_COLOR;
    return <Badge className={cn("text-[10px]", cls)}>{String(v)}</Badge>;
  }
  if (c.key === "status_raw" || c.key === "completion_status" || c.key === "closure_status") return <DefectStatusBadge status={v} />;
  if (c.key === "classification_source") {
    const src = String(v).toLowerCase();
    const cls = src === "rule" ? "bg-primary/10 text-primary border-primary/30"
      : src === "discipline" ? "bg-accent text-accent-foreground border-border"
      : src === "manual" ? "bg-muted text-foreground border-border"
      : "bg-destructive/10 text-destructive border-destructive/30";
    return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold", cls)}>{src}</span>;
  }
  if (c.type === "date") return <span className="tabular-nums text-xs">{formatDdMmm(v)}</span>;
  if (c.type === "datetime") {
    const d = new Date(v);
    return <span className="tabular-nums text-xs">{isNaN(d.getTime()) ? String(v) : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`}</span>;
  }
  if (c.type === "percent") return <span className="tabular-nums text-xs">{formatPct(v)}</span>;
  if (c.type === "longtext") return <span className="block truncate whitespace-pre-wrap text-xs" title={String(v)}>{String(v)}</span>;
  return <span className="text-xs">{String(v)}</span>;
}

// ── Virtualized table view with sticky header + frozen first columns ────
interface TableViewProps {
  table: ReturnType<typeof useReactTable<DefectItem>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  dataDate: string | null;
  frozenColIds: string[];
  onRowClick: (row: DefectItem) => void;
}

function DefectRawTableView({ table, tableRef, loading, dataDate, frozenColIds, onRowClick }: TableViewProps) {
  const leaf = table.getVisibleLeafColumns();
  const frozenSet = useMemo(() => new Set(frozenColIds), [frozenColIds]);
  // 리프 컬럼을 순회하면서 frozen id인 것들만 왼쪽부터 sticky 스택으로 쌓음.
  // 사용자가 pin한 컬럼은 리프 순서(orderedKeys)상 이미 왼쪽에 배치되어 있음.
  const { stickyLefts, lastFrozenIndex, frozenWidth } = useMemo(() => {
    const lefts = new Map<string, number>();
    let acc = 0;
    let lastIdx = -1;
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
  const totalWidth = useMemo(
    () => leaf.reduce((s, c) => s + c.getSize(), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaf, table.getState().columnSizing],
  );

  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });
  const vRows = rowVirtualizer.getVirtualItems();
  const paddingTop = vRows.length > 0 ? vRows[0].start : 0;
  const paddingBottom = vRows.length > 0 ? rowVirtualizer.getTotalSize() - vRows[vRows.length - 1].end : 0;

  return (
    <div className="flex max-h-[calc(100vh-260px)] flex-col overflow-hidden rounded-md border bg-background">
      <TopHorizontalScrollbar targetRef={tableRef} width={totalWidth} frozenWidth={frozenWidth} />
      <div ref={tableRef} className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <Table style={{ width: totalWidth, tableLayout: "fixed" }}>
          <TableHeader className="bg-background">
            <TableRow className="border-b bg-background [&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:bg-background">
              {table.getHeaderGroups().at(-1)?.headers.map((header, i) => {
                const isSticky = frozenSet.has(header.column.id);
                const leftPx = isSticky ? stickyLefts.get(header.column.id) ?? 0 : undefined;
                const isLastFrozen = i === lastFrozenIndex;
                return (
                  <TableHead
                    key={header.id}
                    style={{
                      width: header.getSize(), minWidth: header.getSize(), maxWidth: header.getSize(),
                      ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 3, background: "hsl(var(--background))" } : {}),
                    }}
                    className={cn("relative h-9 cursor-pointer select-none whitespace-nowrap border-b px-2 py-0 text-left text-[11px] font-medium",
                      isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        {header.column.getIsSorted() && <span className="flex-shrink-0">{header.column.getIsSorted() === "asc" ? "▲" : "▼"}</span>}
                      </span>
                      {header.column.getCanFilter() && (
                        <span onClick={(e) => e.stopPropagation()}><ColumnFilterDropdown column={header.column} /></span>
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
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={leaf.length} className="py-8 text-center text-muted-foreground">데이터가 없습니다. Import 페이지에서 Excel을 업로드하세요.</TableCell></TableRow>
            ) : (
              <>
                {paddingTop > 0 && <tr style={{ height: paddingTop }} aria-hidden><td colSpan={leaf.length} style={{ padding: 0, border: 0 }} /></tr>}
                {vRows.map((vr) => {
                  const row = rows[vr.index];
                  const r: any = row.original;
                  const closed = Boolean(r.actual_closure_date) || /closed|complete|done/i.test(`${r.closure_status ?? ""} ${r.status_raw ?? ""}`);
                  const overdue = isOverdueDefect(r, dataDate);
                  return (
                    <TableRow
                      key={row.id}
                      style={{ height: 36 }}
                      className={cn("cursor-pointer", closed && "bg-muted/30 text-muted-foreground", overdue && !closed && "bg-destructive/5", "hover:bg-muted/50")}
                      onClick={() => onRowClick(row.original)}
                    >
                      {row.getVisibleCells().map((cell, i) => {
                        const isSticky = frozenSet.has(cell.column.id);
                        const leftPx = isSticky ? stickyLefts.get(cell.column.id) ?? 0 : undefined;
                        const isLastFrozen = i === lastFrozenIndex;
                        return (
                          <TableCell
                            key={cell.id}
                            style={{
                              width: cell.column.getSize(), minWidth: cell.column.getSize(), maxWidth: cell.column.getSize(),
                              ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 1, background: "hsl(var(--background))" } : {}),
                            }}
                            className={cn("truncate border-b px-2 py-1 text-xs", isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
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