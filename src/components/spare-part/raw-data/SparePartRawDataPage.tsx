import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
  type ColumnSizingState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Download,
  Filter,
  Pin,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APPROVAL_CODE_COLORS,
  PLOT_COLORS,
  SPARE_PART_COLUMNS,
  GROUP_HEADER_BG,
  inferFilterType,
} from "@/lib/spare-part/columns";
import { formatDdMmm, formatNumber, isOverdue } from "@/lib/spare-part/format";
import {
  booleanFilterFn,
  dateRangeFilterFn,
  EMPTY_TOKEN,
  globalSearchFilterFn,
  multiSelectFilterFn,
  numberRangeFilterFn,
  textFilterFn,
} from "@/lib/spare-part/filters";
import { ColumnFilterDropdown } from "./ColumnFilters";
import { TopHorizontalScrollbar } from "./TopHorizontalScrollbar";
import { ColumnOrderMenu } from "./ColumnOrderMenu";
import { BulkEditBar } from "./BulkEditBar";
import { ExportDialog } from "./ExportDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useSparePartFieldConfig,
  buildLabelOverrides,
  SPARE_PART_FIELD_CONFIG_QK,
  persistSparePartFieldConfig,
} from "@/hooks/useSparePartFieldConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type Row = Record<string, unknown> & { doc_ref: string; plot: string };

const DEFAULT_SORTING: SortingState = [{ id: "doc_ref", desc: false }];
const DEFAULT_FROZEN_EXTRAS = ["plot", "subject", "approval_code"];
const DEFAULT_ORDER = SPARE_PART_COLUMNS.map((c) => c.key).filter((k) => k !== "doc_ref");

interface UrlSearch {
  q?: string;
  plot?: string;
  approval_code?: string;
  supplier?: string;
  category?: string;
  manufacturer?: string;
  overdue?: string;
}

interface PersistedState {
  sorting: SortingState;
  sizing: ColumnSizingState;
  visibility: VisibilityState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  order: string[];
  frozenExtras: string[];
  includeInactive: boolean;
}

