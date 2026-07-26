import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
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
  MessageCircle,
  Pin,
  Plus,
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
  stageProgressFilterFn,
  textFilterFn,
} from "@/lib/task-management/filters";
import { ColumnFilterDropdown } from "./ColumnFilters";
import { BulkEditBar } from "./BulkEditBar";
import { ColumnOrderMenu } from "./ColumnOrderMenu";
import { ExportDialog } from "./ExportDialog";
import { HistoryDrawer } from "./HistoryDrawer";
import { TopHorizontalScrollbar } from "@/components/spare-part/raw-data/TopHorizontalScrollbar";
import { AddChildTaskDialog, type ParentSeed } from "./AddChildTaskDialog";
import { AddMainTaskDialog } from "./AddMainTaskDialog";
import { AlarmBadge } from "./AlarmBadge";
import { TaskStageProgress } from "./TaskStageProgress";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canEditRawRow } from "@/lib/auth/roles";
import { EditCellPopover } from "./EditCellPopover";
import { updateTaskOwnerField } from "@/lib/task-management/owner-mutations.functions";
import { DISCIPLINES } from "@/lib/task-management/columns";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import { useCommentReadState } from "@/lib/task-management/useCommentReadState";
import {
  expectedProgressToday,
  todayGap,
  computeVariance,
  computeDailyPlan,
  computeDailyDiff,
} from "@/lib/task-management/derived";
import {
  ALL_TASK_TIMELINE_STAGE_KEYS,
  isTaskStageDelayedAsOf,
  todayIso,
  type TaskItem,
} from "@/lib/task-management/schedule-utils";
import {
  isCompleted as kpiIsCompleted,
  isStarted as kpiIsStarted,
  isPlannedStartedBy as kpiIsPlannedStartedBy,
  isStartDelayed as kpiIsStartDelayed,
  isCompletionOverdue as kpiIsCompletionOverdue,
  isCriticalDelay as kpiIsCriticalDelay,
  isBehindSchedule as kpiIsBehindSchedule,
  isInDelay as kpiIsInDelay,
  scopeItems,
  type TmKpiMode,
  type TaskScope,
} from "@/lib/task-management/kpi-utils";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { CriticalThresholdPopover } from "@/components/task-management/shared/CriticalThresholdPopover";
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

const routeApi = getRouteApi("/_authenticated/closure/task-management/raw-data");
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

