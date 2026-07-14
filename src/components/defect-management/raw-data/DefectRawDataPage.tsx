import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Route as RawDataRoute } from "@/routes/_authenticated/closure/snag-management/raw-data";
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
import { Search, RefreshCcw, Upload, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
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
import {
  useDefectFieldConfig,
  useDefectFieldHelpers,
  DEFECT_FIELD_CONFIG_QK,
  persistDefectFieldConfig,
  useDefectColumnLabel,
  useDefectDefaults,
} from "@/hooks/useDefectFieldConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  EMPTY_TOKEN,
  TEXT_FILTER_FIELDS,
  DATE_FILTER_FIELDS,
  PROGRESS_FIELDS,
} from "@/lib/defect-management/filter-fns";
import { classifyDefectStage, formatDdMmm, isOverdueDefect } from "@/lib/defect-management/stage-utils";
import { getOriginHeaderStyle } from "@/lib/defect-management/origin-header-style";
import { ColumnFilterDropdown } from "./ColumnFilterDropdowns";
import { TopHorizontalScrollbar } from "./TopHorizontalScrollbar";
import { DefectStatusBadge } from "./DefectStatusBadge";
import { CriticalPendingBar } from "./CriticalPendingBar";
import { CriticalBulkBar } from "./CriticalBulkBar";
import { BulkEditBar } from "./BulkEditBar";
import { ExportDialog } from "./ExportDialog";
import { EditCellPopover } from "./EditCellPopover";
import { DefectStageProgress, DefectStageProgressLegend, classifyStage } from "./DefectStageProgress";
import { DefectColumnOrderMenu } from "./DefectColumnOrderMenu";
import { todayIso } from "@/lib/defect-management/stage-utils";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";

const SYSTEM_FROZEN_IDS = ["__select"];
// is_critical / stage_progress 는 사용자 드래그/pin/hide 가능한 일반 컬럼으로 취급.
// stage_progress 는 DEFECT_COLUMNS에 없는 가상 컬럼이므로 명시적으로 순서에 포함.
const DEFAULT_ORDER = [
  "is_critical",
  "stage_progress",
  ...DEFECT_COLUMNS.map((c) => c.key).filter((k) => k !== "is_critical"),
];
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

// ── URL <-> table state helpers ────────────────────────────────────────────
function parseSortFromUrl(s: string): SortingState {
  if (!s) return [{ id: "source_issue_no", desc: false }];
  try {
    return s.split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [id, dir] = p.split(":");
        return { id, desc: (dir ?? "asc").toLowerCase() === "desc" };
      });
  } catch { return [{ id: "source_issue_no", desc: false }]; }
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
      if (rest.length > 0) out.push({ column: id, op: hasEmpty ? "in_or_empty" as any : "in", value: rest });
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