export function SparePartRawDataPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as UrlSearch;
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { data: fieldConfig } = useSparePartFieldConfig();
  const labelOverrides = useMemo(() => buildLabelOverrides(fieldConfig), [fieldConfig]);
  const userKey = currentUser?.id ?? null;
  const storageKey = userKey ? `qail.spare-part.raw-data.v2:${userKey}` : null;
  const canEdit = !!currentUser?.isAdmin;
  const qc = useQueryClient();

  const onServerReorder = useCallback(
    async (patches: Array<{ field_name: string; sort_order: number }>) => {
      try {
        await persistSparePartFieldConfig(patches);
        qc.invalidateQueries({ queryKey: SPARE_PART_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 순서 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );
  const onServerVisibility = useCallback(
    async (field_name: string, is_visible: boolean) => {
      try {
        await persistSparePartFieldConfig([{ field_name, is_visible }]);
        qc.invalidateQueries({ queryKey: SPARE_PART_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 노출 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );

  const [stateLoaded, setStateLoaded] = useState(false);
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [frozenExtras, setFrozenExtras] = useState<string[]>(DEFAULT_FROZEN_EXTRAS);
  // 비활성 레코드는 항상 제외 (관리자 페이지에서 별도 관리 예정)
  const includeInactive = false;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [exportOpen, setExportOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 초기 상태 로드 (localStorage + URL 드릴다운)
  useEffect(() => {
    if (!storageKey) return;
    let s: Partial<PersistedState> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) s = JSON.parse(raw);
    } catch {
      // ignore
    }

    const validKeys = new Set(
      SPARE_PART_COLUMNS.map((c) => c.key).filter((k) => k !== "doc_ref"),
    );
    const validAll = new Set<string>(["__select", "doc_ref", ...validKeys]);

    // order: 저장본 중 유효 키만 유지 + 신규 키를 DEFAULT_ORDER 상의 원래 위치에 삽입
    const savedOrder = (s.order ?? []).filter((k) => validKeys.has(k));
    let mergedOrder: string[];
    if (!savedOrder.length) {
      mergedOrder = DEFAULT_ORDER;
    } else {
      const savedSet = new Set(savedOrder);
      mergedOrder = [...savedOrder];
      DEFAULT_ORDER.forEach((k, defIdx) => {
        if (savedSet.has(k)) return;
        // 원래 순서상 바로 앞에 있던 키를 찾아 그 뒤에 삽입
        let insertAt = mergedOrder.length;
        for (let i = defIdx - 1; i >= 0; i--) {
          const prev = DEFAULT_ORDER[i];
          const idx = mergedOrder.indexOf(prev);
          if (idx !== -1) {
            insertAt = idx + 1;
            break;
          }
        }
        mergedOrder.splice(insertAt, 0, k);
      });
    }

    // frozenExtras: 유효 키만 유지, default 로 보충 (개수 상한 없음)
    const savedFrozen = (s.frozenExtras ?? []).filter((k) => validKeys.has(k));
    const frozenFill = DEFAULT_FROZEN_EXTRAS.filter((k) => !savedFrozen.includes(k));
    const mergedFrozen = [...savedFrozen, ...frozenFill];

    // visibility: 유효 키만 유지
    const cleanedVisibility: VisibilityState = {};
    for (const [k, v] of Object.entries(s.visibility ?? {})) {
      if (validKeys.has(k)) cleanedVisibility[k] = v as boolean;
    }

    // sizing: __select/doc_ref/유효 키만
    const cleanedSizing: ColumnSizingState = {};
    for (const [k, v] of Object.entries(s.sizing ?? {})) {
      if (validAll.has(k)) cleanedSizing[k] = v as number;
    }

    // columnFilters: 유효 키만
    const cleanedFilters: ColumnFiltersState = (s.columnFilters ?? []).filter((f) =>
      validKeys.has(f.id),
    );

    setSorting(s.sorting?.length ? s.sorting.filter((x) => validAll.has(x.id)) : DEFAULT_SORTING);
    setSizing(cleanedSizing);
    setVisibility(cleanedVisibility);
    setOrder(mergedOrder);
    setFrozenExtras(mergedFrozen.length ? mergedFrozen : DEFAULT_FROZEN_EXTRAS);
    // includeInactive는 더 이상 UI에서 토글하지 않음 (항상 false)

    // URL 드릴다운
    const urlFilters: ColumnFiltersState = [];
    if (search.plot) urlFilters.push({ id: "plot", value: search.plot.split(",") });
    if (search.approval_code) urlFilters.push({ id: "approval_code", value: search.approval_code.split(",") });
    if (search.supplier) urlFilters.push({ id: "supplier", value: { text: search.supplier } });
    if (search.category) urlFilters.push({ id: "category", value: search.category.split(",") });
    if (search.manufacturer) urlFilters.push({ id: "manufacturer", value: { text: search.manufacturer } });

    const hasUrlFilter = urlFilters.length > 0 || !!search.overdue || !!search.q;
    const baseFilters = hasUrlFilter ? [] : cleanedFilters;
    setColumnFilters([...baseFilters, ...urlFilters]);

    const initialGlobal = search.q ?? s.globalFilter ?? "";
    setGlobalFilter(initialGlobal);
    setSearchInput(initialGlobal);

    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // debounce global search
  useEffect(() => {
    const t = setTimeout(() => setGlobalFilter(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // localStorage 저장
  useEffect(() => {
    if (!stateLoaded || !storageKey) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ sorting, sizing, visibility, columnFilters, globalFilter, order, frozenExtras, includeInactive } satisfies PersistedState),
        );
      } catch {
        // ignore
      }
    }, 400);
    return () => clearTimeout(t);
  }, [stateLoaded, storageKey, sorting, sizing, visibility, columnFilters, globalFilter, order, frozenExtras, includeInactive]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["spare-parts-raw"],
    queryFn: async () => {
      const cols = ["doc_ref", "plot", "is_active", ...SPARE_PART_COLUMNS.map((c) => c.key)];
      const unique = Array.from(new Set(cols));
      const { data, error } = await supabase
        .from("spare_parts_raw")
        .select(unique.join(","))
        .order("doc_ref", { ascending: true })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  // URL 기반 pre-filter (overdue만; 나머지는 columnFilters로 흘림)
  const preFiltered = useMemo(() => {
    let out = rows;
    if (!includeInactive) out = out.filter((r) => r.is_active !== false);
    if (search.overdue === "true") out = out.filter((r) => isOverdue(r.delivery_date as string | null));
    return out;
  }, [rows, includeInactive, search.overdue]);

  // 컬럼 정의
  const orderedKeys = useMemo(() => {
    // 최종 순서: __select → doc_ref → frozenExtras... → 나머지 order 순서
    const frozenSet = new Set(frozenExtras);
    const rest = order.filter((k) => !frozenSet.has(k) && k !== "doc_ref");
    return ["__select", "doc_ref", ...frozenExtras, ...rest];
  }, [order, frozenExtras]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = [];
    for (const key of orderedKeys) {
      if (key === "__select") {
        cols.push({
          id: "__select",
          size: 32,
          enableSorting: false,
          enableColumnFilter: false,
          enableResizing: false,
          header: ({ table }) => (
            <span onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
              <Checkbox
                checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
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
        });
        continue;
      }
      const c = SPARE_PART_COLUMNS.find((x) => x.key === key);
      if (!c) continue;
      const filterType = inferFilterType(c.type);
      cols.push({
        id: c.key,
        accessorKey: c.key,
        header: labelOverrides[c.key] ?? c.label,
        size: c.width,
        minSize: 60,
        maxSize: 480,
        enableSorting: true,
        enableColumnFilter: true,
        filterFn:
          filterType === "multi-select"
            ? multiSelectFilterFn
            : filterType === "date-range"
            ? dateRangeFilterFn
            : filterType === "number-range"
            ? numberRangeFilterFn
            : filterType === "boolean"
            ? booleanFilterFn
            : textFilterFn,
        sortingFn:
          c.type === "number" || c.type === "cost" || c.type === "progress"
            ? "basic"
            : c.type === "date"
            ? (a, b, id) => {
                const av = a.getValue<string | null>(id);
                const bv = b.getValue<string | null>(id);
                return (av ? new Date(av).getTime() : 0) - (bv ? new Date(bv).getTime() : 0);
              }
            : "alphanumeric",
        meta: { filterType, group: c.group },
        cell: ({ getValue }) => renderCell(c.key, getValue()),
      });
    }
    return cols;
  }, [orderedKeys, labelOverrides]);

  const table = useReactTable({
    data: preFiltered,
    columns,
    state: {
      sorting,
      columnSizing: sizing,
      columnVisibility: visibility,
      columnFilters,
      globalFilter,
      rowSelection,
    },
    getRowId: (r) => r.doc_ref,
    onSortingChange: setSorting,
    onColumnSizingChange: setSizing,
    onColumnVisibilityChange: setVisibility,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: globalSearchFilterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    columnResizeMode: "onChange",
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
  const frozenColIds = ["__select", "doc_ref", ...frozenExtras];
  const frozenWidth = table.getVisibleLeafColumns()
    .filter((c) => frozenColIds.includes(c.id))
    .reduce((s, c) => s + c.getSize(), 0);

  // 좌측 sticky offset 계산
  const leftOffsets = useMemo(() => {
    const off = new Map<string, number>();
    let acc = 0;
    for (const c of table.getVisibleLeafColumns()) {
      if (frozenColIds.includes(c.id)) {
        off.set(c.id, acc);
        acc += c.getSize();
      }
    }
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getState().columnSizing, table.getVisibleLeafColumns(), frozenExtras]);

  const selectedDocRefs = useMemo(() => Object.keys(rowSelection).filter((k) => rowSelection[k]), [rowSelection]);

  // Bulk Edit Bar 용: 선택된 행 객체와 현재 화면 컬럼(순서/라벨) 그대로 export column
  const selectedRowObjects = useMemo(() => {
    const set = new Set(selectedDocRefs);
    return rows.filter((r) => set.has(r.doc_ref));
  }, [rows, selectedDocRefs]);

  const selectedExportColumns = useMemo(() => {
    return table
      .getVisibleLeafColumns()
      .filter((c) => c.id !== "__select")
      .map((c) => {
        const def = SPARE_PART_COLUMNS.find((x) => x.key === c.id);
        return {
          key: c.id,
          label: labelOverrides[c.id] ?? def?.label ?? c.id,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKeys, visibility, labelOverrides]);

  const resetAll = () => {
    setSorting(DEFAULT_SORTING);
    setSizing({});
    setVisibility({});
    setColumnFilters([]);
    setGlobalFilter("");
    setSearchInput("");
    setOrder(DEFAULT_ORDER);
    setFrozenExtras(DEFAULT_FROZEN_EXTRAS);
    setRowSelection({});
    navigate({ to: "/closure/spare-part/raw-data", search: {} });
  };

  const visibleKeysForExport = useMemo(
    () => table.getVisibleLeafColumns().map((c) => c.id).filter((id) => id !== "__select"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeys, visibility],
  );
  const filteredRowsForExport = useMemo(
    () => rowModel.rows.map((r) => r.original),
    [rowModel.rows],
  );

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0);

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col gap-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">SPT-Raw Data</h1>
        <Badge variant="secondary" className="ml-1">
          {rowModel.rows.length.toLocaleString()} / {rows.length.toLocaleString()}
        </Badge>
        {selectedDocRefs.length > 0 && (
          <Badge variant="default" className="tabular-nums">
            {selectedDocRefs.length} selected
          </Badge>
        )}
        {isFetching && <span className="text-xs text-muted-foreground">불러오는 중…</span>}

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="전역 검색 (, 는 AND)"
              className="h-8 w-full pl-7 sm:w-64"
            />
          </div>

          <ColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            onOrderChange={setOrder}
            onVisibilityChange={setVisibility}
            onFrozenChange={setFrozenExtras}
            isAdmin={canEdit}
            onServerReorder={onServerReorder}
            onServerVisibility={onServerVisibility}
          />

          <Button variant="outline" size="sm" className="h-8" onClick={resetAll}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => navigate({ to: "/closure/spare-part/import" })}
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Import
          </Button>
          <Button size="sm" className="h-8" onClick={() => setExportOpen(true)}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      <BulkEditBar
        selectedRows={selectedRowObjects}
        exportColumns={selectedExportColumns}
        canEdit={canEdit}
        onClear={() => setRowSelection({})}
        onSaved={() => {
          setRowSelection({});
          refetch();
        }}
        onMutated={() => {
          setRowSelection({});
          refetch();
        }}
      />

      {/* Filter chips */}
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
              label={`${SPARE_PART_COLUMNS.find((c) => c.key === f.id)?.label ?? f.id}: ${chipValue(f.value)}`}
              onClear={() => setColumnFilters((prev) => prev.filter((x) => x.id !== f.id))}
            />
          ))}
          <button className="ml-1 text-[11px] text-muted-foreground hover:underline" onClick={() => setColumnFilters([])}>
            Clear all
          </button>
        </div>
      )}

      {/* Top horizontal scroll mirror */}
      <TopHorizontalScrollbar targetRef={scrollRef} width={totalWidth} frozenWidth={frozenWidth} />

      {/* Table */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div style={{ width: totalWidth }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-10 flex border-b bg-muted">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta as any;
                  const isFrozen = frozenColIds.includes(h.column.id);
                  const leftOffset = isFrozen ? leftOffsets.get(h.column.id) ?? 0 : undefined;
                  const bg = meta?.group ? GROUP_HEADER_BG[meta.group as keyof typeof GROUP_HEADER_BG] : "";
                  return (
                    <div
                      key={h.id}
                      style={{
                        width: h.getSize(),
                        position: isFrozen ? "sticky" : undefined,
                        left: leftOffset,
                        zIndex: isFrozen ? 20 : undefined,
                      }}
                      className={cn(
                        "relative flex select-none items-center gap-1 border-r px-2 py-1.5 text-xs font-medium",
                        isFrozen ? "bg-muted" : bg,
                      )}
                    >
                      {h.column.id === "doc_ref" && <Pin className="h-3 w-3 text-primary" />}
                      {h.column.id === "__select" || !h.column.getCanSort() ? (
                        <span className="flex flex-1 items-center gap-1 truncate">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="flex flex-1 items-center gap-1 truncate text-left"
                          title={typeof h.column.columnDef.header === "string" ? h.column.columnDef.header : ""}
                        >
                          <span className="truncate">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                          </span>
                          {sort === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : sort === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </button>
                      )}
                      {h.column.getCanFilter() && meta?.filterType && (
                        <ColumnFilterDropdown column={h.column} filterType={meta.filterType} />
                      )}
                      {h.column.getCanResize() && (
                        <div
                          onMouseDown={h.getResizeHandler()}
                          onTouchStart={h.getResizeHandler()}
                          className={cn(
                            "absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/40",
                            h.column.getIsResizing() && "bg-primary",
                          )}
                        />
                      )}
                    </div>
                  );
                }),
              )}
            </div>

            {/* Body */}
            <div style={{ height: virtualizer.getTotalSize() }} className="relative">
              {virtualizer.getVirtualItems().map((v) => {
                const row = rowModel.rows[v.index];
                if (!row) return null;
                const overdueRow = isOverdue(row.original.delivery_date as string | null);
                return (
                  <div
                    key={row.id}
                    style={{ transform: `translateY(${v.start}px)`, height: v.size, width: totalWidth }}
                    className={cn(
                      "absolute left-0 top-0 flex cursor-pointer border-b text-xs hover:bg-accent/40",
                      row.getIsSelected() && "bg-primary/5",
                      overdueRow && "bg-rose-50/40 dark:bg-rose-950/20",
                    )}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("input, button, [role='checkbox']")) return;
                      navigate({
                        to: "/closure/spare-part/records/$docRef",
                        params: { docRef: row.original.doc_ref },
                      });
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isFrozen = frozenColIds.includes(cell.column.id);
                      const leftOffset = isFrozen ? leftOffsets.get(cell.column.id) ?? 0 : undefined;
                      return (
                        <div
                          key={cell.id}
                          data-column-id={cell.column.id}
                          style={{
                            width: cell.column.getSize(),
                            position: isFrozen ? "sticky" : undefined,
                            left: leftOffset,
                            zIndex: isFrozen ? 5 : undefined,
                          }}
                          className={cn(
                            "flex items-center overflow-hidden truncate border-r px-2",
                            isFrozen && "bg-card",
                          )}
                          title={stringifyForTitle(cell.getValue())}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {rowModel.rows.length === 0 && !isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                일치하는 행이 없습니다.
              </div>
            )}
            {isLoading && (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">로딩 중…</div>
            )}
          </div>
        </div>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={filteredRowsForExport}
        visibleKeys={visibleKeysForExport}
      />
    </div>
  );
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

function stringifyForTitle(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function renderCell(key: string, raw: unknown) {
  const col = SPARE_PART_COLUMNS.find((c) => c.key === key);
  if (!col) return <span>{stringifyForTitle(raw)}</span>;
  if (raw == null || raw === "") return <span className="text-muted-foreground/40">—</span>;

  if (col.type === "badge" && key === "approval_code") {
    const code = String(raw);
    const cls = APPROVAL_CODE_COLORS[code] ?? "bg-muted text-foreground";
    return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{code}</span>;
  }
  if (col.type === "badge" && key === "plot") {
    const p = String(raw);
    const cls = PLOT_COLORS[p] ?? "bg-muted text-foreground";
    return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{p}</span>;
  }
  if (col.type === "boolean") {
    return raw === true ? (
      <Check className="h-3.5 w-3.5 text-emerald-600" />
    ) : raw === false ? (
      <X className="h-3.5 w-3.5 text-rose-500/70" />
    ) : (
      <span className="text-muted-foreground/40">—</span>
    );
  }
  if (col.type === "date") return <span className="tabular-nums">{formatDdMmm(String(raw))}</span>;
  if (col.type === "number") return <span className="tabular-nums">{formatNumber(Number(raw))}</span>;
  if (col.type === "cost") return <span className="tabular-nums">{formatNumber(Number(raw), 2)}</span>;
  if (col.type === "progress") {
    const n = Math.max(0, Math.min(1, Number(raw) || 0));
    return (
      <div className="flex w-full items-center gap-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary" style={{ width: `${n * 100}%` }} />
        </div>
        <span className="w-8 text-right text-[10px] tabular-nums">{Math.round(n * 100)}%</span>
      </div>
    );
  }
  return <span className="truncate">{String(raw)}</span>;
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

