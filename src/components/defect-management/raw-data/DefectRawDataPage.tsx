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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search, Upload, Filter, Download, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { bulkClassifyDefects } from "@/lib/defect-management/classifier/bulk-classify.functions";
import {
  DEFECT_COLUMNS,
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
  fetchDefectItemIds,
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
import { useTeamOptions } from "@/lib/team/team-master";
import { canEditRawRow } from "@/lib/auth/roles";
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
import { exportAllUnclosed } from "./exportAllUnclosed";
import { ExportDialog } from "./ExportDialog";
import {
  inferSourceLabel,
  summarizeServerFilters,
  summarizeServerSort,
} from "@/lib/defect-management/export-meta";
import { EditCellPopover } from "./EditCellPopover";
import { DefectStageProgress, DefectStageProgressLegend, classifyStage } from "./DefectStageProgress";
import { DefectColumnOrderMenu } from "./DefectColumnOrderMenu";
import { todayIso } from "@/lib/defect-management/stage-utils";
import { useSnagAsOf } from "@/hooks/useSnagAsOf";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SYSTEM_FROZEN_IDS = ["__select"];
// is_critical / stage_progress 는 사용자 드래그/pin/hide 가능한 일반 컬럼으로 취급.
// stage_progress 는 DEFECT_COLUMNS에 없는 가상 컬럼이므로 명시적으로 순서에 포함.
const DEFAULT_ORDER = [
  "is_critical",
  "stage_progress",
  ...DEFECT_COLUMNS.map((c) => c.key).filter((k) => k !== "is_critical"),
];
const PAGE_SIZE_OPTIONS: Array<number | "all"> = [50, 100, 200, 500, "all"];
const ALL_PAGE_LIMIT = 1_000_000;

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

/** Progress Matrix 셀 드릴다운 전용 필터. 술어 정본 = public.snag_progress_events(). */
const CELL_RANGE_ID = "__snag_cell_range__";

// TanStack Table columnFilters → server filter payload
function toServerFilters(f: ColumnFiltersState): DefectServerFilter[] {
  const out: DefectServerFilter[] = [];
  for (const cf of f) {
    const id = cf.id;
    const v: any = cf.value;
    if (v == null) continue;
    // Progress Matrix 셀 드릴다운 (집계와 동일 술어 = public.snag_progress_events)
    if (id === CELL_RANGE_ID && typeof v === "object" && v.stage && v.from) {
      out.push({
        column: "__cell__",
        op: v.field === "actual" ? "stage_actual_range" : "stage_plan_range",
        value: {
          stage: v.stage,
          field: v.field,
          from: v.from,
          to: v.to ?? v.from,
          planMode: v.planMode ?? "baseline",
          asOf: v.asOf ?? "",
        },
      });
      continue;
    }
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
  // Progress Matrix 셀 드릴다운 조건은 TanStack Table 의 columnFilters 에 넣지 않는다.
  // (미정의 컬럼 id 는 테이블이 상태에서 제거해 조건이 소실됨 → URL 파생 서버 필터로 별도 운반)
  const next = baseFilters.filter((filter) => !overridden.has(filter.id) && filter.id !== CELL_RANGE_ID);
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
  "cellStage", "cellField", "cellFrom", "cellTo", "cellMode",
  "noPlanStages",
];

/** 셀 드릴다운 조건은 URL 에 상주해야 하므로 progress 진입 정리 시 보존한다. */
const CELL_PARAMS = ["cellStage", "cellField", "cellFrom", "cellTo", "cellMode", "asOf"];

export function DefectRawDataPage() {
  const navigate = useNavigate();
  const urlSearch = RawDataRoute.useSearch();
  const { data: user } = useCurrentUser();
  const { data: teamOptions = [] } = useTeamOptions();
  const teamCodesForEdit = useMemo(() => teamOptions.map((t) => t.code), [teamOptions]);
  const canEditRow = useCallback(
    (row: DefectItem) => canEditRawRow(user ?? null, "defect_items_raw", row as unknown as Record<string, any>),
    [user],
  );
  const { data: fieldConfig = [] } = useDefectFieldConfig();
  const helpers = useDefectFieldHelpers();
  const labelOf = useDefectColumnLabel();
  const { defaultOrder, defaultVisibility } = useDefectDefaults();
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

  // "all" 은 대시보드 드릴다운 전용 (Unclosed/Closed 양쪽을 포함해야 셀 숫자와 일치)
  const tab: DefectStatusGroup = (urlSearch.tab === "closed"
    ? "closed"
    : urlSearch.tab === "all"
      ? "all"
      : "unclosed") as DefectStatusGroup;
  // 비활성 레코드는 항상 제외 (관리자 페이지에서 별도 관리 예정)
  const includeInactive = false;
  const isAllPage = urlSearch.pageSize === "all";
  const pageSize = isAllPage
    ? ALL_PAGE_LIMIT
    : (PAGE_SIZE_OPTIONS as Array<number | "all">).includes(Number(urlSearch.pageSize))
      ? Number(urlSearch.pageSize)
      : 100;
  const page = isAllPage ? 1 : Math.max(1, Number(urlSearch.page) || 1);

  // View preference: per-tab
  const viewPref = useUserViewPreference(`defect-management.raw-data.${tab}.v2`);

  const tableRef = useRef<HTMLDivElement | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [sorting, setSorting] = useState<SortingState>(parseSortFromUrl(urlSearch.sort));
  // source=progress로 진입 시엔 기존 filters= JSON을 무시하고 progress 파라미터만으로 재구성
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    urlSearch.source === "progress"
      ? mergeUrlFilters(urlSearch as any, [])
      : parseFiltersFromUrl(urlSearch.filters),
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchInput, setSearchInput] = useState(urlSearch.q ?? "");
  const [criticalPending, setCriticalPending] = useState<Map<string, boolean>>(new Map());
  // R2: 셀 렌더 시 최신 criticalPending 을 읽기 위한 ref. columns useMemo 가
  // criticalPending 상태에 의존하면 체크 1회로 전체 컬럼/셀 memo 무효화 →
  // 스크롤 시 전체 재렌더. ref 로 우회하고 컬럼 배열 identity 를 안정화한다.
  const criticalPendingRef = useRef(criticalPending);
  criticalPendingRef.current = criticalPending;
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [frozenExtras, setFrozenExtras] = useState<string[]>([]);
  // 필터/검색 조건에 매칭되는 전체 ID 세트 (대량 선택용). null이면 미활성.
  const [allMatchIds, setAllMatchIds] = useState<string[] | null>(null);
  const [fetchingAllMatch, setFetchingAllMatch] = useState(false);

  // Sync URL → local (탭 전환 시 URL의 sort/filters를 초기화 반영)
  useEffect(() => {
    setSorting(parseSortFromUrl(urlSearch.sort));
    // Progress 매트릭스에서 진입한 경우 기존 필터를 완전히 리셋하고 progress 파라미터만 적용
    const base = urlSearch.source === "progress" ? [] : parseFiltersFromUrl(urlSearch.filters);
    setColumnFilters(mergeUrlFilters(urlSearch as any, base));
    setSearchInput(urlSearch.q ?? "");
    setRowSelection({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, urlSearch.source]);

  // ── Server data ─────────────────────────────────────────────────────────
  // Progress 셀 드릴다운 술어 (URL 파생) — 집계와 동일 소스(public.snag_progress_events)
  const cellServerFilter = useMemo<DefectServerFilter | null>(() => {
    if (!urlSearch.cellStage || !urlSearch.cellFrom) return null;
    const field = urlSearch.cellField === "actual" ? "actual" : "planned";
    return {
      column: "__cell__",
      op: field === "actual" ? "stage_actual_range" : "stage_plan_range",
      value: {
        stage: String(urlSearch.cellStage),
        field,
        from: String(urlSearch.cellFrom),
        to: String(urlSearch.cellTo || urlSearch.cellFrom),
        planMode: urlSearch.cellMode === "remaining" ? "remaining" : "baseline",
        asOf: urlSearch.asOf ? String(urlSearch.asOf) : "",
      },
    } as DefectServerFilter;
  }, [urlSearch.cellStage, urlSearch.cellField, urlSearch.cellFrom, urlSearch.cellTo, urlSearch.cellMode, urlSearch.asOf]);
  // NO PLAN KPI 드릴다운 술어 (URL 파생) — totals 의 no_plan 정의(계획일 NULL AND 실적일 NULL)와 동일
  const noPlanServerFilter = useMemo<DefectServerFilter | null>(() => {
    const raw = String(urlSearch.noPlanStages || "").trim();
    if (!raw) return null;
    const stages = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!stages.length) return null;
    return { column: "__noplan__", op: "stage_no_plan", value: { stages: stages.join(",") } } as DefectServerFilter;
  }, [urlSearch.noPlanStages]);
  const serverFilters = useMemo(
    () => {
      const out = toServerFilters(columnFilters);
      if (cellServerFilter) out.push(cellServerFilter);
      if (noPlanServerFilter) out.push(noPlanServerFilter);
      return out;
    },
    [columnFilters, cellServerFilter, noPlanServerFilter],
  );
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
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const total = itemsData?.total ?? 0;
  const pageCount = isAllPage ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const { data: counts } = useDefectStatusCounts({ includeInactive });
  const { data: summary } = useDefectDashboardSummary({ includeInactive });
  // As-of 단일 규칙: 세션 공유 선택값이 없으면 오늘(Asia/Qatar).
  // row.data_date(관측 컷오프)는 표기 전용이며 as-of 폴백에 쓰지 않는다.
  const [sharedAsOf] = useSnagAsOf();
  const dataDate = sharedAsOf || todayIso();

  // 파생 start_status 컬럼 값 주입 (렌더/셀 접근용)
  const enrichedRows = useMemo(() => {
    return rows.map((r) => ({ ...r, start_status: startStatusLabel(classifyStage(r as any, "start", dataDate)) }));
  }, [rows, dataDate]);

  // ── Restore view pref (per-tab: order/visibility/frozenExtras/columnSizing) ─
  useEffect(() => {
    if (!viewPref.ready) return;
    setStateLoaded(false);
    const s: any = viewPref.state ?? null;
    let baseSizing: ColumnSizingState = {};
    let baseOrder: string[] = defaultOrder;
    let baseVisibility: VisibilityState = { ...defaultVisibility };
    let baseFrozen: string[] = [];
    if (s && typeof s === "object") {
      baseSizing = s.columnSizing && typeof s.columnSizing === "object" ? s.columnSizing : {};
      const validKeys = new Set(defaultOrder);
      const savedOrder: string[] = Array.isArray(s.order)
        ? s.order.filter((k: any) => typeof k === "string" && validKeys.has(k))
        : [];
      if (savedOrder.length) {
        const savedSet = new Set(savedOrder);
        const merged = [...savedOrder];
        defaultOrder.forEach((k, defIdx) => {
          if (savedSet.has(k)) return;
          let insertAt = merged.length;
          for (let i = defIdx - 1; i >= 0; i--) {
            const prev = defaultOrder[i];
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
        baseFrozen = s.frozenExtras.filter((k: any) => typeof k === "string" && validKeys.has(k));
      }
    }
    setColumnSizing(baseSizing);
    setOrder(baseOrder);
    setVisibility(baseVisibility);
    setFrozenExtras(baseFrozen);
    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPref.ready, tab, defaultOrder]);

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

  // Progress 매트릭스에서 진입 시 URL 정리: source 및 drilldown 파라미터 제거하고
  // 적용된 필터를 filters= JSON으로 흡수시킴
  const progressCleanupDone = useRef(false);
  useEffect(() => {
    if (progressCleanupDone.current) return;
    if (urlSearch.source !== "progress") return;
    progressCleanupDone.current = true;
    const patch: Record<string, any> = { filters: serializeFilters(columnFilters), page: 1 };
    for (const key of DRILLDOWN_PARAMS) {
      if (CELL_PARAMS.includes(key)) continue; // 셀 조건은 URL 에 유지
      patch[key] = "";
    }
    setUrl(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch.source]);

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
        const pv = criticalPendingRef.current.get(id);
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
          { value: "Completed", label: "Rectified" }, { value: "Closed", label: "Closed" }, { value: "Delayed", label: "Delayed" },
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
      cols.push(buildDataColumn(c, tab, includeInactive, dataDate, canEditRow, teamCodesForEdit, patchLocalItem, () => refetch(), labelOf(c.key)));
    }
    return cols;
  }, [orderedKeys, hiddenByTab, tab, includeInactive, dataDate, canEditRow, teamCodesForEdit, patchLocalItem, refetch, labelOf]);

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
    meta: { q, serverFilters } as any,
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
    setAllMatchIds(null);
  }, [columnFilters, q, tab]);

  const pageSelectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((r) => r.original),
    [table, rowSelection, rows],
  );
  // 매칭 전체 선택이 활성이면 id만 담긴 경량 row 배열로 대체. BulkEditBar/삭제는 id만 사용.
  const selectedRows = useMemo<Record<string, any>[]>(() => {
    if (allMatchIds && allMatchIds.length > 0) {
      const rowById = new Map<string, any>();
      for (const r of rows) rowById.set(r.id, r);
      return allMatchIds.map((id) => rowById.get(id) ?? { id });
    }
    return pageSelectedRows;
  }, [allMatchIds, pageSelectedRows, rows]);
  const bulkFields = useMemo(() => {
    const optionMap: Record<string, { value: string; label: string }[]> = {
      team: teamCodesForEdit.map((value) => ({ value, label: value })),
      status_raw: uniqueOptions(rows, "status_raw"),
      rectified_status: uniqueOptions(rows, "rectified_status"),
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
      options: (c.key === "team"
        ? optionMap.team
        : c.options?.map((value) => ({ value, label: value })) ?? optionMap[c.key]) as any,
      group: normalizeGroupLabel(c.group),
    }));
  }, [rows, helpers, teamCodesForEdit]);
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
      if (urlSearch.actualComplete === "true" || urlSearch.actualComplete === "false") chips.push({ label: `Rectified: ${urlSearch.actualComplete === "true" ? "Done" : "Open"}`, clears: ["actualComplete"] });
      if (urlSearch.closureComplete === "true" || urlSearch.closureComplete === "false") chips.push({ label: `Closure: ${urlSearch.closureComplete === "true" ? "Done" : "Open"}`, clears: ["closureComplete"] });
    }
    if (urlSearch.overdue === "true") chips.push({ label: urlSearch.stage ? `Overdue — ${urlSearch.stage}` : "Overdue", clears: ["overdue", "stage", "asOf"] });
    if (urlSearch.remaining_stage && urlSearch.remaining_asof) chips.push({ label: `Remaining — ${urlSearch.remaining_stage} @ ${urlSearch.remaining_asof}`, clears: ["remaining_stage", "remaining_asof"] });
    if (urlSearch.atRisk === "true") chips.push({ label: urlSearch.atRiskDays ? `At Risk (≤ ${urlSearch.atRiskDays}d)` : "At Risk", clears: ["atRisk", "atRiskDays"] });
    if (urlSearch.notClosureDone === "true") chips.push({ label: "Closure ≠ Done", clears: ["notClosureDone"] });
    if (urlSearch.hdecVerification) chips.push({ label: `HDEC Verification: ${urlSearch.hdecVerification === EMPTY_TOKEN ? "(Blank)" : urlSearch.hdecVerification}`, clears: ["hdecVerification"] });
    if (urlSearch.cellStage && urlSearch.cellFrom) {
      const f = urlSearch.cellField === "actual" ? "Actual" : "Plan";
      const range = urlSearch.cellTo && urlSearch.cellTo !== urlSearch.cellFrom ? `${urlSearch.cellFrom} → ${urlSearch.cellTo}` : String(urlSearch.cellFrom);
      chips.push({
        label: `Cell: ${urlSearch.cellStage} ${f} ${range}${urlSearch.cellMode === "remaining" ? " (remaining)" : ""}`,
        clears: CELL_PARAMS,
      });
    }
    if (urlSearch.catADispute === "xor") chips.push({ label: "Cat A Dispute (LL ≠ HDEC)", clears: ["catADispute"] });
    if (urlSearch.noPlanStages) {
      chips.push({ label: `No Plan: ${String(urlSearch.noPlanStages).split(",").join(" / ")}`, clears: ["noPlanStages"] });
    }
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
          <DefectColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            defaultOrder={defaultOrder}
            defaultVisibility={defaultVisibility}
            onOrderChange={setOrder}
            onVisibilityChange={(v) => setVisibility(v)}
            onFrozenChange={setFrozenExtras}
            isAdmin={isAdmin}
            onServerReorder={onServerReorder}
            onServerVisibility={onServerVisibility}
            onServerLabel={onServerLabel}
          />
          {isAdmin && <AiClassifyButton selectedRows={selectedRows as any} onDone={() => { invalidateDefects(); refetch(); }} />}
          <Button asChild variant="outline" size="sm"><Link to="/import-log/import" search={{ tab: "snag" }}><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <Button size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1.5 h-3.5 w-3.5" /> Export</Button>
          {tab === "unclosed" && (
            <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={downloadingAll}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> {downloadingAll ? "다운로드 중..." : "Unclosed 전체 XLSX"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unclosed 전체 XLSX 다운로드</AlertDialogTitle>
                  <AlertDialogDescription>
                    현재 Unclosed 전체 {unclosedCount.toLocaleString()}건을 XLSX로 내보냅니다. 데이터 양에 따라 시간이 다소 소요될 수 있습니다. 진행하시겠습니까?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      setDownloadingAll(true);
                      const toastId = toast.loading("Unclosed 전체 다운로드 준비 중...");
                      try {
                        const { count } = await exportAllUnclosed((fetched, total) => {
                          toast.loading(`Unclosed 다운로드 ${fetched.toLocaleString()} / ${total.toLocaleString()}`, { id: toastId });
                        });
                        toast.success(`${count.toLocaleString()}건 XLSX 다운로드 완료`, { id: toastId });
                      } catch (e: any) {
                        toast.error(`다운로드 실패: ${e?.message ?? e}`, { id: toastId });
                      } finally {
                        setDownloadingAll(false);
                      }
                    }}
                  >
                    다운로드 시작
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
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
      </div>

      <CriticalBulkBar isAdmin={isAdmin} selectedRows={selectedRows as any} pending={criticalPending} setPending={setCriticalPending} />

      <SelectAllMatchingBanner
        pageSelectedCount={pageSelectedRows.length}
        pageRowCount={rows.length}
        total={total}
        allMatchIds={allMatchIds}
        fetching={fetchingAllMatch}
        onSelectAllMatching={async () => {
          setFetchingAllMatch(true);
          try {
            const ids = await fetchDefectItemIds({
              statusGroup: tab,
              includeInactive,
              q,
              filters: serverFilters,
              limit: 200_000,
            });
            if (ids.length >= 200_000) {
              toast.warning("상한(200,000)에 도달했습니다. 필터를 좁혀주세요.");
            }
            setAllMatchIds(ids);
            toast.success(`${ids.length.toLocaleString()}건 선택됨`);
          } catch (e: any) {
            toast.error("전체 선택 실패", { description: e?.message ?? String(e) });
          } finally {
            setFetchingAllMatch(false);
          }
        }}
        onClearMatching={() => setAllMatchIds(null)}
      />

      <BulkEditBar
        selectedRows={selectedRows as any}
        fields={bulkFields}
        exportColumns={exportColumns}
        canEdit={isAdmin}
        onClearSelection={() => { setRowSelection({}); setAllMatchIds(null); }}
        onApplied={() => { setRowSelection({}); setAllMatchIds(null); invalidateDefects(); }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground">
          {total > 0
            ? isAllPage
              ? `1–${total.toLocaleString()} / ${total.toLocaleString()}`
              : `${((page - 1) * pageSize + 1).toLocaleString()}–${Math.min(page * pageSize, total).toLocaleString()} / ${total.toLocaleString()}`
            : "0 / 0"}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">페이지 크기</span>
          <Select
            value={isAllPage ? "all" : String(pageSize)}
            onValueChange={(v) =>
              setUrl({ pageSize: v === "all" ? ("all" as any) : Number(v), page: 1 })
            }
          >
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={String(n)} value={String(n)}>
                  {n === "all" ? "All" : n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isAllPage && (
            <>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: 1 })}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: page - 1 })}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <span className="tabular-nums">{page} / {pageCount}</span>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: page + 1 })}><ChevronRight className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: pageCount })}><ChevronsRight className="h-3.5 w-3.5" /></Button>
            </>
          )}
        </div>
      </div>

      <DefectRawTableView
        table={table}
        tableRef={tableRef}
        loading={!stateLoaded || isFetching}
        dataDate={dataDate}
        frozenColIds={[...SYSTEM_FROZEN_IDS, ...frozenExtras]}
        getSourceOrigin={helpers.getSourceOrigin}
        onRowClick={(r) => navigate({ to: "/closure/snag-management/detail/$id", params: { id: r.id } })}
        q={q}
        serverFilters={serverFilters}
      />

      <CriticalPendingBar
        pending={criticalPending}
        onApplied={() => {
          setCriticalPending(new Map());
          invalidateDefects();
        }}
        onDiscard={() => setCriticalPending(new Map())}
      />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getRows={() => rows}
        fetchPage={async (offset, limit) => {
          const { supabase } = await import("@/integrations/supabase/client");
          const { data, error } = await (supabase as any).rpc("defect_items_search", {
            _status_group: tab,
            _include_inactive: includeInactive,
            _q: q && q.trim() ? q.trim() : null,
            _filters: serverFilters,
            _sort: serverSort,
            _offset: offset,
            _limit: limit,
          });
          if (error) throw new Error(error.message);
          const arr = (data ?? []) as { rows: any; total_count: number | string }[];
          const rs = arr.map((r) => r.rows as Record<string, any>);
          const total = Number(arr[0]?.total_count ?? rs.length);
          return { rows: rs, total };
        }}
        columnHeaders={DEFECT_COLUMNS.map((c) => ({ key: c.key, label: helpers.getLabel(c.key) }))}
        meta={{
          userName: user?.name ?? user?.email ?? "unknown",
          userType: (user as any)?.userType ?? (user?.isAdmin ? "admin" : ""),
        }}
        sourceLabel={inferSourceLabel(urlSearch as Record<string, unknown>, tab, includeInactive)}
        search={q}
        filterSummary={summarizeServerFilters(serverFilters)}
        sortSummary={summarizeServerSort(serverSort)}
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
  canEditRow: (row: DefectItem) => boolean,
  teamCodesForEdit: string[],
  patchLocal: (id: string, patch: Record<string, any>) => void,
  refetch: () => void,
  headerLabel?: string,
): ColumnDef<DefectItem> {
  const filterType =
    DATE_FILTER_FIELDS.has(c.key) ? "date-range" :
    PROGRESS_FIELDS.has(c.key) ? "text" :
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
      if (c.editable && c.editorType && canEditRow(row.original)) {
        const locked =
          (c.key === "priority" && (row.original as any).priority_locked) ||
          (c.key === "hdec_verification" && (row.original as any).hdec_verification_locked);
        const editorOptions = c.key === "team" ? teamCodesForEdit : c.options;
        return (
          <EditCellPopover
            id={row.original.id}
            field={c.key}
            label={c.label}
            editorType={c.editorType}
            options={editorOptions}
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
  if (c.key === "status_raw" || c.key === "rectified_status" || c.key === "closure_status") return <DefectStatusBadge status={v} />;
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
  getSourceOrigin: (field: string) => "hdec" | "aconex" | "system" | "derived";
  onRowClick: (row: DefectItem) => void;
  q?: string;
  serverFilters?: DefectServerFilter[];
}

function DefectRawTableView({ table, tableRef, loading, dataDate, frozenColIds, getSourceOrigin, onRowClick, q, serverFilters }: TableViewProps) {
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
  // R2: hoveredIndex React state 제거. hover 배경은 CSS `:hover` + `--sticky-bg`
  // 변수로 처리 (styles.css `.raw-hover-row:hover` 참조). 행 위 마우스 이동 시
  // React 커밋 0회 → Profiler 검증 통과.
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

  const stickyBgFor = (row: DefectItem): string => {
    const closed = Boolean((row as any).actual_closure_date) || /closed|complete|done/i.test(`${(row as any).closure_status ?? ""} ${(row as any).status_raw ?? ""}`);
    const overdue = isOverdueDefect(row as any, dataDate);
    // 스티키 컬럼은 항상 완전 불투명이어야 스크롤 시 뒤 컬럼이 비쳐 보이지 않는다.
    if (overdue && !closed)
      return "color-mix(in oklab, var(--destructive) 6%, var(--background))";
    if (closed)
      return "color-mix(in oklab, var(--muted) 45%, var(--background))";
    return "var(--background)";
  };

  return (
    <div className="flex max-h-[calc(100dvh-260px)] flex-col overflow-hidden rounded-md border bg-background">
      <TopHorizontalScrollbar targetRef={tableRef} width={totalWidth} frozenWidth={frozenWidth} />
      <div ref={tableRef} className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <table className="w-full caption-bottom text-sm" style={{ width: totalWidth, tableLayout: "fixed" }}>
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
                        <span onClick={(e) => e.stopPropagation()}><ColumnFilterDropdown column={header.column} q={q} serverFilters={serverFilters} /></span>
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
                      className={cn("cursor-pointer raw-hover-row", closed && "bg-muted/30 text-muted-foreground", overdue && !closed && "bg-destructive/5", "hover:bg-muted/50")}
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
                              ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 1, background: "var(--sticky-bg)", ["--sticky-bg" as any]: stickyBgFor(row.original) } : {}),
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
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 자동 분류 버튼 (Defect Location / Main·Sub Trade / Work Type)
// ─────────────────────────────────────────────────────────────────────────────
function AiClassifyButton({ selectedRows, onDone }: { selectedRows: Array<{ id: string }>; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const runClassify = useServerFn(bulkClassifyDefects);
  const disabled = running || selectedRows.length === 0;
  const run = useCallback(async () => {
    if (disabled) return;
    const ids = selectedRows.map((r) => r.id);
    if (ids.length > 5000) {
      toast.error(`최대 5,000행까지 가능합니다. 선택: ${ids.length.toLocaleString()}`);
      return;
    }
    const ok = window.confirm(`선택된 ${ids.length.toLocaleString()}건에 대해 빈 필드(Defect Location / Main Trade / Sub Trade / Work Type)를 자동 분류합니다. 이미 값이 있는 필드는 유지됩니다. 계속할까요?`);
    if (!ok) return;
    setRunning(true);
    const tId = toast.loading(`AI 분류 실행 중… (${ids.length.toLocaleString()}건)`);
    try {
      const res = await runClassify({ data: { ids } });
      toast.success(
        `분류 완료: ${res.updated}건 업데이트`,
        {
          id: tId,
          description: `Defect Location ${res.filled.defect_location} · Main Trade ${res.filled.main_trade} · Sub Trade ${res.filled.sub_trade} · Work Type ${res.filled.work_type}${res.failed ? ` · 실패 ${res.failed}` : ""}`,
        },
      );
      onDone();
    } catch (e: any) {
      toast.error("AI 분류 실패", { id: tId, description: e?.message ?? String(e) });
    } finally {
      setRunning(false);
    }
  }, [disabled, selectedRows, runClassify, onDone]);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={run}
      title={selectedRows.length === 0 ? "행을 선택하세요" : "선택 행의 빈 필드를 AI로 분류"}
    >
      <Sparkles className={cn("mr-1 h-3.5 w-3.5", running && "animate-pulse")} />
      {running ? "분류 중…" : `AI 하자 분류${selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}`}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "필터된 전체 N건 선택" 배너 — 현재 페이지 전체 선택 시 노출
// ─────────────────────────────────────────────────────────────────────────────
function SelectAllMatchingBanner({
  pageSelectedCount,
  pageRowCount,
  total,
  allMatchIds,
  fetching,
  onSelectAllMatching,
  onClearMatching,
}: {
  pageSelectedCount: number;
  pageRowCount: number;
  total: number;
  allMatchIds: string[] | null;
  fetching: boolean;
  onSelectAllMatching: () => void | Promise<void>;
  onClearMatching: () => void;
}) {
  // 매칭 전체 선택이 활성인 경우: 상태 표시 + 취소 링크
  if (allMatchIds && allMatchIds.length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">
        <span className="font-medium text-primary">
          필터된 전체 {allMatchIds.length.toLocaleString()}건이 선택됨
        </span>
        <span className="text-muted-foreground">
          · 이후 편집·삭제는 전체 매칭 행에 적용됩니다
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0 text-xs"
          onClick={onClearMatching}
        >
          이 페이지만 선택으로 돌아가기
        </Button>
      </div>
    );
  }

  // 페이지 전체 선택 + 매칭 총량이 페이지보다 많을 때만 "전체 선택" 링크 노출
  const showPrompt =
    pageRowCount > 0 && pageSelectedCount === pageRowCount && total > pageRowCount;
  if (!showPrompt) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
      <span>
        이 페이지 <strong>{pageSelectedCount}</strong>건이 선택되었습니다.
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-1 py-0 text-xs"
        disabled={fetching}
        onClick={() => void onSelectAllMatching()}
      >
        {fetching ? "불러오는 중…" : `필터된 전체 ${total.toLocaleString()}건 선택`}
      </Button>
    </div>
  );
}