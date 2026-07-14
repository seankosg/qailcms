import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Filter,
  History,
  Loader2,
  Pin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Sliders,
  Upload,
  X,
} from "lucide-react";
import {
  AUTO_JUDGMENT_COLORS,
  DISCIPLINE_COLORS,
  TEAM_COLORS,
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
import { ColumnOrderMenu } from "./ColumnOrderMenu";
import { ExportDialog } from "./ExportDialog";
import { HistoryDrawer } from "./HistoryDrawer";
import { TopHorizontalScrollbar } from "@/components/spare-part/raw-data/TopHorizontalScrollbar";
import { AddChildTaskDialog, type ParentSeed } from "./AddChildTaskDialog";
import { AlarmBadge } from "./AlarmBadge";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import {
  runRollupAllParents,
  runRecalcAutoJudgment,
} from "@/lib/task-management/rollup.functions";
import { expectedProgressToday, todayGap } from "@/lib/task-management/derived";
import {
  useTaskManagementFieldConfig,
  buildTmLabelOverrides,
  TASK_MANAGEMENT_FIELD_CONFIG_QK,
  persistTmFieldConfig,
} from "@/hooks/useTaskManagementFieldConfig";
import { useQueryClient } from "@tanstack/react-query";

type Row = Record<string, unknown> & { id: string; task_no: string; discipline: string };

const DEFAULT_SORTING: SortingState = [{ id: "discipline", desc: false }];
const DEFAULT_FROZEN_EXTRAS = ["discipline", "level", "task_name"];
const DEFAULT_ORDER = TM_COLUMNS.map((c) => c.key).filter((k) => k !== "task_no");

interface PersistedState {
  sorting: SortingState;
  sizing: ColumnSizingState;
  visibility: VisibilityState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  order: string[];
  frozenExtras: string[];
}

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
    team: TEAM_COLORS,
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
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const canEdit = !!currentUser?.isAdmin;
  const { data: fieldConfig } = useTaskManagementFieldConfig();
  const labelOverrides = useMemo(() => buildTmLabelOverrides(fieldConfig), [fieldConfig]);
  const viewPref = useUserViewPreference("task-management.raw-data.v1");
  const qc = useQueryClient();

  const onServerReorder = useCallback(
    async (patches: Array<{ field_name: string; sort_order: number }>) => {
      try {
        await persistTmFieldConfig(patches);
        qc.invalidateQueries({ queryKey: TASK_MANAGEMENT_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 순서 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );
  const onServerVisibility = useCallback(
    async (field_name: string, is_visible: boolean) => {
      try {
        await persistTmFieldConfig([{ field_name, is_visible }]);
        qc.invalidateQueries({ queryKey: TASK_MANAGEMENT_FIELD_CONFIG_QK });
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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [historyTask, setHistoryTask] = useState<{ discipline: string; task_no: string; task_name?: string | null } | null>(null);
  const [rollupBusy, setRollupBusy] = useState<null | "rollup" | "judgment">(null);
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [addChildParent, setAddChildParent] = useState<ParentSeed | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rollupFn = useServerFn(runRollupAllParents);
  const judgmentFn = useServerFn(runRecalcAutoJudgment);

  // initial load from server-backed view preference (with local cache fallback)
  useEffect(() => {
    if (!viewPref.ready) return;
    if (stateLoaded) return;
    const s: Partial<PersistedState> = (viewPref.state ?? {}) as Partial<PersistedState>;

    const validKeys = new Set(TM_COLUMNS.map((c) => c.key).filter((k) => k !== "task_no"));
    const validAll = new Set<string>(["__select", "task_no", ...validKeys]);

    const savedOrder = (s.order ?? []).filter((k) => validKeys.has(k));
    let mergedOrder: string[];
    if (!savedOrder.length) {
      mergedOrder = DEFAULT_ORDER;
    } else {
      const savedSet = new Set(savedOrder);
      mergedOrder = [...savedOrder];
      DEFAULT_ORDER.forEach((k, defIdx) => {
        if (savedSet.has(k)) return;
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

    const savedFrozen = (s.frozenExtras ?? []).filter((k) => validKeys.has(k));
    const frozenFill = DEFAULT_FROZEN_EXTRAS.filter((k) => !savedFrozen.includes(k));
    const mergedFrozen = [...savedFrozen, ...frozenFill].slice(0, 3);

    const cleanedVisibility: VisibilityState = {};
    for (const [k, v] of Object.entries(s.visibility ?? {})) {
      if (validKeys.has(k)) cleanedVisibility[k] = v as boolean;
    }
    const cleanedSizing: ColumnSizingState = {};
    for (const [k, v] of Object.entries(s.sizing ?? {})) {
      if (validAll.has(k)) cleanedSizing[k] = v as number;
    }
    const cleanedFilters: ColumnFiltersState = (s.columnFilters ?? []).filter((f) =>
      validKeys.has(f.id),
    );

    setSorting(
      s.sorting?.length ? s.sorting.filter((x) => validAll.has(x.id)) : DEFAULT_SORTING,
    );
    setSizing(cleanedSizing);
    setVisibility(cleanedVisibility);
    setOrder(mergedOrder);
    setFrozenExtras(mergedFrozen.length ? mergedFrozen : DEFAULT_FROZEN_EXTRAS);
    setColumnFilters(cleanedFilters);
    setGlobalFilter(s.globalFilter ?? "");
    setSearchInput(s.globalFilter ?? "");
    try {
      const savedCollapsed = localStorage.getItem("qail.task-management.collapsed");
      if (savedCollapsed) setCollapsedParents(new Set(JSON.parse(savedCollapsed)));
    } catch {
      // ignore
    }
    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPref.ready, viewPref.state]);

  useEffect(() => {
    const t = setTimeout(() => setGlobalFilter(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // persist to server (with local cache) — debounce lives inside the hook
  useEffect(() => {
    if (!stateLoaded) return;
    viewPref.save({
      sorting,
      sizing,
      visibility,
      columnFilters,
      globalFilter,
      order,
      frozenExtras,
    } satisfies PersistedState);
  }, [
    stateLoaded,
    sorting,
    sizing,
    visibility,
    columnFilters,
    globalFilter,
    order,
    frozenExtras,
    viewPref,
  ]);

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

  // discipline-task_no 단위 collapse 키 유지 — 접힌 부모의 자식 행 숨김
  const visibleRows = useMemo(() => {
    if (collapsedParents.size === 0) return rows;
    return rows.filter((r) => {
      const parent = (r as any).parent_task_no as string | null;
      const disc = (r as any).discipline as string;
      if (!parent) return true;
      return !collapsedParents.has(`${disc}::${parent}`);
    });
  }, [rows, collapsedParents]);

  const parentKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows) {
      if ((r as any).level === "parent") {
        keys.push(`${(r as any).discipline}::${(r as any).task_no}`);
      }
    }
    return keys;
  }, [rows]);

  function toggleCollapse(disc: string, taskNo: string) {
    const key = `${disc}::${taskNo}`;
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem("qail.task-management.collapsed", JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function setAllCollapsed(collapsed: boolean) {
    const next = collapsed ? new Set(parentKeys) : new Set<string>();
    setCollapsedParents(next);
    try {
      localStorage.setItem("qail.task-management.collapsed", JSON.stringify([...next]));
    } catch {
      // ignore
    }
  }

  const orderedKeys = useMemo(() => {
    const frozenSet = new Set(frozenExtras);
    const rest = order.filter((k) => !frozenSet.has(k) && k !== "task_no");
    return ["__select", "task_no", ...frozenExtras, ...rest];
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
        });
        continue;
      }
      const c = TM_COLUMNS.find((x) => x.key === key);
      if (!c) continue;
      // 파생 컬럼(오늘 계획/오늘 차이) — 실제 DB 값이 없으므로 accessorFn으로 계산
      if (c.key === "expected_progress_today" || c.key === "today_gap") {
        cols.push({
          id: c.key,
          size: c.width,
          minSize: 60,
          maxSize: 240,
          enableSorting: true,
          enableColumnFilter: false,
          accessorFn: (r: Row) => {
            if (c.key === "expected_progress_today") return expectedProgressToday(r as any);
            return todayGap(r as any);
          },
          header: labelOverrides[c.key] ?? c.label,
          meta: { group: c.group },
          cell: ({ getValue }) => {
            const v = Number(getValue()) || 0;
            if (c.key === "expected_progress_today") {
              return (
                <span className="w-full text-right tabular-nums">
                  {(v * 100).toFixed(1)}%
                </span>
              );
            }
            const cls = v < -0.05 ? "text-rose-600" : v > 0.05 ? "text-emerald-600" : "text-muted-foreground";
            const sign = v > 0 ? "+" : "";
            return (
              <span className={cn("w-full text-right tabular-nums", cls)}>
                {sign}
                {(v * 100).toFixed(1)}%p
              </span>
            );
          },
        });
        continue;
      }
      const filterType = inferTmFilterType(c.type);
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
          if (c.key === "auto_judgment") {
            if (val == null || val === "")
              return <span className="text-muted-foreground/40">—</span>;
            const rr = row.original as any;
            return (
              <AlarmBadge
                value={String(val)}
                todayGap={
                  rr.today_gap != null
                    ? Number(rr.today_gap)
                    : todayGap({
                        actual_progress: rr.actual_progress,
                        plan_start: rr.plan_start,
                        plan_end: rr.plan_end,
                      })
                }
                slipDays={rr.slip_days != null ? Number(rr.slip_days) : null}
                actualProgress={
                  rr.actual_progress != null ? Number(rr.actual_progress) : null
                }
              />
            );
          }
          if (c.key === "task_no") {
            const rr = row.original as Row;
            const isParent = rr.level === "parent";
            const isChild = !!(rr as any).parent_task_no;
            const disc = String(rr.discipline);
            const collapseKey = `${disc}::${rr.task_no}`;
            const isCollapsed = collapsedParents.has(collapseKey);
            return (
              <span className="flex w-full items-center gap-1">
                {isParent ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(disc, String(rr.task_no));
                    }}
                    className="rounded p-0.5 hover:bg-muted"
                    title={isCollapsed ? "펼치기" : "접기"}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                ) : isChild ? (
                  <span className="ml-2 text-muted-foreground/60">└</span>
                ) : (
                  <span className="w-4" />
                )}
                <Link
                  to="/closure/task-management/detail/$id"
                  params={{ id: String(rr.id) }}
                  className="min-w-0 flex-1 truncate text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {rendered}
                </Link>
                {isParent && canEdit && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddChildParent({
                        task_no: String(rr.task_no),
                        discipline: disc as ParentSeed["discipline"],
                        task_name: (rr as any).task_name ?? null,
                        category: (rr as any).category ?? null,
                        pic: (rr as any).pic ?? null,
                        floor_level: (rr as any).floor_level ?? null,
                        location: (rr as any).location ?? null,
                        risk: (rr as any).risk ?? null,
                        plan_start: (rr as any).plan_start ?? null,
                        plan_end: (rr as any).plan_end ?? null,
                      });
                    }}
                    className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                    title="하위 태스크 추가"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          }
          if (false) {
            return (
              <Link
                to="/closure/task-management/detail/$id"
                params={{ id: String((row.original as Row).id) }}
                className="text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {rendered}
              </Link>
            );
          }
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
  }, [canEdit, refetch, orderedKeys, labelOverrides, collapsedParents]);

  const table = useReactTable({
    data: visibleRows,
    columns,
    state: {
      sorting,
      columnSizing: sizing,
      columnVisibility: visibility,
      columnFilters,
      globalFilter,
      rowSelection,
    },
    getRowId: (r) => String(r.id),
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
  const frozenColIds = ["__select", "task_no", ...frozenExtras];
  const frozenWidth = table
    .getVisibleLeafColumns()
    .filter((c) => frozenColIds.includes(c.id))
    .reduce((s, c) => s + c.getSize(), 0);

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

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection],
  );
  const selectedRowObjects = useMemo(() => {
    const set = new Set(selectedIds);
    return rows.filter((r) => set.has(String(r.id)));
  }, [rows, selectedIds]);

  const selectedExportColumns = useMemo(
    () =>
      table
        .getVisibleLeafColumns()
        .filter((c) => c.id !== "__select")
        .map((c) => ({
          key: c.id,
          label:
            labelOverrides[c.id] ??
            TM_COLUMNS.find((x) => x.key === c.id)?.label ??
            c.id,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeys, visibility, labelOverrides],
  );

  const visibleKeysForExport = useMemo(
    () =>
      table
        .getVisibleLeafColumns()
        .map((c) => c.id)
        .filter((id) => id !== "__select"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeys, visibility],
  );
  const filteredRowsForExport = useMemo(
    () => rowModel.rows.map((r) => r.original),
    [rowModel.rows],
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
    setSizing({});
    setVisibility({});
    setColumnFilters([]);
    setGlobalFilter("");
    setSearchInput("");
    setOrder(DEFAULT_ORDER);
    setFrozenExtras(DEFAULT_FROZEN_EXTRAS);
    setRowSelection({});
  }

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0);
  const allCollapsed = parentKeys.length > 0 && collapsedParents.size >= parentKeys.length;

  async function handleRollup() {
    setRollupBusy("rollup");
    try {
      const res = await Promise.all([
        rollupFn({ data: { discipline: "건축" } }),
        rollupFn({ data: { discipline: "전기" } }),
        rollupFn({ data: { discipline: "설비" } }),
      ]);
      const total = res.reduce((s, r) => s + r.rolledUp, 0);
      toast.success(`Summary 재계산 완료: ${total}개 parent`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "재계산 실패");
    } finally {
      setRollupBusy(null);
    }
  }

  async function handleRecalcJudgment() {
    setRollupBusy("judgment");
    try {
      const res = await judgmentFn({ data: {} });
      toast.success(`Auto‑judgment 재계산 완료: ${res.updated}행`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "재계산 실패");
    } finally {
      setRollupBusy(null);
    }
  }

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
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setAllCollapsed(!allCollapsed)}
            title={allCollapsed ? "모두 펼치기" : "모두 접기"}
            disabled={parentKeys.length === 0}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />
            ) : (
              <ChevronsDownUp className="mr-1 h-3.5 w-3.5" />
            )}
            {allCollapsed ? "Expand All" : "Collapse All"}
          </Button>
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleRollup}
                disabled={!!rollupBusy}
                title="자식 진도로 parent 자동 재계산"
              >
                {rollupBusy === "rollup" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                )}
                Rollup
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleRecalcJudgment}
                disabled={!!rollupBusy}
                title="임계값 기준으로 자동 판정 재계산"
              >
                {rollupBusy === "judgment" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                )}
                Judgment
              </Button>
              <Button variant="outline" size="sm" className="h-8" asChild>
                <Link to="/admin/task-thresholds">
                  <Sliders className="mr-1 h-3.5 w-3.5" /> 임계값
                </Link>
              </Button>
            </>
          )}
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
              label={`${labelOverrides[f.id] ?? TM_COLUMNS.find((c) => c.key === f.id)?.label ?? f.id}: ${chipValue(f.value)}`}
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

      <TopHorizontalScrollbar targetRef={scrollRef} width={totalWidth} frozenWidth={frozenWidth} />

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div style={{ width: totalWidth }} className="relative">
            <div className="sticky top-0 z-10 flex border-b bg-muted/70 backdrop-blur">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta as any;
                  const isFrozen = frozenColIds.includes(h.column.id);
                  const leftOffset = isFrozen ? leftOffsets.get(h.column.id) ?? 0 : undefined;
                  const bg = meta?.group
                    ? GROUP_HEADER_BG[meta.group as keyof typeof GROUP_HEADER_BG]
                    : "";
                  const canSort = h.column.getCanSort();
                  const isSelectCol = h.column.id === "__select";
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
                        bg,
                        isFrozen && "bg-muted",
                      )}
                    >
                      {h.column.id === "task_no" && <Pin className="h-3 w-3 text-primary" />}
                      {isSelectCol || !canSort ? (
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
                      "group absolute left-0 top-0 flex border-b text-xs hover:bg-accent/40",
                      row.getIsSelected() && "bg-primary/5",
                      isParent && "bg-muted/30 font-medium",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isFrozen = frozenColIds.includes(cell.column.id);
                      const leftOffset = isFrozen
                        ? leftOffsets.get(cell.column.id) ?? 0
                        : undefined;
                      const isTaskNoCell = cell.column.id === "task_no";
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
                            isFrozen && (isParent ? "bg-muted" : "bg-card"),
                          )}
                          title={stringifyForTitle(cell.getValue())}
                        >
                          <div className="min-w-0 flex-1 truncate">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                          {isTaskNoCell && (
                            <button
                              type="button"
                              className="ml-1 rounded p-0.5 opacity-50 hover:opacity-100 hover:bg-muted"
                              title="이력 보기"
                              onClick={(e) => {
                                e.stopPropagation();
                                const r = row.original as Row;
                                setHistoryTask({
                                  discipline: String(r.discipline),
                                  task_no: String(r.task_no),
                                  task_name: (r as any).task_name ?? null,
                                });
                              }}
                            >
                              <History className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
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

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={filteredRowsForExport as Record<string, unknown>[]}
        visibleKeys={visibleKeysForExport}
      />

      <HistoryDrawer
        open={!!historyTask}
        onClose={() => setHistoryTask(null)}
        discipline={historyTask?.discipline ?? null}
        taskNo={historyTask?.task_no ?? null}
        taskName={historyTask?.task_name ?? null}
      />

      <AddChildTaskDialog
        open={!!addChildParent}
        onOpenChange={(o) => !o && setAddChildParent(null)}
        parent={addChildParent}
        onCreated={() => {
          setAddChildParent(null);
          refetch();
        }}
      />
    </div>
  );
}

function stringifyForTitle(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
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