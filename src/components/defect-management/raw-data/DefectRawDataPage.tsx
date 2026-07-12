import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search, RefreshCcw, Upload, LayoutDashboard, FileClock, Download, X } from "lucide-react";
import {
  DEFECT_COLUMNS,
  DEFECT_TEAMS,
  TEAM_COLORS,
  TEAM_FALLBACK_COLOR,
  PRIORITY_COLORS,
  type DefectColumnDef,
} from "@/lib/defect-management/columns";
import { useDefectRawData, getDefectLatestDataDate, type DefectItem } from "@/hooks/useDefectRawData";
import { useDefectFieldConfig, useDefectFieldHelpers } from "@/hooks/useDefectFieldConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EMPTY_TOKEN,
  TEXT_FILTER_FIELDS,
  DATE_FILTER_FIELDS,
  PROGRESS_FIELDS,
  multiSelectFilterFn,
  textFilterFn,
  dateRangeFilterFn,
  progressFilterFn,
  globalDefectFilterFn,
} from "@/lib/defect-management/filter-fns";
import { classifyDefectStage, formatDdMmm, isOverdueDefect } from "@/lib/defect-management/stage-utils";
import { ColumnFilterDropdown } from "./ColumnFilterDropdowns";
import { TopHorizontalScrollbar } from "./TopHorizontalScrollbar";
import { DefectStatusBadge } from "./DefectStatusBadge";
import { CriticalPendingBar } from "./CriticalPendingBar";
import { BulkEditBar } from "./BulkEditBar";
import { ExportDialog } from "./ExportDialog";
import { EditCellPopover } from "./EditCellPopover";

