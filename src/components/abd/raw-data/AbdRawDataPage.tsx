import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Route as AbdRawDataRoute } from "@/routes/_authenticated/closure/abd/raw-data";
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
import { Search, Upload, Filter, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  ABD_TEAMS,
  ABD_COLUMNS,
  ABD_STATUSES,
  PLOT_COLORS,
  STATUS_COLORS,
  formatAbdStage,
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
import { canEditRawRow } from "@/lib/auth/roles";
import { EMPTY_TOKEN, DATE_FILTER_FIELDS } from "@/lib/abd/filter-fns";
import { getOriginHeaderStyle } from "@/lib/abd/origin-header-style";
import { AbdColumnFilterDropdown } from "./AbdColumnFilterDropdowns";
import { TopHorizontalScrollbar } from "@/components/defect-management/raw-data/TopHorizontalScrollbar";
import { AbdEditCellPopover } from "./AbdEditCellPopover";
import { AbdExportDialog } from "./AbdExportDialog";
// ABD detail은 /closure/abd/detail/$id 라우트로 이동 (TM 방식)
import { AbdBulkEditBar } from "./AbdBulkEditBar";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import { AbdColumnOrderMenu } from "./AbdColumnOrderMenu";
import {
  useAbdDefaults,
  useAbdFieldHelpers,
  useInvalidateAbdFieldConfig,
  persistAbdFieldConfig,
} from "@/hooks/useAbdFieldConfig";
import { toast } from "sonner";
import { agingTone, AGING_TONE_CLASS, useAbdSettingsQuery } from "@/components/abd/dashboard/AbdAgingSettingsPopover";

const SYSTEM_FROZEN_IDS: string[] = [];
const DEFAULT_ORDER = ABD_COLUMNS.map((c) => c.key);
const PAGE_SIZE_OPTIONS: Array<number | "all"> = [50, 100, 200, 500, "all"];
const ALL_LIMIT = 1_000_000;

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

const MULTI_DATE_RANGE_ID = "__abd_date_range_or__";
/** Progress Matrix 셀 드릴다운 전용 필터. 술어 정본 = public.abd_progress_events(). */
const CELL_RANGE_ID = "__abd_cell_range__";

function buildFiltersFromProgressContext(urlSearch: any): ColumnFiltersState {
  const filters: ColumnFiltersState = [];
  const addMulti = (id: string, value: string) => {
    if (!value) return;
    const arr = value.split(",").map((x) => x.trim()).filter(Boolean);
    if (arr.length) filters.push({ id, value: arr });
  };
  addMulti("dis", urlSearch.dis);
  addMulti("service", urlSearch.service);
  addMulti("hdec_pic_name", urlSearch.hdec_pic_name);
  addMulti("hdec_eng_name", urlSearch.hdec_eng_name);
  addMulti("doc_ax", urlSearch.docAx);
  addMulti("doc_axx", urlSearch.docAxx);
  addMulti("batch_no", urlSearch.batch);
  // Progress Matrix 셀 드릴다운 — 라운드 인식(rn ≤/= v_active) · AP는 ap_plan 술어.
  if (urlSearch.cellStage && urlSearch.cellFrom) {
    filters.push({
      id: CELL_RANGE_ID,
      value: {
        stage: String(urlSearch.cellStage),
        field: urlSearch.cellField === "actual" ? "actual" : "planned",
        from: String(urlSearch.cellFrom),
        to: String(urlSearch.cellTo || urlSearch.cellFrom),
        planMode: urlSearch.cellMode === "remaining" ? "remaining" : "baseline",
      },
    });
    return filters;
  }
  // dateFields (콤마 목록) 우선 — 다중 컬럼 OR 범위 (round=all 드릴다운)
  if (urlSearch.dateFields && (urlSearch.dateStart || urlSearch.dateEnd)) {
    const cols = String(urlSearch.dateFields).split(",").map((s: string) => s.trim()).filter(Boolean);
    if (cols.length > 0) {
      filters.push({
        id: MULTI_DATE_RANGE_ID,
        value: { columns: cols, from: urlSearch.dateStart ?? "", to: urlSearch.dateEnd ?? "" },
      });
    }
  } else if (urlSearch.dateStart && urlSearch.dateEnd && urlSearch.dateField) {
    filters.push({ id: urlSearch.dateField, value: { from: urlSearch.dateStart, to: urlSearch.dateEnd } });
  }
  return filters;
}

function toServerFilters(f: ColumnFiltersState): AbdServerFilter[] {
  const out: AbdServerFilter[] = [];
  for (const cf of f) {
    const id = cf.id;
    const v: any = cf.value;
    if (v == null) continue;
    // Progress Matrix 셀 드릴다운 (집계와 동일 술어)
    if (id === CELL_RANGE_ID && typeof v === "object" && v.stage && v.from) {
      out.push({
        column: "__cell__",
        op: v.field === "actual" ? "stage_actual_range" : "stage_plan_range",
        value: { stage: v.stage, field: v.field, from: v.from, to: v.to ?? v.from, planMode: v.planMode ?? "baseline" },
      });
      continue;
    }
    // 다중 컬럼 OR 날짜 범위 (Progress round=all 드릴다운 전용)
    if (id === MULTI_DATE_RANGE_ID && typeof v === "object" && Array.isArray(v.columns)) {
      if ((v.from || v.to) && v.columns.length > 0) {
        out.push({
          column: "__multi__",
          op: "date_range_or",
          value: { columns: v.columns, from: v.from ?? "", to: v.to ?? "" },
        });
      }
      continue;
    }
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
      // number-range: { min?: number|null, max?: number|null }
      if (v.min != null || v.max != null) {
        out.push({
          column: id,
          op: "num_range",
          value: { min: v.min == null ? "" : String(v.min), max: v.max == null ? "" : String(v.max) },
        });
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

import { formatDdMmmYyyy as _fmtLong } from "@/lib/time/doha";
import { useAbdDataDate } from "@/hooks/useAbdDataDate";
function formatDdMmm(v: any): string {
  return _fmtLong(v);
}


const STATUS_TABS: { value: Exclude<AbdStatusGroup, "all">; label: string }[] = [
  { value: "approved", label: "Approved" },
  { value: "under_review", label: "Awaiting Response" },
  { value: "drafting", label: "Draft Start" },
  { value: "resubmit", label: "Resubmit by TM" },
];
// UI 탭에 노출되는 3종 + Dashboard 딥링크로만 들어오는 세분화 상태값들.
// URL 파라미터 파싱 시 유효값 판정에 사용된다.
const DEEP_LINK_STATUS_VALUES: Array<Exclude<AbdStatusGroup, "all">> = [
  "in_progress", "not_started", "unapproved",
  "rs_delay", "sb_delay", "df_delay", "ds_delay", "no_plan", "delayed",
  // stage_group 축 (Progress KPI 스트립 드릴다운): 재고 sg_*, 지연 sgd_*
  "sg_ns", "sg_ds", "sg_df", "sg_sb", "sg_rs", "sg_resubmit", "sg_approved",
  "sgd_ns", "sgd_ds", "sgd_df", "sgd_sb", "sgd_rs",
];
// 딥링크 status 값 → 사용자에게 보여줄 판정 라벨 (필터 칩)
const DEEP_LINK_STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  // 2026-07-30 NS 폐지: 구 딥링크 키 유지, 대상은 R1 DS(코드 DS1)
  not_started: "R1 DS",
  // 키 'under_review' = 회신 대기(RS). 딥링크 하위호환으로 키 유지, 라벨만 정정.
  under_review: "Awaiting Response",
  drafting: "Draft Start",
  resubmit: "Resubmit by TM",
  unapproved: "Unapproved",
  rs_delay: "Response Delay",
  sb_delay: "Submission Delay",
  df_delay: "Draft Finish Delay",
  ds_delay: "Draft Start Delay",
  no_plan: "No Plan",
  delayed: "Delayed",
  sg_ns: "R1 DS",
  sg_ds: "Draft Start",
  sg_df: "Draft Finish",
  sg_sb: "Submission",
  sg_rs: "Response",
  sg_resubmit: "Resubmit",
  sg_approved: "Approved",
  sgd_ns: "R1 DS · 지연",
  sgd_ds: "Draft Start · 지연",
  sgd_df: "Draft Finish · 지연",
  sgd_sb: "Submission · 지연",
  sgd_rs: "Response · 지연",
};
const ALL_STATUS_VALUES = [
  ...STATUS_TABS.map((s) => s.value),
  ...DEEP_LINK_STATUS_VALUES,
];

export function AbdRawDataPage() {
  const navigate = useNavigate();
  const urlSearch = AbdRawDataRoute.useSearch();
  const { data: user } = useCurrentUser();
  const isAdmin = !!user?.isAdmin;
  const canEditRow = useCallback(
    (row: AbdItem) => canEditRawRow(user ?? null, "abd_items_raw", row as unknown as Record<string, any>),
    [user],
  );
  const invalidate = useInvalidateAbd();

  // ABD Raw Data는 ABD 전용 팀 탭만 사용한다. team_master의 DESN/PRJC/SUPP 등 공용 팀을 섞으면
  // 데이터가 없는 탭이 선택되어 전체 Raw Data가 사라진 것처럼 보일 수 있다.
  const teamTabs = useMemo(
    () => ABD_TEAMS.map((t) => ({ value: t.value, label: t.label })),
    [],
  );
  const rawTab = String(urlSearch.tab ?? "").toUpperCase();
  // 다중 팀 선택: 콤마 구분(예: "MECH,ELEC"). 유효한 팀만 유지.
  const selectedTeams: AbdTeam[] = useMemo(() => {
    const valid = new Set(teamTabs.map((t) => t.value.toUpperCase()));
    const parts = rawTab
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && valid.has(s));
    // 최소 1개는 보장 (없으면 MECH 기본)
    const uniq = Array.from(new Set(parts));
    return (uniq.length > 0 ? uniq : ["MECH"]) as AbdTeam[];
  }, [rawTab, teamTabs]);
  // RPC/뷰프리퍼런스/컬럼메타에 넘길 team 문자열 (콤마 조인)
  const team: AbdTeam = (selectedTeams.join(",") as unknown) as AbdTeam;
  const toggleTeam = useCallback((v: AbdTeam) => {
    const set = new Set<AbdTeam>(selectedTeams);
    if (set.has(v)) {
      if (set.size === 1) return; // 마지막 하나는 해제 불가
      set.delete(v);
    } else {
      set.add(v);
    }
    const ordered = teamTabs
      .map((t) => t.value as AbdTeam)
      .filter((t) => set.has(t));
    setUrl({ tab: ordered.join(","), page: 1 });
  }, [selectedTeams, teamTabs]);
  // 다중 선택 지원: 콤마로 구분된 status 문자열. "all" | "" → 전체
  const selectedStatuses: Array<Exclude<AbdStatusGroup, "all">> = useMemo(() => {
    const raw = String(urlSearch.status ?? "").trim();
    if (!raw || raw === "all") return [];
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const valid = parts.filter((p): p is Exclude<AbdStatusGroup, "all"> =>
      (ALL_STATUS_VALUES as string[]).includes(p),
    );
    return valid;
  }, [urlSearch.status]);
  // RPC의 _status_group 슬롯은 확장 어휘(approved/in_progress/not_started + under_review/drafting/rs_delay/sb_delay/ds_delay/no_plan/delayed)를 모두 처리한다.
  // 단일 선택 시 그 값을, 그 외는 "all".
  const statusGroup: AbdStatusGroup = selectedStatuses.length === 1 ? selectedStatuses[0] : "all";
  const toggleStatus = useCallback((v: Exclude<AbdStatusGroup, "all">) => {
    const set = new Set(selectedStatuses);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    // 전체 선택/미선택은 "all"로 정규화
    const next = [...set];
    const value = next.length === 0 || next.length === ALL_STATUS_VALUES.length ? "all" : next.join(",");
    setUrl({ status: value, page: 1 });
  }, [selectedStatuses]);
  const plotSel: "all" | "C" | "D" = (["all", "C", "D"].includes(String(urlSearch.plot ?? "")) ? (urlSearch.plot as any) : "all");
  const plotFilter: "C" | "D" | null = plotSel === "all" ? null : plotSel;
  const excludedMode: "hide" | "only" | "all" =
    ["hide", "only", "all"].includes(String(urlSearch.excluded ?? "")) ? (urlSearch.excluded as any) : "all";
  // 비활성 레코드는 항상 제외 (관리자 페이지에서 별도 관리 예정)
  const includeInactive = false;
  const rawPageSize = String(urlSearch.pageSize ?? "");
  const pageSizeSel: number | "all" =
    rawPageSize === "all"
      ? "all"
      : (PAGE_SIZE_OPTIONS as Array<number | "all">).includes(Number(rawPageSize))
        ? Number(rawPageSize)
        : 100;
  const isAllPage = pageSizeSel === "all";
  const pageSize = isAllPage ? ALL_LIMIT : (pageSizeSel as number);
  const page = isAllPage ? 1 : Math.max(1, Number(urlSearch.page) || 1);

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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // 매트릭스가 보던 As-of 를 URL 로 넘겨받으면 세션 값보다 우선한다.
  const [sharedAbdDateRaw, setSharedAbdDate] = useAbdDataDate();
  const urlAsOf = String(urlSearch.asOf ?? "");
  const effectiveAsOf = urlAsOf || sharedAbdDateRaw;
  useEffect(() => {
    if (urlAsOf && urlAsOf !== sharedAbdDateRaw) setSharedAbdDate(urlAsOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAsOf]);

  useEffect(() => {
    if (urlSearch.source === "progress") {
      const built = buildFiltersFromProgressContext(urlSearch);
      setSorting(parseSortFromUrl(urlSearch.sort));
      setColumnFilters(built);
      setSearchInput(urlSearch.q ?? "");
      setUrl({
        source: "",
        team: "",
        dis: "",
        service: "",
        pic: "",
        docAx: "",
        docAxx: "",
        batch: "",
        dateStart: "",
        dateEnd: "",
        dateField: "",
        dateFields: "",
        stage: "",
        round: "",
        cellStage: "",
        cellField: "",
        cellFrom: "",
        cellTo: "",
        cellMode: "",
        asOf: "",
        filters: serializeFilters(built),
      });
    } else {
      setSorting(parseSortFromUrl(urlSearch.sort));
      setColumnFilters(parseFiltersFromUrl(urlSearch.filters));
      setSearchInput(urlSearch.q ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  const serverFilters = useMemo(() => {
    const base = toServerFilters(columnFilters);
    // UI 탭에서 2개(approved/in_progress/not_started 중) 다중 선택된 경우에만 서버측 in-절로 좁힘.
    // 단일 선택은 RPC의 _status_group 슬롯이 처리하고, 확장 상태값은 UI 탭에 없으므로 여기 해당 없음.
    if (selectedStatuses.length >= 2 && selectedStatuses.length < ALL_STATUS_VALUES.length) {
      return [{ column: "status_group", op: "in" as const, value: selectedStatuses }, ...base];
    }
    return base;
  }, [columnFilters, selectedStatuses]);
  const serverSort = useMemo(() => toServerSort(sorting), [sorting]);
  const q = (urlSearch.q ?? "").trim();

  // 판정 기준일(As of) — 세션 전역 공유. 빈 값이면 오늘(Doha).
  const sharedAbdDate = effectiveAsOf;
  const { data: itemsData, isFetching, refetch } = useAbdItemsQuery({
    team, statusGroup, includeInactive, plot: plotFilter, q, filters: serverFilters, sort: serverSort, page, pageSize, excludedMode,
    asOf: sharedAbdDate || null,
  });
  const rows = itemsData?.rows ?? [];
  const total = itemsData?.total ?? 0;
  const pageCount = isAllPage ? 1 : Math.max(1, Math.ceil(total / pageSize));

  const { data: counts } = useAbdCounts({ team, includeInactive, plot: plotFilter, asOf: sharedAbdDate || null });
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
    return ["__select", ...frozenExtras, ...rest];
  }, [order, frozenExtras]);

  const columns = useMemo<ColumnDef<AbdItem>[]>(() => {
    const byKey = new Map(ABD_COLUMNS.map((c) => [c.key, c] as const));
    const cols: ColumnDef<AbdItem>[] = [];
    for (const id of orderedKeys) {
      if (id === "__select") {
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
          meta: { origin: "system" },
        });
        continue;
      }
      const c = byKey.get(id);
      if (!c) continue;
      cols.push(buildDataColumn(c, team, statusGroup, includeInactive, plotFilter, canEditRow, () => refetch()));
    }
    return cols;
  }, [orderedKeys, team, statusGroup, includeInactive, plotFilter, canEditRow, refetch]);

  const columnVisibility = useMemo<VisibilityState>(() => {
    const vis: VisibilityState = {};
    const defByKey = new Map(ABD_COLUMNS.map((c) => [c.key, c] as const));
    for (const c of columns) {
      const id = (c as any).id ?? (c as any).accessorKey;
      if (!id || id in vis) continue;
      if (id in visibility) { vis[id] = visibility[id] !== false; continue; }
      vis[id] = !defByKey.get(id)?.hiddenByDefault;
    }
    return vis;
  }, [columns, visibility]);

  const table = useReactTable<AbdItem>({
    data: rows,
    columns,
    state: { sorting, columnFilters, columnSizing, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
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
          label: labelOf(c.id) ?? String((c.columnDef.header as any) ?? c.id),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderedKeys, visibility, labelOf],
  );
  const canBulkEdit = !!user && (
    isAdmin ||
    (Array.isArray((user as any).roles) &&
      (user as any).roles.some((r: string) =>
        ["senior_user", "d_superuser", "superuser", "admin"].includes(r),
      ))
  );

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
  const excludedCount = counts?.excluded_count ?? 0;

  return (
    <div className="space-y-3">
      <div data-marker="ABD_JUDGE_V1_2026_07_29" hidden aria-hidden="true" />
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ABD Raw Data</h1>
          <p className="text-sm text-muted-foreground">
            As-Built Drawing 제출 계획 관리 · 최근 데이터: {dataDate ?? "—"}
            {sharedAbdDate && sharedAbdDate !== dataDate && (
              <span className="ml-2 text-amber-600">
                (Dashboard 지정 Data Date: {sharedAbdDate})
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
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
          <Button asChild variant="outline" size="sm"><Link to="/import-log/import" search={{ tab: "abd" }}><Upload className="mr-1 h-3.5 w-3.5" /> Import</Link></Button>
          <Button size="sm" onClick={() => setExportOpen(true)}><Download className="mr-1.5 h-3.5 w-3.5" /> Export</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={plotSel} onValueChange={(v) => setUrl({ plot: v, page: 1 })}>
          <TabsList className="h-9">
            <TabsTrigger value="all" className="text-xs">All Plots</TabsTrigger>
            <TabsTrigger value="C" className="text-xs">PLOT C</TabsTrigger>
            <TabsTrigger value="D" className="text-xs">PLOT D</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="h-6 w-px bg-border" aria-hidden />
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 p-1">
          {teamTabs.map((t) => {
            const active = selectedTeams.includes(t.value as AbdTeam);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleTeam(t.value as AbdTeam)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 p-1">
        <button
          type="button"
          onClick={() => setUrl({ status: "all", page: 1 })}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
            selectedStatuses.length === 0
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-background/60",
          )}
          aria-pressed={selectedStatuses.length === 0}
        >
          All
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{totalCount}</Badge>
        </button>
        {STATUS_TABS.map((s) => {
          const active = selectedStatuses.includes(s.value);
          const count =
            s.value === "approved"
              ? approvedCount
              : s.value === "unapproved"
                ? inProgressCount + notStartedCount
                : 0;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => toggleStatus(s.value)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60",
              )}
              aria-pressed={active}
              title="다중 선택 가능"
            >
              {s.label}
              <Badge variant={active ? "outline" : "secondary"} className="ml-1 h-4 px-1 text-[10px]">{count}</Badge>
            </button>
          );
        })}
        {selectedStatuses
          .filter((v) => DEEP_LINK_STATUS_LABEL[v])
          .map((v) => (
            <span
              key={`chip-${v}`}
              className="inline-flex h-6 items-center gap-1 rounded bg-amber-500/15 px-2 text-[11px] text-amber-800 dark:text-amber-200"
              title={`대시보드 드릴다운 판정: ${DEEP_LINK_STATUS_LABEL[v]}`}
            >
              판정: {DEEP_LINK_STATUS_LABEL[v]}
              <button
                type="button"
                onClick={() => toggleStatus(v)}
                aria-label="필터 제거"
                className="ml-0.5 rounded px-1 hover:bg-amber-500/25"
              >
                ×
              </button>
            </span>
          ))}
        <button
          type="button"
          onClick={() => setUrl({ excluded: excludedMode === "only" ? "all" : "only", page: 1 })}
          className={cn(
            "ml-auto inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
            excludedMode === "only"
              ? "bg-zinc-700 text-white shadow-sm"
              : "text-muted-foreground hover:bg-background/60",
          )}
          aria-pressed={excludedMode === "only"}
          title="Terminated / Cancelled — 기본 모집단에 포함 · 클릭 시 해당 항목만 보기"
        >
          Excluded
          <Badge variant={excludedMode === "only" ? "outline" : "secondary"} className="ml-1 h-4 px-1 text-[10px]">
            {excludedCount}
          </Badge>
        </button>
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
            value={String(pageSizeSel)}
            onValueChange={(v) =>
              setUrl({ pageSize: v === "all" ? ("all" as any) : (Number(v) as any), page: 1 })
            }
          >
            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={String(n)} value={String(n)}>
                  {n === "all" ? "ALL" : n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={isAllPage || page <= 1} onClick={() => setUrl({ page: 1 })}><ChevronsLeft className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={isAllPage || page <= 1} onClick={() => setUrl({ page: page - 1 })}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <span className="tabular-nums">{page} / {pageCount}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={isAllPage || page >= pageCount} onClick={() => setUrl({ page: page + 1 })}><ChevronRight className="h-3.5 w-3.5" /></Button>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={isAllPage || page >= pageCount} onClick={() => setUrl({ page: pageCount })}><ChevronsRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <AbdBulkEditBar
        selectedRows={selectedRowObjects as unknown as Record<string, unknown>[]}
        exportColumns={selectedExportColumns}
        canEdit={canBulkEdit}
        onClear={() => setRowSelection({})}
        onMutated={() => {
          setRowSelection({});
          refetch();
          invalidate();
        }}
      />

      <AbdRawTableView
        table={table}
        tableRef={tableRef}
        loading={!stateLoaded || isFetching}
        frozenColIds={["__select", ...frozenExtras]}
        onRowClick={(id) => navigate({ to: "/closure/abd/detail/$id", params: { id } })}
        q={q}
        serverFilters={serverFilters}
      />

      <AbdExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getRows={() => rows}
        columnHeaders={ABD_COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
        filenamePrefix={plotFilter ? `abd-${team}-plot${plotFilter}` : `abd-${team}`}
      />
      {/* ABD detail drilldown → 전용 라우트 */}
    </div>
  );
}

// ── Column builder ────────────────────────────────────────────────────
function buildDataColumn(
  c: AbdColumnDef,
  team: AbdTeam,
  statusGroup: AbdStatusGroup,
  includeInactive: boolean,
  plot: "C" | "D" | null,
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
    meta: { filterType, filterOptions, serverFacet, team, statusGroup, includeInactive, plot, origin: c.origin ?? "system" },
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
  if (c.key === "current_stage" || c.key === "completed_stage") {
    const key = String(v).toUpperCase();
    const cls =
      key === "APPROVED" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" :
      key.startsWith("UR") ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
      key.startsWith("RS") ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" :
      key.startsWith("DS") || key.startsWith("DF") ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" :
      key === "SB" ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" :
      "bg-zinc-500/15 text-zinc-700";
    const variant = c.key === "completed_stage" ? "completed-short" : "short";
    return (
      <span
        title={formatAbdStage(String(v), c.key === "completed_stage" ? "completed-long" : "long")}
        className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap", cls)}
      >
        {formatAbdStage(String(v), variant)}
      </span>
    );
  }
  if (c.key === "ur_aging_days") {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return <span className="text-muted-foreground/50">—</span>;
    return <UrAgingBadge days={n} />;
  }
  if (c.key === "is_active") return v ? <Badge variant="secondary" className="text-[10px]">Active</Badge> : <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>;
  if (c.type === "date") return <span className="tabular-nums text-xs">{formatDdMmm(v)}</span>;
  if (c.type === "number") return <span className="tabular-nums text-xs">{String(v)}</span>;
  return <span className="text-xs">{String(v)}</span>;
}

function UrAgingBadge({ days }: { days: number }) {
  const { data: settings } = useAbdSettingsQuery();
  const tone = agingTone(days, settings);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        AGING_TONE_CLASS[tone],
      )}
      title={`UR 경과 ${days}일 · 임계값 ${settings?.ur_aging_warn_days ?? "?"}/${settings?.ur_aging_late_days ?? "?"}일`}
    >
      {days}d
    </span>
  );
}

// ── Table view ─────────────────────────────────────────────────────────
interface TableViewProps {
  table: ReturnType<typeof useReactTable<AbdItem>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  frozenColIds: string[];
  onRowClick?: (id: string) => void;
  q?: string;
  serverFilters?: AbdServerFilter[];
}

function AbdRawTableView({ table, tableRef, loading, frozenColIds, onRowClick, q, serverFilters }: TableViewProps) {
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
  // R2: hoveredIndex React state 제거. hover 배경은 CSS `:hover` + `--sticky-bg`
  // 변수로 처리 (styles.css `.raw-hover-row:hover` 참조). 행 위 마우스 이동 시
  // React 커밋 0회 → Profiler 검증 통과.
  const stickyBg = (row: AbdItem): string => {
    const inactive = !row.is_active;
    // ABD_JUDGE_V1_2026_07_29: 서버 정본(bucket_top) 소비. latest_status='A' 클라 오버라이드 폐기.
    const approved = (row as any).bucket_top === "Approved";
    // 스티키 컬럼은 항상 완전 불투명이어야 스크롤 시 뒤 컬럼이 비쳐 보이지 않는다.
    if (inactive)
      return "color-mix(in oklab, var(--muted) 45%, var(--background))";
    if (approved)
      return "color-mix(in oklab, var(--muted) 55%, var(--background))";
    return "var(--background)";
  };

  return (
    <div className="flex max-h-[calc(100dvh-280px)] flex-col overflow-hidden rounded-md border bg-background">
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
                        <span onClick={(e) => e.stopPropagation()}>
                          <AbdColumnFilterDropdown column={header.column} q={q} serverFilters={serverFilters} />
                        </span>
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
                  // ABD_JUDGE_V1_2026_07_29: 서버 정본 bucket_top 사용
                  const approved = (r as any).bucket_top === "Approved";
                  return (
                    <TableRow
                      key={row.id}
                      style={{ height: 34 }}
                      className={cn(
                        "cursor-default raw-hover-row",
                        !r.is_active && "bg-muted/30 text-muted-foreground",
                        approved && r.is_active && "bg-muted/40 text-muted-foreground/70",
                        "hover:bg-muted/50",
                      )}
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
                              ...(isSticky ? { position: "sticky", left: leftPx, zIndex: 1, background: "var(--sticky-bg)", ["--sticky-bg" as any]: stickyBg(r) } : {}),
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