import { formatDdMmmYyyy } from "@/lib/time/doha";
function formatDdMmm(v: string | null | undefined): string {
  return formatDdMmmYyyy(v);
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
  const isSuperUser = !!(currentUser as any)?.isSuperUser;
  const isDSuperUser = !!(currentUser as any)?.isDSuperUser;
  const canEditTaskNo = canEdit || isDSuperUser;
  const canEditOwnerFieldsBase = canEdit || isSuperUser;
  const myPic = String((currentUser as any)?.hdec_pic_name ?? "").trim().toLowerCase();
  const updateOwnerFieldFn = useServerFn(updateTaskOwnerField);
  const canEditRow = useCallback(
    (row: Record<string, unknown>) =>
      canEditRawRow(currentUser ?? null, "task_management_raw", row as Record<string, any>),
    [currentUser],
  );
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
  const search = routeApi.useSearch();
  const dashboardAppliedRef = useRef(false);
  const [delayMode, setDelayMode] = useState<{ asOf: string } | null>(null);
  const [kpiMode, setKpiMode] = useState<{
    mode: TmKpiMode;
    asOf: string;
    scope: TaskScope;
  } | null>(null);
  const { data: kpiThresholds } = useTaskManagementSettings();
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
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [addChildParent, setAddChildParent] = useState<ParentSeed | null>(null);
  const [addMainOpen, setAddMainOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const mergedFrozen = [...savedFrozen, ...frozenFill];

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

  // 대시보드에서 진입 시 (source=dashboard) 기존 필터 리셋 후 담당자/팀 필터 적용
  useEffect(() => {
    if (!stateLoaded) return;
    if (dashboardAppliedRef.current) return;
    const s = search as {
      source?: string;
      mode?: string;
      asOf?: string;
      taskScope?: string;
      team?: string;
      hdec_pic_name?: string;
      hdec_eng_name?: string;
      discipline?: string;
    };
    if (s.source !== "dashboard") return;
    dashboardAppliedRef.current = true;

    const next: ColumnFiltersState = [];
    const push = (id: string, v: string | undefined) => {
      if (!v) return;
      const arr = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (arr.length) next.push({ id, value: arr });
    };
    push("team", s.team);
    push("hdec_pic_name", s.hdec_pic_name);
    push("hdec_eng_name", s.hdec_eng_name);
    push("discipline", s.discipline);

    setSorting(DEFAULT_SORTING);
    setGlobalFilter("");
    setSearchInput("");
    setColumnFilters(next);
    setCollapsedParents(new Set());
    const asOf = s.asOf && s.asOf.length ? s.asOf : todayIso();
    const scope: TaskScope =
      s.taskScope === "main" || s.taskScope === "sub" ? s.taskScope : "all";
    if (s.mode === "delay") {
      setDelayMode({ asOf });
      setKpiMode(null);
    } else if (s.mode) {
      setDelayMode(null);
      setKpiMode({ mode: s.mode as TmKpiMode, asOf, scope });
    } else {
      setDelayMode(null);
      setKpiMode(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, search]);

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
      const pageSize = 1000;
      const out: Row[] = [];
      let from = 0;
      // Paged fetch to bypass PostgREST default 1000-row cap
      while (true) {
        const { data, error } = await (supabase as any)
          .from("task_management_raw")
          .select("*")
          .order("discipline", { ascending: true })
          .order("sort_order", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        out.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
        if (from > 200000) break; // safety
      }
      return out;
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  // 댓글 수/최종 갱신 시각 조회 — 현재 로드된 행 기준
  const { data: commentCounts } = useQuery({
    queryKey: ["tm-comment-counts", rows.length],
    queryFn: async () => {
      const ids = rows.map((r) => String((r as any).id)).filter(Boolean);
      if (!ids.length) return {} as Record<string, { count: number; lastUpdatedAt: string }>;
      const map: Record<string, { count: number; lastUpdatedAt: string }> = {};
      // chunk to avoid PostgREST URL-length limits
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { data, error } = await (supabase as any)
          .from("task_comments")
          .select("task_raw_id, updated_at")
          .in("task_raw_id", chunk);
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ task_raw_id: string; updated_at: string }>) {
          const key = String(row.task_raw_id);
          const cur = map[key];
          if (!cur) map[key] = { count: 1, lastUpdatedAt: row.updated_at };
          else {
            cur.count += 1;
            if (row.updated_at > cur.lastUpdatedAt) cur.lastUpdatedAt = row.updated_at;
          }
        }
      }
      return map;
    },
    enabled: rows.length > 0,
    staleTime: 30_000,
  });

  const currentUserId = currentUser?.id ?? null;
  const { isRead, markRead } = useCommentReadState(currentUserId);

  const latestDataDate = useMemo(() => {
    let latest: string | null = null;
    for (const r of rows) {
      const d = (r as any).data_date as string | null | undefined;
      if (d && (!latest || d > latest)) latest = d;
    }
    return latest;
  }, [rows]);

  const dataDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const d = (r as any).data_date as string | null | undefined;
      if (d) set.add(String(d).slice(0, 10));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [rows]);

  const selectedDataDate =
    search.dataDate && search.dataDate.length
      ? search.dataDate
      : (latestDataDate ?? "");

  // T.Actual (오늘 실적) — 서버 RPC로 (오늘 누계 − 어제 누계) 일괄 조회.
  const rowIds = useMemo(
    () => rows.map((r) => String((r as any).id)).filter(Boolean),
    [rows],
  );
  const { data: tActualRows } = useQuery({
    queryKey: ["tm-today-actual", selectedDataDate, rowIds.length],
    queryFn: async () => {
      if (!rowIds.length || !selectedDataDate) return [] as Array<{ id: string; t_actual: number }>;
      const { data, error } = await (supabase as any).rpc("tm_today_actual", {
        _ids: rowIds,
        _as_of: selectedDataDate,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; t_actual: number }>;
    },
    enabled: rowIds.length > 0 && !!selectedDataDate,
    staleTime: 60_000,
  });
  const tActualMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of tActualRows ?? []) m.set(String(r.id), Number(r.t_actual) || 0);
    return m;
  }, [tActualRows]);

  // 지연 모드: 대시보드에서 넘어온 스테이지 지연 조건에 해당하는 행만 노출
  const delayFilteredRows = useMemo(() => {
    if (!delayMode) return rows;
    const asOf = delayMode.asOf;
    return rows.filter((r) => {
      const it = r as unknown as TaskItem;
      for (const st of ALL_TASK_TIMELINE_STAGE_KEYS) {
        if (isTaskStageDelayedAsOf(it, st, asOf)) return true;
      }
      return false;
    });
  }, [rows, delayMode]);

  // KPI 카드 딥링크 모드: 대시보드 상단 카드 클릭 시 조건
  const kpiFilteredRows = useMemo(() => {
    if (!kpiMode) return delayFilteredRows;
    const t = kpiThresholds ?? DEFAULT_THRESHOLDS;
    const asOf = kpiMode.asOf;
    const scoped = scopeItems(
      delayFilteredRows as unknown as TaskItem[],
      kpiMode.scope,
    ) as unknown as Row[];
    const matched = scoped.filter((r) => {
      const it = r as unknown as TaskItem;
      switch (kpiMode.mode) {
        case "completed":
          return kpiIsCompleted(it);
        case "not_started":
          return !kpiIsStarted(it);
        case "wip":
          return kpiIsStarted(it) && !kpiIsCompleted(it);
        case "planned_started":
          return kpiIsPlannedStartedBy(it, asOf);
        case "actual_started":
          return kpiIsStarted(it);
        case "in_delay":
          return kpiIsInDelay(it, asOf);
        case "start_delayed":
          return kpiIsInDelay(it, asOf) && kpiIsStartDelayed(it, asOf);
        case "completion_overdue":
          return kpiIsInDelay(it, asOf) && kpiIsCompletionOverdue(it, asOf);
        case "critical":
          return kpiIsCriticalDelay(it, asOf, t);
        case "behind":
          return kpiIsInDelay(it, asOf) && kpiIsBehindSchedule(it, asOf);
        case "no_plan_start":
          return !(it as any).plan_start;
        case "no_plan_end":
          return !(it as any).plan_end;
        default:
          return true;
      }
    });
    // Delay 계열 mode: 매치된 Main Task의 모든 Sub를 함께 포함
    // (Sub가 정상/주의여도 Main의 하위 컨텍스트 파악을 위해 노출)
    const DELAY_MODES = new Set([
      "in_delay",
      "start_delayed",
      "completion_overdue",
      "critical",
      "behind",
    ]);
    if (!DELAY_MODES.has(kpiMode.mode)) return matched;
    const mainKeys = new Set<string>();
    for (const r of matched) {
      if ((r as any).level === "main") {
        mainKeys.add(`${(r as any).discipline}::${(r as any).task_no}`);
      }
    }
    if (mainKeys.size === 0) return matched;
    // Sub는 scopeItems 이전(전체 delayFilteredRows)에서 다시 조회 —
    // 대시보드에서 taskScope='main' 진입 시에도 하위 Sub를 노출하기 위함.
    const matchedIds = new Set(matched.map((r) => (r as any).id));
    const extraSubs: Row[] = [];
    for (const r of delayFilteredRows) {
      if ((r as any).level !== "sub") continue;
      const parent = (r as any).main_task_no as string | null;
      const disc = (r as any).discipline as string;
      if (!parent) continue;
      if (!mainKeys.has(`${disc}::${parent}`)) continue;
      if (matchedIds.has((r as any).id)) continue;
      // 정상/완료 Sub는 제외 (주의/지연/위험 등 이슈 Sub만 함께 노출)
      const j = (r as any).auto_judgment as string | null | undefined;
      if (j === "정상" || j === "완료") continue;
      extraSubs.push(r);
    }
    return [...matched, ...extraSubs];
  }, [delayFilteredRows, kpiMode, kpiThresholds]);

  // discipline-task_no 단위 collapse 키 유지 — 접힌 부모의 자식 행 숨김
  const visibleRows = useMemo(() => {
    const src = kpiFilteredRows;
    if (collapsedParents.size === 0) return src;
    return src.filter((r) => {
      const parent = (r as any).main_task_no as string | null;
      const disc = (r as any).discipline as string;
      if (!parent) return true;
      return !collapsedParents.has(`${disc}::${parent}`);
    });
  }, [kpiFilteredRows, collapsedParents]);

  const parentKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of rows) {
      if ((r as any).level === "main") {
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
    return ["__select", "__comments", "task_no", ...frozenExtras, ...rest];
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
      if (key === "__comments") {
        cols.push({
          id: "__comments",
          size: 48,
          minSize: 40,
          maxSize: 64,
          enableSorting: false,
          enableColumnFilter: false,
          enableResizing: false,
          header: () => (
            <span className="flex w-full items-center justify-center" title="댓글">
              <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ),
          cell: ({ row }) => {
            const rr = row.original as Row;
            const rid = String(rr.id);
            const info = commentCounts?.[rid];
            if (!info || info.count <= 0) {
              return <span className="flex w-full items-center justify-center text-muted-foreground/30">—</span>;
            }
            const read = isRead(rid, info.lastUpdatedAt);
            return (
              <span
                className={cn(
                  "flex w-full items-center justify-center gap-0.5 tabular-nums",
                  read ? "text-muted-foreground" : "text-primary font-semibold",
                )}
                title={read ? `댓글 ${info.count}개 (읽음)` : `새 댓글 · 총 ${info.count}개`}
              >
                <MessageCircle className={cn("h-3.5 w-3.5", read ? "" : "fill-primary/15")} />
                <span className="text-[10px]">{info.count}</span>
              </span>
            );
          },
        });
        continue;
      }
      const c = TM_COLUMNS.find((x) => x.key === key);
      if (!c) continue;
      // Stage progress 아이콘 컬럼 (파생, 편집·필터·정렬 없음)
      if (c.key === "stage_progress") {
        cols.push({
          id: c.key,
          size: c.width,
          minSize: 60,
          maxSize: 120,
          enableSorting: false,
          enableColumnFilter: true,
          accessorFn: () => "",
          filterFn: stageProgressFilterFn as any,
          header: labelOverrides[c.key] ?? c.label,
          meta: { group: c.group, filterType: "stage-progress" as const },
          cell: ({ row }) => {
            const rr = row.original as Row;
            const dd = selectedDataDate || ((rr as any).data_date ?? null);
            return (
              <span className="flex w-full items-center justify-center">
                <TaskStageProgress row={rr as any} dataDate={dd} />
              </span>
            );
          },
        });
        continue;
      }
      // Today 3형제 (T.Plan / T.Actual / T.Diff) — 모두 파생 계산 (일할 증분 관점)
      if (
        c.key === "expected_progress_today" ||
        c.key === "today_gap" ||
        c.key === "today_actual"
      ) {
        cols.push({
          id: c.key,
          size: c.width,
          minSize: 60,
          maxSize: 240,
          enableSorting: true,
          enableColumnFilter: false,
          accessorFn: (r: Row) => {
            if (c.key === "expected_progress_today") {
              // T.Plan(일할) = 1 / duration_days
              return computeDailyPlan(r as any) ?? 0;
            }
            if (c.key === "today_actual") {
              return tActualMap.get(String((r as any).id)) ?? 0;
            }
            // today_gap = T.Diff(일할) = T.Actual − T.Plan
            const ta = tActualMap.get(String((r as any).id)) ?? 0;
            return computeDailyDiff(r as any, ta) ?? 0;
          },
          header: labelOverrides[c.key] ?? c.label,
          meta: { group: c.group },
          cell: ({ getValue }) => {
            const v = Number(getValue()) || 0;
            if (c.key === "expected_progress_today" || c.key === "today_actual") {
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
      // Cum. Diff — 누계 실적(Actual %) − 누계 계획(Plan %) 파생 계산.
      // DB 저장값(임포트값)은 표시에 사용하지 않는다.
      if (c.key === "progress_variance") {
        const th = kpiThresholds ?? DEFAULT_THRESHOLDS;
        cols.push({
          id: c.key,
          size: c.width,
          minSize: 60,
          maxSize: 240,
          enableSorting: true,
          enableColumnFilter: true,
          filterFn: numberRangeFilterFn,
          accessorFn: (r: Row) =>
            computeVariance(r as any, selectedDataDate || undefined),
          header: labelOverrides[c.key] ?? c.label,
          meta: { filterType: "number-range" as const, group: c.group },
          cell: ({ getValue }) => {
            const raw = getValue();
            if (raw == null)
              return <span className="text-muted-foreground/40">—</span>;
            const v = Number(raw);
            const cls =
              v < th.behind_late_gap
                ? "text-rose-600 font-semibold"
                : v < th.behind_warn_gap
                  ? "text-orange-600"
                  : v < 0
                    ? "text-amber-600"
                    : "text-emerald-600";
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
                  computeDailyDiff(rr as any, tActualMap.get(String(rr.id)) ?? 0) ?? 0
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
            const isParent = rr.level === "main";
            const isChild = !!(rr as any).main_task_no;
            const disc = String(rr.discipline);
            const collapseKey = `${disc}::${rr.task_no}`;
            const isCollapsed = collapsedParents.has(collapseKey);
            const ap = Number((rr as any).actual_progress ?? 0);
            const aj = (rr as any).auto_judgment;
            const isDone = ap >= 0.999 || aj === "완료";
            return (
              <span className="flex w-full items-center gap-1">
                {isParent ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(disc, String(rr.task_no));
                    }}
                    className={cn(
                      "rounded p-0.5 hover:bg-muted",
                      isDone && "text-muted-foreground",
                    )}
                    title={isCollapsed ? "펼치기" : "접기"}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                ) : isChild ? (
                  <span className={cn("ml-2", isDone ? "text-muted-foreground/60" : "text-muted-foreground/60")}>└</span>
                ) : (
                  <span className="w-4" />
                )}
                <span className={cn(
                  "min-w-0 flex-1 truncate",
                  isDone ? "text-muted-foreground" : "text-primary",
                )}>
                  {rendered}
                </span>
                {isParent && canEditRow(rr as Record<string, unknown>) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddChildParent({
                        task_no: String(rr.task_no),
                        discipline: disc as ParentSeed["discipline"],
                        task_name: (rr as any).task_name ?? null,
                        category: (rr as any).category ?? null,
                        hdec_pic_name: (rr as any).hdec_pic_name ?? null,
                        hdec_eng_name: (rr as any).hdec_eng_name ?? null,
                        floor_level: (rr as any).floor_level ?? null,
                        location: (rr as any).location ?? null,
                        risk: (rr as any).risk ?? null,
                        plan_start: (rr as any).plan_start ?? null,
                        plan_end: (rr as any).plan_end ?? null,
                      });
                    }}
                    className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                    title="Sub Task 추가"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                )}
              </span>
            );
          }
          const rr = row.original as any;
          const isMain = rr.level === "main";
          const rowOwner = String(rr?.hdec_pic_name ?? "").trim().toLowerCase();
          const isOwner = !!myPic && !!rowOwner && myPic === rowOwner;
          const canEditOwnerFields = canEditOwnerFieldsBase || isOwner;
          const isTeamOverride = c.key === "team";
          const isDataDateOverride = c.key === "data_date";
          let effectiveColumn: TmColumnDef = c;
          let effectiveCanEdit = canEdit;
          let useOwnerSave = false;
          if (isTeamOverride) {
            effectiveColumn = { ...c, editable: true, editorType: "select", options: [...DISCIPLINES] };
            effectiveCanEdit = canEditOwnerFields;
            useOwnerSave = true;
          } else if (isDataDateOverride) {
            effectiveColumn = { ...c, editable: true, editorType: "date" };
            effectiveCanEdit = canEditOwnerFields;
            useOwnerSave = true;
          }
          const editableInline =
            !!effectiveColumn.editable &&
            !!effectiveColumn.editorType &&
            effectiveCanEdit &&
            !(c.key === "actual_progress" && isMain);
          if (!editableInline) return rendered;
          return (
            <EditCellPopover
              rowId={String(rr.id)}
              column={effectiveColumn}
              currentValue={val}
              canEdit={effectiveCanEdit}
              onSaved={() => refetch()}
              onSave={
                useOwnerSave
                  ? async (value) => {
                      await updateOwnerFieldFn({
                        data: {
                          id: String(rr.id),
                          field: effectiveColumn.key,
                          value: value ?? null,
                        },
                      });
                    }
                  : undefined
              }
            >
              {rendered}
            </EditCellPopover>
          );
        },
      });
    }
    return cols;
  }, [canEdit, canEditRow, refetch, orderedKeys, labelOverrides, collapsedParents, selectedDataDate, kpiThresholds, tActualMap, canEditOwnerFieldsBase, myPic, updateOwnerFieldFn, commentCounts, isRead]);

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
  const frozenColIds = ["__select", "__comments", "task_no", ...frozenExtras];
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

  const activeFilterCount = columnFilters.length + (globalFilter ? 1 : 0);
  const allCollapsed = parentKeys.length > 0 && collapsedParents.size >= parentKeys.length;

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col gap-2">
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
          <DataDatePicker
            value={search.dataDate}
            latest={latestDataDate}
            options={dataDateOptions}
            onChange={(v) =>
              navigate({
                to: "/closure/task-management/raw-data",
                search: (prev: Record<string, unknown>) =>
                  ({ ...prev, dataDate: v === latestDataDate ? "" : v }) as any,
              })
            }
            onReset={() =>
              navigate({
                to: "/closure/task-management/raw-data",
                search: (prev: Record<string, unknown>) =>
                  ({ ...prev, dataDate: "" }) as any,
              })
            }
          />
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
          <div className="hidden sm:contents">
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
          </div>
          <Button
            variant="outline"
            size="sm"
            className="hidden h-8 sm:inline-flex"
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
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => navigate({ to: "/import-log/import", search: { tab: "task" } })}
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Import
          </Button>
          <Button size="sm" className="h-8" onClick={() => setExportOpen(true)}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
          {canEdit && (
            <Button size="sm" className="h-8" onClick={() => setAddMainOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Task 추가
            </Button>
          )}
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

      {(activeFilterCount > 0 || delayMode || kpiMode) && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <Filter className="h-3 w-3 text-muted-foreground" />
          {delayMode && (
            <FilterChip
              label={`지연 모드 · asOf ${delayMode.asOf}`}
              onClear={() => setDelayMode(null)}
            />
          )}
          {kpiMode && (
            <FilterChip
              label={`KPI: ${kpiMode.mode} · ${kpiMode.scope} · asOf ${kpiMode.asOf}${
                ["in_delay","start_delayed","completion_overdue","critical","behind"].includes(kpiMode.mode)
                  ? " · Sub 포함"
                  : ""
              }`}
              onClear={() => setKpiMode(null)}
            />
          )}
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
            <div className="sticky top-0 z-10 flex border-b bg-muted">
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
                        isFrozen ? "bg-muted" : bg,
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
                const isParent = (row.original as Row).level === "main";
                const ap = Number((row.original as any).actual_progress ?? 0);
                const aj = (row.original as any).auto_judgment;
                const isDone = ap >= 0.999 || aj === "완료";
                return (
                  <div
                    key={row.id}
                    onClick={() => {
                      const rid = String((row.original as Row).id);
                      const info = commentCounts?.[rid];
                      if (info && info.count > 0) markRead(rid, info.lastUpdatedAt);
                      navigate({
                        to: "/closure/task-management/detail/$id",
                        params: { id: rid },
                      });
                    }}
                    style={{
                      transform: `translateY(${v.start}px)`,
                      height: v.size,
                      width: totalWidth,
                    }}
                    className={cn(
                      "group absolute left-0 top-0 flex cursor-pointer border-b text-xs hover:bg-accent/40",
                      row.getIsSelected() && "bg-primary/5",
                      isParent && "bg-muted/30 font-medium text-sm",
                      isDone && "bg-muted/40 text-muted-foreground/70 grayscale",
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
                            isFrozen && (isDone ? "bg-muted" : isParent ? "bg-muted" : "bg-card"),
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

      <AddMainTaskDialog
        open={addMainOpen}
        onOpenChange={setAddMainOpen}
        onCreated={() => refetch()}
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