const DEFAULT_SORTING: SortingState = [{ id: "source_issue_no", desc: false }];

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
  const search = useSearch({ strict: false }) as Record<string, any>;
  const { data: user } = useCurrentUser();
  const { data: items = [], refetch, isFetching } = useDefectRawData({ teams: [], status: [], q: "", includeInactive: false });
  const { data: fieldConfig = [] } = useDefectFieldConfig();
  const helpers = useDefectFieldHelpers();
  const isAdmin = !!user?.isAdmin;
  const storageKey = user?.id ? `defect-raw-data-state:${user.id}` : "defect-raw-data-state:anon";

  const tableRef = useRef<HTMLDivElement | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchInput, setSearchInput] = useState("");
  const [globalFilter, setGlobalFilter] = useState("");
  const [criticalPending, setCriticalPending] = useState<Map<string, boolean>>(new Map());
  const [exportOpen, setExportOpen] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  const latestDataDate = getDefectLatestDataDate(items);
  const dataDate = latestDataDate ?? null;

  // ── Restore persistent state + URL drilldown params ─────────────────────
  useEffect(() => {
    setStateLoaded(false);
    const isDrilldown = DRILLDOWN_PARAMS.some((p) => search[p] != null);
    let baseFilters: ColumnFiltersState = [];
    let baseSorting = DEFAULT_SORTING;
    let baseGlobal = "";
    let baseSizing: ColumnSizingState = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        baseSizing = parsed.columnSizing && typeof parsed.columnSizing === "object" ? parsed.columnSizing : {};
        if (!isDrilldown) {
          baseSorting = Array.isArray(parsed.sorting) && parsed.sorting.length ? parsed.sorting : DEFAULT_SORTING;
          baseFilters = Array.isArray(parsed.columnFilters) ? parsed.columnFilters : [];
          baseGlobal = typeof parsed.globalFilter === "string" ? parsed.globalFilter : "";
        }
      }
    } catch { /* ignore */ }

    const overriddenCols = new Set<string>();
    for (const [p, col] of Object.entries(URL_MAP)) if (search[p] != null) overriddenCols.add(col);
    const dateField = search.dateField as string | undefined;
    if ((search.dateStart || search.dateEnd) && dateField && DATE_FILTER_FIELDS.has(dateField)) overriddenCols.add(dateField);

    const nextFilters = baseFilters.filter((f) => !overriddenCols.has(f.id));
    for (const [p, col] of Object.entries(URL_MAP)) {
      const v = search[p];
      if (v == null || v === "") continue;
      if (TEXT_FILTER_FIELDS.has(col)) {
        nextFilters.push({ id: col, value: v === EMPTY_TOKEN ? { text: "", emptyOnly: true } : { text: String(v) } });
      } else {
        nextFilters.push({ id: col, value: String(v).split(",").filter(Boolean) });
      }
    }
    if ((search.dateStart || search.dateEnd) && dateField && DATE_FILTER_FIELDS.has(dateField)) {
      nextFilters.push({ id: dateField, value: { from: search.dateStart || undefined, to: search.dateEnd || undefined } });
    }

    setSorting(baseSorting);
    setColumnFilters(nextFilters);
    setColumnSizing(baseSizing);
    setGlobalFilter(baseGlobal);
    setSearchInput(baseGlobal);
    setStateLoaded(true);
  }, [storageKey, search]);

  // Debounced global search
  useEffect(() => {
    const t = window.setTimeout(() => setGlobalFilter(searchInput), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  // Persist state
  useEffect(() => {
    if (!stateLoaded) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          sorting: sorting.length ? sorting : DEFAULT_SORTING,
          columnFilters, globalFilter, columnSizing,
        }));
      } catch { /* ignore */ }
    }, 500);
    return () => window.clearTimeout(t);
  }, [stateLoaded, storageKey, sorting, columnFilters, globalFilter, columnSizing]);

  // ── Filtered base items (URL post-filters that don't map to columns) ────
  const filteredItems = useMemo(() => {
    let next = includeInactive ? items : items.filter((i) => (i as any).is_active !== false);
    if (search.actualComplete === "true") next = next.filter((i: any) => Boolean(i.actual_completion_date || i.actual_closure_date));
    else if (search.actualComplete === "false") next = next.filter((i: any) => !(i.actual_completion_date || i.actual_closure_date));
    if (search.closureComplete === "true") next = next.filter((i: any) => Boolean(i.actual_closure_date));
    else if (search.closureComplete === "false") next = next.filter((i: any) => !i.actual_closure_date);
    if (search.overdue === "true") next = next.filter((i: any) => isOverdueDefect(i, dataDate));
    if (search.notClosureDone === "true") next = next.filter((i: any) => i.closure_status !== "Closed" && i.closure_status !== "Done");
    return next;
  }, [items, search, dataDate, includeInactive]);

  // ── Column definitions ──────────────────────────────────────────────────
  const optionFields = useMemo(() => ({
    team: uniqueOptions(items, "team"),
    closure_status: uniqueOptions(items, "closure_status"),
    status: uniqueOptions(items, "status_raw" as any),
    status_raw: uniqueOptions(items, "status_raw"),
    completion_status: uniqueOptions(items, "completion_status"),
    priority: uniqueOptions(items, "priority"),
    hdec_verification: uniqueOptions(items, "hdec_verification" as any),
    subcontractor_name: uniqueOptions(items, "subcontractor_name"),
    subsub_name: uniqueOptions(items, "subsub_name"),
    hdec_pic_name: uniqueOptions(items, "hdec_pic_name"),
    hdec_eng_name: uniqueOptions(items, "hdec_eng_name"),
    main_trade: uniqueOptions(items, "main_trade"),
    sub_trade: uniqueOptions(items, "sub_trade"),
    work_type: uniqueOptions(items, "work_type"),
    area_type: uniqueOptions(items, "area_type"),
    area_level: uniqueOptions(items, "area_level"),
    area_location: uniqueOptions(items, "area_location"),
    defect_type: uniqueOptions(items, "defect_type"),
    category: uniqueOptions(items, "category"),
    classification: uniqueOptions(items, "classification"),
    classification_source: [
      { value: "rule", label: "rule" }, { value: "discipline", label: "discipline" },
      { value: "manual", label: "manual" }, { value: "unclassified", label: "unclassified" },
    ],
  }), [items]);

  const patchLocalItem = useCallback((id: string, patch: Record<string, any>) => {
    // Optimistic patch — mutate query cache would be nicer, but a refetch works.
    const idx = (filteredItems as any[]).findIndex((i) => i.id === id);
    if (idx >= 0) Object.assign((filteredItems as any)[idx], patch);
  }, [filteredItems]);

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

    // Data columns from DEFECT_COLUMNS
    const dataCols: ColumnDef<DefectItem>[] = DEFECT_COLUMNS
      .filter((c) => c.key !== "is_critical") // handled separately
      .map((c) => buildDataColumn(c, optionFields, dataDate, isAdmin, patchLocalItem, refetch));

    return [selectCol, criticalCol, stageCol, ...dataCols];
  }, [optionFields, dataDate, criticalPending, isAdmin, patchLocalItem, refetch]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = { __select: true, is_critical: true, stage_progress: true };
    const configured = new Map(fieldConfig.map((r) => [r.field_name, r]));
    for (const c of columns) {
      const id = (c as any).id ?? (c as any).accessorKey;
      if (!id || id in vis) continue;
      const row = configured.get(id);
      vis[id] = row ? !!row.is_visible : true;
    }
    return vis;
  }, [columns, fieldConfig]);

  const table = useReactTable<DefectItem>({
    data: filteredItems,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: globalDefectFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getRowId: (r) => r.id,
  });

  const totalRows = filteredItems.length;
  const visibleRows = table.getFilteredRowModel().rows.length;
  const criticalRows = filteredItems.filter((i: any) => i.is_critical).length;
  const selectedIds = Object.keys(rowSelection);

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
            {visibleRows.toLocaleString()} / {totalRows.toLocaleString()}건 · Critical {criticalRows.toLocaleString()}건
            {latestDataDate ? ` · Latest Data Date ${latestDataDate}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/dashboard"><LayoutDashboard className="mr-1 h-3.5 w-3.5" /> Dashboard</Link></Button>
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1 h-3.5 w-3.5" /> Export</Button>
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/import"><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/closure/defect-management/import/logs"><FileClock className="mr-1 h-3.5 w-3.5" /> Import Logs</Link></Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

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
            placeholder="전역 검색 (콤마로 AND: slab, rebar)"
            className="pl-7 h-8 text-sm"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeInactive} onCheckedChange={(v) => setIncludeInactive(!!v)} className="h-3.5 w-3.5" />
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
        loading={!stateLoaded}
        dataDate={dataDate}
        onRowClick={(r) => navigate({ to: "/closure/defect-management/detail/$id", params: { id: r.id } })}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getRows={() => table.getSortedRowModel().rows.map((r) => r.original as any)}
        columnHeaders={DEFECT_COLUMNS.map((c) => ({ key: c.key, label: helpers.getLabel(c.key) }))}
      />

      <CriticalPendingBar
        pending={criticalPending}
        onApplied={(applied) => {
          applied.forEach((v, id) => patchLocalItem(id, { is_critical: v }));
          setCriticalPending(new Map());
          refetch();
        }}
        onDiscard={() => setCriticalPending(new Map())}
      />

      <BulkEditBar
        selectedIds={selectedIds}
        onCleared={() => setRowSelection({})}
        onApplied={() => { setRowSelection({}); refetch(); }}
      />
    </div>
  );
}

// ── Data column builder ────────────────────────────────────────────────────
function buildDataColumn(
  c: DefectColumnDef,
  optionFields: Record<string, { value: string; label: string }[]>,
  dataDate: string | null,
  isAdmin: boolean,
  patchLocal: (id: string, patch: Record<string, any>) => void,
  refetch: () => void,
): ColumnDef<DefectItem> {
  const filterFn =
    DATE_FILTER_FIELDS.has(c.key) ? dateRangeFilterFn :
    PROGRESS_FIELDS.has(c.key) ? progressFilterFn :
    TEXT_FILTER_FIELDS.has(c.key) ? textFilterFn :
    multiSelectFilterFn;
  const filterType =
    DATE_FILTER_FIELDS.has(c.key) ? "date-range" :
    (TEXT_FILTER_FIELDS.has(c.key) || PROGRESS_FIELDS.has(c.key)) ? "text" :
    "multi-select";
  return {
    id: c.key,
    accessorKey: c.key,
    header: c.label,
    size: c.width,
    filterFn,
    meta: { filterType, filterOptions: optionFields[c.key] ?? [] },
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
  onRowClick: (row: DefectItem) => void;
}

function DefectRawTableView({ table, tableRef, loading, dataDate, onRowClick }: TableViewProps) {
  const FROZEN = 3; // __select + is_critical + stage_progress (or source_issue_no once visible)
  const leaf = table.getVisibleLeafColumns();
  const stickyLefts = useMemo(() => {
    const lefts: number[] = []; let acc = 0;
    for (let i = 0; i < Math.min(FROZEN, leaf.length); i++) { lefts.push(acc); acc += leaf[i].getSize(); }
    return lefts;
  }, [leaf, table.getState().columnSizing]);
  const frozenWidth = useMemo(() => leaf.slice(0, FROZEN).reduce((s, c) => s + c.getSize(), 0), [leaf, table.getState().columnSizing]);
  const totalWidth = useMemo(() => leaf.reduce((s, c) => s + c.getSize(), 0), [leaf, table.getState().columnSizing]);

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
                const isSticky = i < FROZEN;
                return (
                  <TableHead
                    key={header.id}
                    style={{
                      width: header.getSize(), minWidth: header.getSize(), maxWidth: header.getSize(),
                      ...(isSticky ? { position: "sticky", left: stickyLefts[i], zIndex: 3, background: "hsl(var(--background))" } : {}),
                    }}
                    className={cn("relative h-9 cursor-pointer select-none whitespace-nowrap border-b px-2 py-0 text-left text-[11px] font-medium",
                      i === FROZEN - 1 && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
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
                        const isSticky = i < FROZEN;
                        return (
                          <TableCell
                            key={cell.id}
                            style={{
                              width: cell.column.getSize(), minWidth: cell.column.getSize(), maxWidth: cell.column.getSize(),
                              ...(isSticky ? { position: "sticky", left: stickyLefts[i], zIndex: 1, background: "hsl(var(--background))" } : {}),
                            }}
                            className={cn("truncate border-b px-2 py-1 text-xs", i === FROZEN - 1 && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
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