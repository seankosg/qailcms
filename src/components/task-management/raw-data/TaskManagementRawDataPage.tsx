import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  AUTO_JUDGMENT_COLORS,
  DISCIPLINE_COLORS,
  GROUP_HEADER_BG,
  PLOT_COLORS,
  RISK_COLORS,
  ROW_TYPE_COLORS,
  STATUS_COLORS,
  TM_COLUMNS,
  inferTmFilterType,
  type TmColumnDef,
} from "@/lib/task-management/columns";
import {
  EMPTY_TOKEN,
  dateRangeFilterFn,
  globalSearchFilterFn,
  multiSelectFilterFn,
  numberRangeFilterFn,
  textFilterFn,
} from "@/lib/task-management/filters";
import { ColumnFilterDropdown } from "./ColumnFilters";
import { BulkEditBar } from "./BulkEditBar";
import { EditCellPopover } from "./EditCellPopover";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Row = Record<string, unknown> & { id: string; task_no: string; discipline: string };

const DEFAULT_SORTING: SortingState = [
  { id: "discipline", desc: false },
  { id: "sort_order" as any, desc: false },
];

function formatDdMmm(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day}-${mon}`;
}

function renderBadge(key: string, value: string) {
  const map: Record<string, Record<string, string>> = {
    risk: RISK_COLORS,
    row_type: ROW_TYPE_COLORS,
    status_manual: STATUS_COLORS,
    auto_judgment: AUTO_JUDGMENT_COLORS,
    plot: PLOT_COLORS,
    discipline: DISCIPLINE_COLORS,
  };
  const colors = map[key];
  const cls = colors?.[value] ?? "bg-muted text-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>
      {value}
    </span>
  );
}

function renderCell(col: TmColumnDef, raw: unknown) {
  if (raw == null || raw === "") return <span className="text-muted-foreground/40">—</span>;
  if (col.type === "badge") return renderBadge(col.key, String(raw));
  if (col.type === "date") return <span className="tabular-nums">{formatDdMmm(String(raw))}</span>;
  if (col.type === "number") return <span className="tabular-nums">{Number(raw).toLocaleString()}</span>;
  if (col.type === "percent") {
    const n = Math.max(0, Math.min(1, Number(raw) || 0));
    return (
      <div className="flex w-full items-center gap-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary" style={{ width: `${n * 100}%` }} />
        </div>
        <span className="w-10 text-right text-[10px] tabular-nums">
          {(n * 100).toFixed(1)}%
        </span>
      </div>
    );
  }
  return <span className="truncate">{String(raw)}</span>;
}

function chipValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => (x === EMPTY_TOKEN ? "(Empty)" : String(x))).join(", ");
  if (typeof v === "object") {
    const o = v as any;
    if (o.emptyOnly) return "(Empty)";
    if (o.text) return String(o.text);
    if (o.from || o.to) return `${o.from ?? ""}~${o.to ?? ""}`;
    if (o.min != null || o.max != null) return `${o.min ?? ""}~${o.max ?? ""}`;
  }
  return String(v);
}

export function TaskManagementRawDataPage() {
  const { data: currentUser } = useCurrentUser();
  const canEdit = !!currentUser?.isAdmin;

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setGlobalFilter(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["task-management-raw"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("task_management_raw")
        .select("*")
        .order("discipline", { ascending: true })
        .order("sort_order", { ascending: true })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [
      {
        id: "__select",
        size: 32,
        enableSorting: false,
        enableColumnFilter: false,
        enableResizing: false,
        header: ({ table }) => (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
            <Checkbox
              checked={
                table.getIsAllRowsSelected()
                  ? true
                  : table.getIsSomeRowsSelected()
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
              className="h-3.5 w-3.5"
            />
          </span>
        ),
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              className="h-3.5 w-3.5"
            />
          </span>
        ),
      },
    ];

    for (const c of TM_COLUMNS) {
      const filterType = inferTmFilterType(c.type);
      cols.push({
        id: c.key,
        accessorKey: c.key,
        header: c.label,
        size: c.width,
        minSize: 60,
        enableSorting: true,
        enableColumnFilter: true,
        filterFn:
          filterType === "multi-select"
            ? multiSelectFilterFn
            : filterType === "date-range"
              ? dateRangeFilterFn
              : filterType === "number-range"
                ? numberRangeFilterFn
                : textFilterFn,
        sortingFn:
          c.type === "number" || c.type === "percent"
            ? "basic"
            : c.type === "date"
              ? (a, b, id) => {
                  const av = a.getValue<string | null>(id);
                  const bv = b.getValue<string | null>(id);
                  return (av ? new Date(av).getTime() : 0) - (bv ? new Date(bv).getTime() : 0);
                }
              : "alphanumeric",
        meta: { filterType, group: c.group },
        cell: ({ row, getValue }) => {
          const val = getValue();
          const rendered = renderCell(c, val);
          if (!c.editable) return rendered;
          // Do not allow editing actual_progress on parent rows
          if (c.key === "actual_progress" && (row.original as Row).level === "parent") {
            return rendered;
          }
          return (
            <EditCellPopover
              rowId={String((row.original as Row).id)}
              column={c}
              currentValue={val}
              canEdit={canEdit}
              onSaved={() => refetch()}
            >
              {rendered}
            </EditCellPopover>
          );
        },
      });
    }
    return cols;
  }, [canEdit, refetch]);

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
    },
    getRowId: (r) => String(r.id),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: globalSearchFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    enableMultiSort: true,
  });

  const rowModel = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  const totalWidth = table.getTotalSize();
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection],
  );
  const selectedRowObjects = useMemo(() => {
    const set = new Set(selectedIds);
    return rows.filter((r) => set.has(String(r.id)));
  }, [rows, selectedIds]);

  const exportColumns = useMemo(
    () =>
      table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== "__select")
        .map((c) => ({
          key: c.id,
          label: TM_COLUMNS.find((x) => x.key === c.id)?.label ?? c.id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  const latestDataDate = useMemo(() => {
    let latest: string | null = null;
    for (const r of rows) {
      const d = r.data_date as string | null | undefined;
      if (d && (!latest || d > latest)) latest = d;
    }
    return latest;
  }, [rows]);

  function resetAll() {
    setSorting(DEFAULT_SORTING);
    setColumnFilters([]);
    setGlobalFilter("");
    setSearchInput("");
    setRowSelection({});
  }

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Task-Raw Data</h1>
        <Badge variant="secondary" className="ml-1">
          {rowModel.rows.length.toLocaleString()} / {rows.length.toLocaleString()}
        </Badge>
        {selectedIds.length > 0 && (
          <Badge variant="default" className="tabular-nums">
            {selectedIds.length} selected
          </Badge>
        )}
        {latestDataDate && (
          <Badge variant="outline" className="text-xs">
            Data Date {latestDataDate}
          </Badge>
        )}
        {isFetching && <span className="text-xs text-muted-foreground">불러오는 중…</span>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="전역 검색 (, 는 AND)"
              className="h-8 w-64 pl-7"
            />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={resetAll}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <BulkEditBar
        selectedRows={selectedRowObjects}
        exportColumns={exportColumns}
        canEdit={canEdit}
        onClear={() => setRowSelection({})}
        onMutated={() => {
          setRowSelection({});
          refetch();
        }}
      />

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {globalFilter && (
            <FilterChip
              label={`Search: ${globalFilter}`}
              onClear={() => {
                setSearchInput("");
                setGlobalFilter("");
              }}
            />
          )}
          {columnFilters.map((f) => (
            <FilterChip
              key={f.id}
              label={`${TM_COLUMNS.find((c) => c.key === f.id)?.label ?? f.id}: ${chipValue(f.value)}`}
              onClear={() =>
                setColumnFilters((prev) => prev.filter((x) => x.id !== f.id))
              }
            />
          ))}
          <button
            className="ml-1 text-[11px] text-muted-foreground hover:underline"
            onClick={() => setColumnFilters([])}
          >
            Clear all
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div style={{ width: totalWidth }} className="relative">
            <div className="sticky top-0 z-10 flex border-b bg-muted/70 backdrop-blur">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta as any;
                  const bg = meta?.group
                    ? GROUP_HEADER_BG[meta.group as keyof typeof GROUP_HEADER_BG]
                    : "";
                  return (
                    <div
                      key={h.id}
                      style={{ width: h.getSize() }}
                      className={cn(
                        "relative flex select-none items-center gap-1 border-r px-2 py-1.5 text-xs font-medium",
                        bg,
                      )}
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="flex flex-1 items-center gap-1 truncate text-left"
                      >
                        <span className="truncate">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </span>
                        {h.column.getCanSort() &&
                          (sort === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sort === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          ))}
                      </button>
                      {h.column.getCanFilter() && meta?.filterType && (
                        <ColumnFilterDropdown column={h.column} filterType={meta.filterType} />
                      )}
                    </div>
                  );
                }),
              )}
            </div>

            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((v) => {
                const row = rowModel.rows[v.index];
                if (!row) return null;
                const isParent = (row.original as Row).level === "parent";
                return (
                  <div
                    key={row.id}
                    style={{
                      transform: `translateY(${v.start}px)`,
                      height: v.size,
                      width: totalWidth,
                    }}
                    className={cn(
                      "absolute left-0 top-0 flex border-b text-xs hover:bg-accent/40",
                      row.getIsSelected() && "bg-primary/5",
                      isParent && "bg-muted/30 font-medium",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="flex items-center overflow-hidden truncate border-r px-2"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {rowModel.rows.length === 0 && !isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                일치하는 행이 없습니다. Import 메뉴 &gt; Task Management 탭에서 파일을 업로드하세요.
              </div>
            )}
            {isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                로딩 중…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
        aria-label="Clear filter"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}