function mergeUrlFilters(urlSearch: Record<string, any>, baseFilters: ColumnFiltersState): ColumnFiltersState {
  const overridden = new Set<string>();
  for (const [param, column] of Object.entries(URL_MAP)) {
    if (urlSearch[param]) overridden.add(column);
  }
  if ((urlSearch.dateStart || urlSearch.dateEnd) && urlSearch.dateField && DATE_FILTER_FIELDS.has(urlSearch.dateField)) {
    overridden.add(urlSearch.dateField);
  }
  const next = baseFilters.filter((filter) => !overridden.has(filter.id));
  for (const [param, column] of Object.entries(URL_MAP)) {
    const value = urlSearch[param];
    if (!value) continue;
    if (TEXT_FILTER_FIELDS.has(column)) next.push({ id: column, value: value === EMPTY_TOKEN ? { text: "", emptyOnly: true } : { text: value } });
    else next.push({ id: column, value: String(value).split(",").filter(Boolean) });
  }
  if ((urlSearch.dateStart || urlSearch.dateEnd) && urlSearch.dateField && DATE_FILTER_FIELDS.has(urlSearch.dateField)) {
    next.push({ id: urlSearch.dateField, value: { from: urlSearch.dateStart || undefined, to: urlSearch.dateEnd || undefined } });
  }
  if (urlSearch.hdecVerification) {
    next.push({ id: "hdec_verification", value: urlSearch.hdecVerification === EMPTY_TOKEN ? [EMPTY_TOKEN] : String(urlSearch.hdecVerification).split(",").filter(Boolean) });
  }
  if (urlSearch.hdecReason) {
    next.push({ id: "hdec_reason", value: urlSearch.hdecReason === EMPTY_TOKEN ? { text: "", emptyOnly: true } : { text: urlSearch.hdecReason } });
  }
  if (urlSearch.notClosureDone === "true") {
    next.push({ id: "closure_status", value: { text: "Done" } });
  }
  return next;
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

function uniqueOptions(items: DefectItem[], field: keyof DefectItem | string) {
  const set = new Set<string>();
  for (const r of items) {
    const v = (r as any)[field];
    if (v && typeof v === "string") set.add(v);
  }
  return [...set].sort().map((v) => ({ value: v, label: v }));
}

// Stage classifyStage 결과("done"/"wip"/"planned"/"hold"/"empty") → 화면 표시 라벨
function startStatusLabel(state: ReturnType<typeof classifyStage>): string | null {
  switch (state) {
    case "done": return "Done";
    case "wip": return "WIP";
    case "planned": return "Planned";
    case "hold": return "Delay";
    default: return null;
  }
}

function normalizeGroupLabel(group: string | null | undefined): string {
  const labels: Record<string, string> = {
    identity: "Identity",
    status: "Status",
    classification: "Classification",
    content: "Content",
    location: "Location",
    plan: "Plan",
    trade: "Classification",
    people: "Assignment",
    audit: "Audit",
    dates: "Schedule",
    progress: "Progress",
    refs: "References",
    flags: "Flags",
  };
  return labels[group ?? ""] ?? group ?? "Other";
}

function clearObjectKeys<T extends Record<string, any>>(keys: string[], value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) (out as any)[key] = undefined;
  return out;
}

const URL_MAP: Record<string, string> = {
  team: "team",
  subcontractor: "subcontractor_name",
  subsub: "subsub_name",
  hdecPic: "hdec_pic_name",
  hdecEng: "hdec_eng_name",
  capturedBy: "captured_by_name",
  level: "level_name",
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
  plan_group: "plan_group",
  building: "building",
  roomGroup: "room_group",
};

const DRILLDOWN_PARAMS = [
  "source", "actualComplete", "closureComplete", "overdue", "atRisk", "atRiskDays", "dueOn", "unplannedActualOn",
  "asOf", "stage", "remaining_stage", "remaining_asof", "capturedByGroup", "notClosureDone", "catADispute",
  "hdecVerification", "hdecReason", ...Object.keys(URL_MAP), "dateStart", "dateEnd", "dateField",
];

export function DefectRawDataPage() {
  const navigate = useNavigate();
  const urlSearch = RawDataRoute.useSearch();
  const { data: user } = useCurrentUser();
  const { data: fieldConfig = [] } = useDefectFieldConfig();
  const helpers = useDefectFieldHelpers();
  const labelOf = useDefectColumnLabel();
  const isAdmin = !!user?.isAdmin;
  const invalidateDefects = useInvalidateDefects();
  const qc = useQueryClient();

  const onServerReorder = useCallback(
    async (patches: Array<{ field_name: string; sort_order: number }>) => {
      try {
        await persistDefectFieldConfig(patches);
        qc.invalidateQueries({ queryKey: DEFECT_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 순서 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );
  const onServerVisibility = useCallback(
    async (field_name: string, is_visible: boolean) => {
      try {
        await persistDefectFieldConfig([{ field_name, is_visible }]);
        qc.invalidateQueries({ queryKey: DEFECT_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 노출 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );
  const onServerLabel = useCallback(
    async (field_name: string, display_name: string) => {
      try {
        await persistDefectFieldConfig([{ field_name, display_name }]);
        qc.invalidateQueries({ queryKey: DEFECT_FIELD_CONFIG_QK });
      } catch (e: any) {
        toast.error("컬럼 라벨 저장 실패", { description: e?.message ?? String(e) });
      }
    },
    [qc],
  );

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
    setColumnFilters(mergeUrlFilters(urlSearch as any, parseFiltersFromUrl(urlSearch.filters)));
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

  // 파생 start_status 컬럼 값 주입 (렌더/셀 접근용)
  const enrichedRows = useMemo(() => {
    const asOf = dataDate ?? todayIso();
    return rows.map((r) => ({ ...r, start_status: startStatusLabel(classifyStage(r as any, "start", asOf)) }));
  }, [rows, dataDate]);

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
      navigate({
        to: ".",
        search: (prev: any) => {
          const next = { ...prev, ...patch };
          for (const key of DRILLDOWN_PARAMS) {
            if (next[key] == null || next[key] === "") delete next[key];
          }
          return next;
        },
        replace: true,
      });
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
      id: "is_critical", accessorKey: "is_critical", header: labelOf("is_critical"), size: 72, enableSorting: true, enableColumnFilter: true,
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
      meta: {
        filterType: "multi-select",
        filterOptions: [
          { value: "Not Started", label: "Not Started" }, { value: "In Progress", label: "In Progress" },
          { value: "Completed", label: "Completed" }, { value: "Closed", label: "Closed" }, { value: "Delayed", label: "Delayed" },
        ],
      },
      cell: ({ row }) => <DefectStageProgress item={row.original as any} asOfDate={dataDate} />,
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
      cols.push(buildDataColumn(c, tab, includeInactive, dataDate, isAdmin, patchLocalItem, () => refetch(), labelOf(c.key)));
    }
    return cols;
  }, [orderedKeys, hiddenByTab, tab, includeInactive, dataDate, criticalPending, isAdmin, patchLocalItem, refetch, labelOf]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = { __select: true };
    const configured = new Map(fieldConfig.map((r) => [r.field_name, r]));
    const frozenSet = new Set(frozenExtras);
    for (const c of columns) {
      const id = (c as any).id ?? (c as any).accessorKey;
      if (!id || id in vis) continue;
      if (frozenSet.has(id)) { vis[id] = true; continue; }
      if (id in visibility) { vis[id] = visibility[id] !== false; continue; }
      // 파생 가상 컬럼: field_config에 없음. 기본 노출.
      if (id === "stage_progress" || id === "is_critical") { vis[id] = true; continue; }
      const row = configured.get(id);
      vis[id] = row ? !!row.is_visible : true;
    }
    return vis;
  }, [columns, fieldConfig, visibility, frozenExtras]);

  const table = useReactTable<DefectItem>({
    data: enrichedRows as DefectItem[],
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
    columnResizeMode: "onEnd",
    enableMultiSort: true,
    enableSortingRemoval: true,
    isMultiSortEvent: (event) => (event as unknown as MouseEvent).shiftKey,
    maxMultiSortColCount: 5,
    defaultColumn: { minSize: 64, maxSize: 640 },
    getRowId: (r) => r.id,
  });

  useEffect(() => {
    setRowSelection({});
  }, [columnFilters, q, tab]);

  const selectedRows = useMemo(() => table.getSelectedRowModel().rows.map((r) => r.original), [table, rowSelection, rows]);
  const bulkFields = useMemo(() => {
    const optionMap: Record<string, { value: string; label: string }[]> = {
      team: DEFECT_TEAMS.map((value) => ({ value, label: value })),
      status_raw: uniqueOptions(rows, "status_raw"),
      completion_status: uniqueOptions(rows, "completion_status"),
      closure_status: uniqueOptions(rows, "closure_status"),
      area_level: uniqueOptions(rows, "area_level"),
      area_location: uniqueOptions(rows, "area_location"),
      main_trade: uniqueOptions(rows, "main_trade"),
      sub_trade: uniqueOptions(rows, "sub_trade"),
      work_type: uniqueOptions(rows, "work_type"),
      priority: uniqueOptions(rows, "priority"),
      defect_type: uniqueOptions(rows, "defect_type"),
      subcontractor_name: uniqueOptions(rows, "subcontractor_name"),
      subsub_name: uniqueOptions(rows, "subsub_name"),
      hdec_pic_name: uniqueOptions(rows, "hdec_pic_name"),
      hdec_eng_name: uniqueOptions(rows, "hdec_eng_name"),
    };
    return DEFECT_COLUMNS.filter((c) => c.editable && c.editorType).map((c) => ({
      field: c.key,
      label: helpers.getLabel(c.key),
      inputType: c.editorType!,
      options: (c.options?.map((value) => ({ value, label: value })) ?? optionMap[c.key]) as any,
      group: normalizeGroupLabel(c.group),
    }));
  }, [rows, helpers]);
  const exportColumns = useMemo(() => DEFECT_COLUMNS.map((c) => ({ key: c.key, label: helpers.getLabel(c.key) })), [helpers]);
  const criticalPendingCount = summary?.critical_pending ?? 0;
  const unclosedCount = counts?.unclosed_count ?? 0;
  const closedCount = counts?.closed_count ?? 0;

  const activeUrlFilters = useMemo(() => {
    const labels: Record<string, string> = {
      q: "Search",
      team: "Team",
      subcontractor: "Subcontractor",
      subsub: "Sub-Sub",
      hdecPic: "HDEC PIC",
      hdecEng: "HDEC ENG",
      capturedBy: "Captured By",
      capturedByGroup: "Captured By Group",
      level: "Level",
      mainTrade: "Main Trade",
      subTrade: "Sub Trade",
      workType: "Work Type",
      classificationSource: "Classification",
      status: "Status",
      closureStatus: "Closure",
      issueNo: "Issue No",
      subcontractorIssueNo: "Subcontractor Issue No",
      critical: "Critical",
      priority: "Priority",
    };
    const chips: { label: string; clears: string[] }[] = [];
    for (const [param, label] of Object.entries(labels)) {
      const value = (urlSearch as any)[param];
      if (!value) continue;
      chips.push({ label: `${label} ${value === EMPTY_TOKEN ? "(Blank)" : value}`, clears: [param] });
    }
    if (urlSearch.dateStart || urlSearch.dateEnd) chips.push({ label: `${urlSearch.dateField ? helpers.getLabel(urlSearch.dateField) : "Date"} ${urlSearch.dateStart || ""}${urlSearch.dateStart && urlSearch.dateEnd ? " → " : ""}${urlSearch.dateEnd || ""}`, clears: ["dateStart", "dateEnd", "dateField"] });
    if (urlSearch.dueOn) chips.push({ label: `${urlSearch.stage || "Stage"} due ${urlSearch.dueOn} (open)`, clears: ["dueOn", "stage"] });
    if (urlSearch.unplannedActualOn) chips.push({ label: `${urlSearch.stage || "Stage"} actual ${urlSearch.unplannedActualOn} (unplanned)`, clears: ["unplannedActualOn", "stage"] });
    if (urlSearch.actualComplete === "true" && urlSearch.closureComplete === "false") chips.push({ label: "Remain Inspection", clears: ["actualComplete", "closureComplete"] });
    else {
      if (urlSearch.actualComplete === "true" || urlSearch.actualComplete === "false") chips.push({ label: `Completion: ${urlSearch.actualComplete === "true" ? "Done" : "Open"}`, clears: ["actualComplete"] });
      if (urlSearch.closureComplete === "true" || urlSearch.closureComplete === "false") chips.push({ label: `Closure: ${urlSearch.closureComplete === "true" ? "Done" : "Open"}`, clears: ["closureComplete"] });
    }
    if (urlSearch.overdue === "true") chips.push({ label: urlSearch.stage ? `Overdue — ${urlSearch.stage}` : "Overdue", clears: ["overdue", "stage", "asOf"] });
    if (urlSearch.remaining_stage && urlSearch.remaining_asof) chips.push({ label: `Remaining — ${urlSearch.remaining_stage} @ ${urlSearch.remaining_asof}`, clears: ["remaining_stage", "remaining_asof"] });
    if (urlSearch.atRisk === "true") chips.push({ label: urlSearch.atRiskDays ? `At Risk (≤ ${urlSearch.atRiskDays}d)` : "At Risk", clears: ["atRisk", "atRiskDays"] });
    if (urlSearch.notClosureDone === "true") chips.push({ label: "Closure ≠ Done", clears: ["notClosureDone"] });
    if (urlSearch.hdecVerification) chips.push({ label: `HDEC Verification: ${urlSearch.hdecVerification === EMPTY_TOKEN ? "(Blank)" : urlSearch.hdecVerification}`, clears: ["hdecVerification"] });
    if (urlSearch.catADispute === "xor") chips.push({ label: "Cat A Dispute (LL ≠ HDEC)", clears: ["catADispute"] });
    if (urlSearch.hdecReason) chips.push({ label: `HDEC Reason: ${urlSearch.hdecReason === EMPTY_TOKEN ? "(Blank)" : urlSearch.hdecReason}`, clears: ["hdecReason"] });
    return chips;
  }, [urlSearch, helpers]);

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
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Snag List — Raw Data</h1>
          <p className="text-sm text-muted-foreground">Issue No and subcontractor issue tracking data.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/closure/snag-management/import"><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <DefectColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            onOrderChange={setOrder}
            onVisibilityChange={(v) => setVisibility(v)}
            onFrozenChange={setFrozenExtras}
            isAdmin={isAdmin}
            onServerReorder={onServerReorder}
            onServerVisibility={onServerVisibility}
            onServerLabel={onServerLabel}
          />
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1.5 h-3.5 w-3.5" /> Export Excel</Button>
          <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1.5 h-3.5 w-3.5" /> Export</Button>
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

      {activeUrlFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-xs font-medium text-primary">Active URL filters:</span>
          {activeUrlFilters.map((filter) => (
            <button key={filter.label} onClick={() => setUrl(clearObjectKeys(filter.clears, urlSearch as any))} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20" title="Click to remove">
              {filter.label} ✕
            </button>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setUrl(clearObjectKeys(DRILLDOWN_PARAMS, urlSearch as any))}>Clear all</Button>
        </div>
      )}

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Active column filters:</span>
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
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search defects... (comma = AND)"
            className="h-9 pl-8"
          />
        </div>
        <span className="self-center text-sm text-muted-foreground">{total.toLocaleString()} records</span>
        {sorting.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setSorting([{ id: "source_issue_no", desc: false }])}>Clear sort ({sorting.length})</Button>
        )}
        <span className="hidden self-center text-xs text-muted-foreground md:inline">Tip: Shift+Click headers for multi-sort · Click <Filter className="inline h-3 w-3" /> to filter columns</span>
        <div className="ml-auto"><DefectStageProgressLegend /></div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={includeInactive} onCheckedChange={(v) => setUrl({ includeInactive: !!v, page: 1 })} className="h-3.5 w-3.5" />
          비활성 포함
        </label>
      </div>

      <CriticalBulkBar isAdmin={isAdmin} selectedRows={selectedRows as any} pending={criticalPending} setPending={setCriticalPending} />

      <BulkEditBar
        selectedRows={selectedRows as any}
        fields={bulkFields}
        exportColumns={exportColumns}
        canEdit={isAdmin}
        onClearSelection={() => setRowSelection({})}
        onApplied={() => { setRowSelection({}); invalidateDefects(); }}
      />

      <DefectRawTableView
        table={table}
        tableRef={tableRef}
        loading={!stateLoaded || isFetching}
        dataDate={dataDate}
        frozenColIds={[...SYSTEM_FROZEN_IDS, ...frozenExtras]}
        getSourceOrigin={helpers.getSourceOrigin}
        onRowClick={(r) => navigate({ to: "/closure/snag-management/detail/$id", params: { id: r.id } })}
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
  headerLabel?: string,
): ColumnDef<DefectItem> {
  const filterType =
    DATE_FILTER_FIELDS.has(c.key) ? "date-range" :
    (TEXT_FILTER_FIELDS.has(c.key) || PROGRESS_FIELDS.has(c.key)) ? "text" :
    "multi-select";
  // multi-select 컬럼은 서버 facet 사용
  const serverFacet = filterType === "multi-select" ? c.key : null;
  // 파생 컬럼(DB 저장값 없음)은 서버 정렬/필터 불가
  const isDerived = !!c.derived;
  return {
    id: c.key,
    accessorKey: c.key,
    header: headerLabel ?? c.label,
    size: c.width,
    // manualFiltering=true 상태이므로 filterFn 불필요
    enableSorting: !isDerived && (!PROGRESS_FIELDS.has(c.key) || c.type === "percent"),
    enableColumnFilter: !isDerived,
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
  if (c.key === "start_status") return <DefectStatusBadge status={v} />;
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
  getSourceOrigin: (field: string) => "hdec" | "aconex" | "system";
  onRowClick: (row: DefectItem) => void;
}

function DefectRawTableView({ table, tableRef, loading, dataDate, frozenColIds, getSourceOrigin, onRowClick }: TableViewProps) {
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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const autoSizeColumn = (columnId: string) => {
    const container = tableRef.current;
    if (!container) return;
    const cells = container.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`);
    let max = 72;
    cells.forEach((cell) => {
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.style.cssText = "position:absolute; visibility:hidden; width:auto; white-space:nowrap; max-width:none; left:-9999px; top:0;";
      document.body.appendChild(clone);
      max = Math.max(max, clone.getBoundingClientRect().width);
      document.body.removeChild(clone);
    });
    table.setColumnSizing((prev) => ({ ...prev, [columnId]: Math.min(Math.ceil(max) + 18, 640) }));
  };

  const stickyBgFor = (row: DefectItem, index: number): string => {
    const closed = Boolean((row as any).actual_closure_date) || /closed|complete|done/i.test(`${(row as any).closure_status ?? ""} ${(row as any).status_raw ?? ""}`);
    const overdue = isOverdueDefect(row as any, dataDate);
    const base = "hsl(var(--background))";
    const opaque = `linear-gradient(${base}, ${base})`;
    if (hoveredIndex === index) return `${opaque}, hsl(var(--muted) / 0.95)`;
    if (overdue && !closed) return `${opaque}, hsl(var(--destructive) / 0.06)`;
    if (closed) return `${opaque}, hsl(var(--muted) / 0.45)`;
    return base;
  };

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
                const originStyle = getOriginHeaderStyle(getSourceOrigin(header.column.id));
                return (
                  <TableHead
                    key={header.id}
                    data-column-id={header.column.id}
                    title={typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id}
                    style={{
                      width: header.getSize(), minWidth: header.getSize(), maxWidth: header.getSize(),
                      ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 3, background: originStyle.stickyBg } : {}),
                    }}
                    className={cn("relative h-9 cursor-pointer select-none whitespace-nowrap border-b px-4 py-0 text-left text-xs font-medium",
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
                        <span onClick={(e) => e.stopPropagation()}><ColumnFilterDropdown column={header.column} /></span>
                      )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => { e.stopPropagation(); autoSizeColumn(header.column.id); }}
                        title="Drag to resize, double-click to auto-fit"
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
                      onMouseEnter={() => setHoveredIndex(vr.index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => onRowClick(row.original)}
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
                              height: 36,
                              maxHeight: 36,
                              overflow: "hidden",
                              ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 1, background: stickyBgFor(row.original, vr.index) } : {}),
                            }}
                            className={cn("truncate whitespace-nowrap py-2 text-xs", isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]")}
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