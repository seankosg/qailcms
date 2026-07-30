import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Download, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISCIPLINES, AUTO_JUDGMENT_COLORS } from "@/lib/task-management/columns";
import type { Discipline } from "@/lib/task-management/columns";
import {
  DEFAULT_THRESHOLDS,
  computeJudgment,
  cumPlanProgress,
  computeVariance,
  worstJudgment,
} from "@/lib/task-management/derived";
import type { TaskThresholds } from "@/lib/task-management/derived";
import { exportTaskSummary } from "./exportTaskSummary";
import { toast } from "sonner";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { MiniProgressChart } from "./MiniProgressChart";
// recharts (~130KB gzip) is only needed when the drill-down chart opens.
// Lazy-load so the tree page's initial render doesn't pull the chart library.
const TaskProgressChartDialog = lazy(() =>
  import("./TaskProgressChartDialog").then((m) => ({
    default: m.TaskProgressChartDialog,
  })),
);
import { useServerFn } from "@tanstack/react-start";
import { getTaskProgressChartsBulk, type TaskChartCache } from "@/lib/task-management/progress-chart.functions";
import { useTmAsOf } from "@/hooks/useTmAsOf";
import { asOfHeaderLabel, stalenessLabel } from "@/lib/task-management/as-of";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { todayInDoha } from "@/lib/time/doha";
import { useTmJudgmentAtDate } from "@/hooks/useTmJudgmentAtDate";

const routeApi = getRouteApi("/_authenticated/closure/task-management/tree");

interface Row {
  id: string;
  task_no: string;
  main_task_no: string | null;
  level: "main" | "sub";
  discipline: string;
  task_name: string | null;
  actual_progress: number | null;
  plan_progress: number | null;
  plan_start: string | null;
  plan_end: string | null;
  plan_days: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  slip_days: number | null;
  auto_judgment: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  sub_task_desc: string | null;
  sort_order: number | null;
  data_date: string | null;
}

/** as-of 기준 재판정이 정본. asOfDate 미지정(=과거 스냅샷 병합 경로)일 때만
 *  병합된 스냅샷 판정(auto_judgment)을 우선한다. */
function resolveRowJudgment(
  r: Row,
  thresholds: TaskThresholds,
  asOfDate?: string,
): string {
  if (!asOfDate) return r.auto_judgment || computeJudgment(r, thresholds, asOfDate) || "";
  return computeJudgment(r, thresholds, asOfDate) || r.auto_judgment || "";
}

function resolveMainJudgment(
  main: Row,
  kids: Row[],
  thresholds: TaskThresholds,
  asOfDate?: string,
): string {
  if (kids.length === 0) {
    if (!asOfDate) return main.auto_judgment || computeJudgment(main, thresholds, asOfDate) || "";
    return computeJudgment(main, thresholds, asOfDate) || main.auto_judgment || "";
  }

  const clamp01 = (v: unknown) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return 0;
    const s = n > 1 ? n / 100 : n;
    return Math.max(0, Math.min(1, s));
  };
  const rolledActual = clamp01(main.actual_progress);
  const allDone = kids.every(
    (k) => clamp01(k.actual_progress) >= 1 || k.auto_judgment === "완료",
  );
  const hasProgress = rolledActual > 0;
  const syntheticMain: Row = {
    ...main,
    actual_progress: rolledActual,
    actual_start: main.actual_start ?? (hasProgress ? main.plan_start : null),
    actual_finish: allDone ? (main.actual_finish ?? main.plan_end) : null,
    auto_judgment: allDone ? "완료" : null,
  };
  const j = computeJudgment(syntheticMain, thresholds, asOfDate);
  // 하위 하나라도 미완이면 상위는 어떤 경우에도 "완료"가 될 수 없음.
  if (!allDone && j === "완료") {
    const kidJudgments = kids.map((k) => resolveRowJudgment(k, thresholds, asOfDate));
    return worstJudgment(kidJudgments) ?? "정상";
  }
  return j;
}

function ProgressBar({ v }: { v: number | null | undefined }) {
  const n = Math.max(0, Math.min(1, Number(v ?? 0)));
  return (
    <div className="flex w-24 items-center gap-1">
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary" style={{ width: `${n * 100}%` }} />
      </div>
      <span className="w-9 text-right text-[10px] tabular-nums">
        {(n * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function GapCell({ gap, buffer }: { gap: number; buffer: number }) {
  // 색상 강조 경계도 임계값 단일 소스(caution_gap_buffer)를 사용.
  const cls =
    gap < -buffer
      ? "text-rose-600"
      : gap > buffer
        ? "text-emerald-600"
        : "text-muted-foreground";
  const sign = gap > 0 ? "+" : "";
  return (
    <span className={cn("w-14 text-right text-[10px] tabular-nums", cls)}>
      {sign}
      {(gap * 100).toFixed(1)}%p
    </span>
  );
}

function inferMainTaskNoFromSubTaskNo(
  taskNo: string,
  mainTaskNos: Set<string>,
): string | null {
  const parts = taskNo.split("-");
  while (parts.length > 1) {
    parts.pop();
    const candidate = parts.join("-");
    if (mainTaskNos.has(candidate)) return candidate;
  }
  return null;
}

export function TaskTreePage() {
  const routeSearch = routeApi.useSearch();
  const navigate = useNavigate();
  // 뷰 상태를 sessionStorage 로 유지 — Raw Data 로 드릴다운 후 되돌아왔을 때
  // discipline / 필터 / 검색어 / 펼침 상태가 그대로 복원되도록 함.
  // v3: 탭(discipline)별로 expanded/judgmentFilter/touched 를 분리 저장 →
  //     탭 전환 시 기본값(전체 펴기 + "악화" 필터) 재적용, 사용자가 조정한
  //     탭은 touched=true 로 표시되어 이후 재방문 시 상태 그대로 복원.
  const VIEW_STATE_KEY = "qail.task-tree.view-state.v3";
  type PerDisciplineState = {
    expanded: string[];
    judgmentFilter: string[];
    touched: boolean;
  };
  type PersistedView = {
    discipline: Discipline;
    search: string;
    picFilter: string;
    scrollY?: number;
    perDiscipline: Partial<Record<Discipline, PerDisciplineState>>;
  };
  const persisted: PersistedView | null = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(VIEW_STATE_KEY);
      return raw ? (JSON.parse(raw) as PersistedView) : null;
    } catch {
      return null;
    }
  })();
  const [discipline, setDiscipline] = useState<Discipline>(
    (persisted?.discipline as Discipline) ?? "ARCH",
  );
  const [search, setSearch] = useState(persisted?.search ?? "");
  const initialPerDiscipline = persisted?.perDiscipline?.[
    (persisted?.discipline as Discipline) ?? "ARCH"
  ];
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(initialPerDiscipline?.expanded ?? []),
  );
  const [judgmentFilter, setJudgmentFilter] = useState<Set<string>>(
    new Set(initialPerDiscipline?.judgmentFilter ?? ["악화"]),
  );
  // discipline 별 사용자 조정 여부를 세션 내에서 추적.
  const [touchedByDiscipline, setTouchedByDiscipline] = useState<
    Partial<Record<Discipline, boolean>>
  >(() => {
    const map: Partial<Record<Discipline, boolean>> = {};
    const src = persisted?.perDiscipline ?? {};
    for (const key of Object.keys(src) as Discipline[]) {
      if (src[key]?.touched) map[key] = true;
    }
    return map;
  });
  const [picFilter, setPicFilter] = useState<string>(
    persisted?.picFilter ?? "__all__",
  );
  const [chartTask, setChartTask] = useState<{ task_no: string; task_name: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);

  // 상태 변경 시 sessionStorage 로 저장 (현재 discipline 슬롯만 갱신).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(VIEW_STATE_KEY);
      const prev: PersistedView = raw
        ? (JSON.parse(raw) as PersistedView)
        : ({ discipline, search, picFilter, perDiscipline: {} } as PersistedView);
      const nextPer = { ...(prev.perDiscipline ?? {}) };
      nextPer[discipline] = {
        expanded: Array.from(expanded),
        judgmentFilter: Array.from(judgmentFilter),
        touched: !!touchedByDiscipline[discipline],
      };
      const payload: PersistedView = {
        discipline,
        search,
        picFilter,
        scrollY: prev.scrollY,
        perDiscipline: nextPer,
      };
      window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(payload));
    } catch {
      // storage full/blocked — ignore
    }
  }, [discipline, search, expanded, judgmentFilter, picFilter, touchedByDiscipline]);

  // 최초 마운트 시 저장된 스크롤 위치 복원.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const y = persisted?.scrollY;
    if (typeof y === "number" && y > 0) {
      // 데이터 렌더 이후로 지연.
      const id = window.setTimeout(() => window.scrollTo({ top: y }), 0);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 이탈 직전 스크롤 위치를 함께 저장.
  useEffect(() => {
    if (typeof window === "undefined") return;
    return () => {
      try {
        const raw = window.sessionStorage.getItem(VIEW_STATE_KEY);
        if (!raw) return;
        const base = JSON.parse(raw) as PersistedView;
        base.scrollY = window.scrollY;
        window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(base));
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data = [], isLoading } = useQuery({
    queryKey: ["task-tree", discipline],
    queryFn: async () => {
      // PostgREST 응답 상한(1,000행) 우회를 위한 청크 루프.
      // TM discipline별 태스크 총량이 1,000을 초과할 수 있어 전량 로드가 필수.
      const PAGE = 1000;
      const MAX_PAGES = 200; // 안전상한 20만행
      const out: Row[] = [];
      for (let from = 0; from < MAX_PAGES * PAGE; from += PAGE) {
        const to = from + PAGE - 1;
        const { data, error } = await (supabase as any)
          .from("task_management_raw")
          .select(
            "id, task_no, main_task_no, level, discipline, task_name, actual_progress, plan_progress, plan_start, plan_end, plan_days, actual_start, actual_finish, slip_days, auto_judgment, hdec_pic_name, hdec_eng_name, sub_task_desc, sort_order, data_date",
          )
          .eq("discipline", discipline)
          .order("main_task_no", { ascending: true, nullsFirst: true })
          .order("task_no", { ascending: true })
          .range(from, to);
        if (error) throw error;
        const chunk = (data ?? []) as Row[];
        out.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      return out;
    },
  });

  // 임계값 단일 소스(tm_thresholds RPC) — 판정과 색상 강조가 같은 값을 쓴다.
  const { data: thresholdsData } = useTaskManagementSettings();
  const thresholds: TaskThresholds = thresholdsData ?? DEFAULT_THRESHOLDS;

  const fetchChartsBulk = useServerFn(getTaskProgressChartsBulk);
  const { data: chartRows = [] } = useQuery({
    queryKey: ["task-progress-charts-bulk", discipline],
    queryFn: () => fetchChartsBulk({ data: { discipline } }),
    staleTime: 5 * 60_000,
  });
  const chartMap = useMemo(() => {
    const m = new Map<string, TaskChartCache>();
    for (const r of chartRows) m.set(r.task_no, r);
    return m;
  }, [chartRows]);

  const latestDataDate = useMemo(() => {
    let latest = "";
    for (const r of data) {
      const d = r.data_date ? String(r.data_date).slice(0, 10) : "";
      if (d && d > latest) latest = d;
    }
    return latest;
  }, [data]);

  const dataDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      const d = r.data_date ? String(r.data_date).slice(0, 10) : "";
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }, [data]);

  // Data Date 소스: 세션 공유값 > 최신값.
  // URL 의 dataDate 쿼리 파라미터(딥링크)는 진입 시 1회 세션으로 흡수한 뒤 URL에서 제거해,
  // 이후 Dashboard 등에서 세션 값을 바꾸면 그 값이 그대로 반영되도록 한다.
  const [sharedDataDate, setSharedDataDate] = useTmAsOf();
  // 구 딥링크 URL ?dataDate= 는 수용 후 무시(U5) — URL 에서만 제거한다.
  useEffect(() => {
    const urlDate = routeSearch.dataDate ? String(routeSearch.dataDate).slice(0, 10) : "";
    if (!urlDate) return;
    navigate({
      to: "/closure/task-management/tree",
      search: (prev: Record<string, unknown>) => ({ ...prev, dataDate: "" }) as any,
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.dataDate]);
  // As-of 단일 규칙: 선택값 없으면 오늘(Asia/Qatar). data_date 폴백 금지.
  const asOfDate = sharedDataDate || todayInDoha();
  const isPastAsOf =
    !!asOfDate && !!latestDataDate && asOfDate.slice(0, 10) < latestDataDate.slice(0, 10);
  const judge = useTmJudgmentAtDate(asOfDate ?? "", isPastAsOf);

  // 과거 As-of: 서버 정본(tm_judge_at_date)의 그 시점 판정과 함께
  // 표시용 Actual 도 그 시점 관측치로 치환한다.
  // (판정만 as-of 로 바꾸고 Actual 은 현재값을 보여주면
  //  "실적 100% / 차이 0%p 인데 악화" 같은 표시-판정 불일치가 발생한다.)
  const effData = useMemo<Row[]>(() => {
    if (!isPastAsOf || judge.map.size === 0) return data;
    const cut = asOfDate.slice(0, 10);
    const maskDate = (d: string | null) =>
      d && String(d).slice(0, 10) > cut ? null : d;
    return data.map((r) => {
      const j = judge.map.get(r.id);
      if (!j) return r;
      const rawA = j.cum_actual_pct;
      const asOfActual =
        rawA == null ? 0 : Number(rawA) > 1 ? Number(rawA) / 100 : Number(rawA);
      return {
        ...r,
        auto_judgment: j.auto_judgment ?? null,
        actual_progress: asOfActual,
        actual_start: asOfActual > 0 ? maskDate(r.actual_start) : null,
        actual_finish: asOfActual >= 1 ? maskDate(r.actual_finish) : null,
      } as Row;
    });
  }, [data, isPastAsOf, judge.map, asOfDate]);

  const { mainTasks, subsByMain } = useMemo(() => {
    const mainTasks: Row[] = [];
    const subsByMain = new Map<string, Row[]>();
    const mainTaskNos = new Set<string>();
    for (const r of effData) {
      if (r.level === "main") {
        mainTasks.push(r);
        mainTaskNos.add(r.task_no);
      }
    }
    for (const r of effData) {
      if (r.level === "sub") {
        const parentTaskNo =
          r.main_task_no && mainTaskNos.has(r.main_task_no)
            ? r.main_task_no
            : inferMainTaskNoFromSubTaskNo(r.task_no, mainTaskNos);
        if (!parentTaskNo) continue;
        const arr = subsByMain.get(parentTaskNo) ?? [];
        arr.push(r);
        subsByMain.set(parentTaskNo, arr);
      }
    }
    return { mainTasks, subsByMain };
  }, [effData]);

  // discipline 이 바뀌거나 데이터가 새로 로드되었을 때 — 해당 discipline 이
  // 아직 사용자에게 조정되지 않았다면 기본값(전체 펴기 + "악화" 필터) 적용.
  // 조정된 적이 있다면 sessionStorage 에 저장된 값 복원.
  useEffect(() => {
    if (mainTasks.length === 0) return;
    const touched = !!touchedByDiscipline[discipline];
    if (touched) {
      try {
        const raw =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem(VIEW_STATE_KEY)
            : null;
        const parsed = raw ? (JSON.parse(raw) as PersistedView) : null;
        const slot = parsed?.perDiscipline?.[discipline];
        setExpanded(new Set(slot?.expanded ?? []));
        setJudgmentFilter(new Set(slot?.judgmentFilter ?? ["악화"]));
      } catch {
        setExpanded(new Set(mainTasks.map((m) => m.task_no)));
        setJudgmentFilter(new Set(["악화"]));
      }
    } else {
      setExpanded(new Set(mainTasks.map((m) => m.task_no)));
      setJudgmentFilter(new Set(["악화"]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discipline, mainTasks]);

  function markTouched() {
    setTouchedByDiscipline((cur) =>
      cur[discipline] ? cur : { ...cur, [discipline]: true },
    );
  }

  const picOptions = useMemo(() => {
    const names = new Set<string>();
    let hasUnassigned = false;
    for (const r of data) {
      const v = (r.hdec_pic_name ?? "").trim();
      if (v) names.add(v);
      else hasUnassigned = true;
    }
    return {
      names: Array.from(names).sort((a, b) => a.localeCompare(b, "ko")),
      hasUnassigned,
    };
  }, [data]);

  useEffect(() => {
    if (picFilter === "__all__" || picFilter === "__unassigned__") return;
    if (!picOptions.names.includes(picFilter)) setPicFilter("__all__");
  }, [picFilter, picOptions.names]);

  // 과거 as-of 모드일 때는 이미 서버 판정을 병합했으므로 asOf 를 넘기지 않아야
  // computeJudgment 가 병합된 auto_judgment 를 그대로 사용한다.
  const asOfForJudge = isPastAsOf ? undefined : asOfDate;
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return mainTasks.filter((p) => {
      const kids = subsByMain.get(p.task_no) ?? [];
      if (judgmentFilter.size > 0) {
        const mainJ = resolveMainJudgment(p, kids, thresholds, asOfForJudge);
        const anyMatch =
          (mainJ && judgmentFilter.has(mainJ)) ||
          kids.some((k) => judgmentFilter.has(resolveRowJudgment(k, thresholds, asOfForJudge)));
        if (!anyMatch) return false;
      }
      if (picFilter !== "__all__") {
        if (picFilter === "__unassigned__") {
          const anyUnassigned = [p, ...kids].some(
            (r) => !((r.hdec_pic_name ?? "").trim()),
          );
          if (!anyUnassigned) return false;
        } else {
          const anyMatch = [p, ...kids].some(
            (r) => (r.hdec_pic_name ?? "").trim() === picFilter,
          );
          if (!anyMatch) return false;
        }
      }
      if (!q) return true;
      const hay = [p.task_no, p.task_name, ...kids.flatMap((k) => [k.task_no, k.task_name, k.sub_task_desc, k.hdec_pic_name, k.hdec_eng_name])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [mainTasks, subsByMain, q, judgmentFilter, picFilter, asOfForJudge, thresholds]);

  // 완료(Actual% ≥ 100%) Main Task 는 하단으로 정렬, 동일 그룹 내에서는 Main Task No 오름차순
  const sortedFiltered = useMemo(() => {
    const isDone = (r: Row) => Number(r.actual_progress ?? 0) >= 1;
    return [...filtered].sort((a, b) => {
      const da = isDone(a) ? 1 : 0;
      const db = isDone(b) ? 1 : 0;
      if (da !== db) return da - db;
      return a.task_no.localeCompare(b.task_no, undefined, { numeric: true });
    });
  }, [filtered]);

  // Header 강조: 현재 discipline + PIC 필터가 적용된 데이터 기준
  // Plan Start / Plan End 가 비어있는 태스크 갯수
  const missingPlanCounts = useMemo(() => {
    const matchPic = (r: Row) => {
      if (picFilter === "__all__") return true;
      const v = (r.hdec_pic_name ?? "").trim();
      if (picFilter === "__unassigned__") return !v;
      return v === picFilter;
    };
    let noStart = 0;
    let noEnd = 0;
    for (const r of effData) {
      if (!matchPic(r)) continue;
      if (!r.plan_start) noStart += 1;
      if (!r.plan_end) noEnd += 1;
    }
    return { noStart, noEnd };
  }, [effData, picFilter]);

  // 판정별 카운트 — P.Start/P.Finish 없음과 동일 스코프(현재 discipline + PIC 필터).
  const judgmentCounts = useMemo(() => {
    const matchPic = (r: Row) => {
      if (picFilter === "__all__") return true;
      const v = (r.hdec_pic_name ?? "").trim();
      if (picFilter === "__unassigned__") return !v;
      return v === picFilter;
    };
    const counts: Record<string, number> = { 정상: 0, 주의: 0, 지연: 0, 악화: 0 };
    for (const r of effData) {
      if (!matchPic(r)) continue;
      const j = r.level === "main"
        ? resolveMainJudgment(r, subsByMain.get(r.task_no) ?? [], thresholds, asOfForJudge)
        : resolveRowJudgment(r, thresholds, asOfForJudge);
      if (j && j in counts) counts[j] += 1;
    }
    return counts;
  }, [effData, picFilter, asOfForJudge, subsByMain, thresholds]);

  function goToRawDataMissing(kind: "no_plan_start" | "no_plan_end") {
    const searchParams: Record<string, string> = {
      source: "dashboard",
      mode: kind,
      taskScope: "all",
      discipline,
    };
    if (picFilter !== "__all__" && picFilter !== "__unassigned__") {
      searchParams.hdec_pic_name = picFilter;
    }
    navigate({
      to: "/closure/task-management/raw-data",
      search: searchParams as any,
    });
  }

  function toggle(taskNo: string) {
    markTouched();
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(taskNo)) next.delete(taskNo);
      else next.add(taskNo);
      return next;
    });
  }

  function expandAll() {
    markTouched();
    setExpanded(new Set(filtered.map((p) => p.task_no)));
  }
  function collapseAll() {
    markTouched();
    setExpanded(new Set());
  }

  async function handleExport() {
    if (filtered.length === 0) {
      toast.info("내보낼 데이터가 없습니다.");
      return;
    }
    // 현재 필터가 적용된 Main + 그 하위 Sub 로만 sub 맵을 구성해 넘긴다.
    const filteredSubs = new Map<string, Row[]>();
    for (const p of filtered) {
      filteredSubs.set(p.task_no, subsByMain.get(p.task_no) ?? []);
    }
    const filtersLabel = [
      `Discipline=${discipline}`,
      picFilter === "__all__"
        ? null
        : picFilter === "__unassigned__"
          ? "PIC=(미지정)"
          : `PIC=${picFilter}`,
      judgmentFilter.size > 0
        ? `위험도=${Array.from(judgmentFilter).join(",")}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    setExporting(true);
    try {
      const n = await exportTaskSummary({
        discipline,
        mainTasks: filtered,
        subsByMain: filteredSubs,
        filtersLabel,
        searchLabel: search.trim(),
        asOfDate,
        thresholds,
      });
      toast.success(`엑셀 내보내기 완료 — ${n.toLocaleString()} rows`);
    } catch (e) {
      toast.error(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-30 -mx-4 px-4 py-2 space-y-2 bg-background border-b">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Task Tree</h1>
        <DataDatePicker
          showDataDateChip
          value={sharedDataDate}
          latest={latestDataDate}
          options={dataDateOptions}
          onChange={(v) => setSharedDataDate(v === todayInDoha() ? "" : v)}
          onReset={() => setSharedDataDate("")}
        />
        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {asOfHeaderLabel(asOfDate)}
        </span>
        <Tabs value={discipline} onValueChange={(v) => setDiscipline(v as Discipline)}>
          <TabsList>
            {DISCIPLINES.map((d) => (
              <TabsTrigger key={d} value={d}>
                {d}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={picFilter} onValueChange={setPicFilter}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue placeholder="HDEC PIC" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">모든 HDEC PIC</SelectItem>
            {picOptions.hasUnassigned && (
              <SelectItem value="__unassigned__">(미지정)</SelectItem>
            )}
            {picOptions.names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="검색"
              className="h-8 w-56 pl-7"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={expandAll}>
            펴기
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={collapseAll}>
            접기
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={handleExport}
            disabled={exporting || isLoading}
          >
            {exporting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => goToRawDataMissing("no_plan_start")}
          disabled={missingPlanCounts.noStart === 0}
          title="P.Start 가 비어있는 태스크 목록 보기"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
            missingPlanCounts.noStart > 0
              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              : "border-muted bg-muted/40 text-muted-foreground cursor-not-allowed",
          )}
        >
          <span>P.Start 없음</span>
          <span className="tabular-nums font-semibold">
            {missingPlanCounts.noStart.toLocaleString()}
          </span>
        </button>
        <button
          type="button"
          onClick={() => goToRawDataMissing("no_plan_end")}
          disabled={missingPlanCounts.noEnd === 0}
          title="P.Finish 가 비어있는 태스크 목록 보기"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
            missingPlanCounts.noEnd > 0
              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              : "border-muted bg-muted/40 text-muted-foreground cursor-not-allowed",
          )}
        >
          <span>P.Finish 없음</span>
          <span className="tabular-nums font-semibold">
            {missingPlanCounts.noEnd.toLocaleString()}
          </span>
        </button>
        <div className="flex items-center gap-1">
          {(["악화", "지연", "주의", "정상"] as const).map((j) => {
            const active = judgmentFilter.has(j);
            const count = judgmentCounts[j] ?? 0;
            return (
              <button
                key={j}
                type="button"
                onClick={() =>
                  {
                    markTouched();
                    setJudgmentFilter((cur) => {
                    const next = new Set(cur);
                    if (next.has(j)) next.delete(j);
                    else next.add(j);
                    return next;
                    });
                  }
                }
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
                  active
                    ? (AUTO_JUDGMENT_COLORS[j] ?? "bg-muted") + " border-transparent ring-1 ring-current"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <span>{j}</span>
                <span className="tabular-nums font-semibold">{count.toLocaleString()}</span>
              </button>
            );
          })}
          {judgmentFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setJudgmentFilter(new Set())}
              className="ml-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              해제
            </button>
          )}
        </div>
      </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">로딩 중…</div>}

      <div className="space-y-2">
        {sortedFiltered.map((p) => {
          const kids = subsByMain.get(p.task_no) ?? [];
          const isOpen = expanded.has(p.task_no);
          const isDone = Number(p.actual_progress ?? 0) >= 1;
          const mainJudgment = resolveMainJudgment(p, kids, thresholds, asOfForJudge);
          const behindCount = kids.filter(
            (k) => (computeVariance(k, asOfDate) ?? 0) < -thresholds.caution_gap_buffer,
          ).length;
          const pGap = computeVariance(p, asOfDate) ?? 0;
          const pTodayPlan = cumPlanProgress(p, asOfDate);
          const pPic = (p.hdec_pic_name ?? p.hdec_eng_name ?? "-") || "-";
          return (
            <Card key={p.id} className={cn("overflow-hidden", isDone && "bg-muted/60 text-muted-foreground opacity-70")}> 
              <CardHeader
                className={cn(
                  "cursor-pointer flex flex-row items-center gap-2 py-2",
                  isOpen && "border-b",
                )}
                onClick={() => toggle(p.task_no)}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <button
                  type="button"
                  className="flex items-center gap-2 text-left hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate({
                      to: "/closure/task-management/detail/$id",
                      params: { id: p.id },
                    });
                  }}
                  title="상세 페이지로 이동"
                >
                  <span className="font-mono text-xs">{p.task_no}</span>
                  <span className="text-sm font-semibold">{p.task_name ?? "-"}</span>
                </button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Sub Task {kids.length}</Badge>
                  {behindCount > 0 && (
                    <Badge className="bg-rose-500/15 text-rose-700">지연 {behindCount}</Badge>
                  )}
                  <span
                    className="text-[10px] text-muted-foreground"
                    title="담당 (HDEC PIC / ENG)"
                  >
                    담당 <span className="font-medium text-foreground">{pPic}</span>
                  </span>
                  <span
                    className="text-[10px] tabular-nums text-muted-foreground"
                    title="계획 (P.Start ~ P.Finish)"
                  >
                    계획 {p.plan_start ?? "-"} ~ {p.plan_end ?? "-"}
                  </span>
                  <ProgressBar v={p.actual_progress} />
                  <span
                    className="text-[10px] tabular-nums text-muted-foreground"
                    title="오늘 계획 (T.Plan%)"
                  >
                    오늘 계획 <span className="font-medium text-foreground">{(pTodayPlan * 100).toFixed(0)}%</span>
                  </span>
                  <GapCell gap={pGap} buffer={thresholds.caution_gap_buffer} />
                  {mainJudgment && (
                    <Badge
                      className={cn(
                        "rounded-none border border-black/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm",
                        AUTO_JUDGMENT_COLORS[mainJudgment] ?? "bg-muted",
                      )}
                      title="Main Task 판정"
                    >
                      {mainJudgment}
                    </Badge>
                  )}
                  <MiniProgressChart
                    planPoints={chartMap.get(p.task_no)?.plan_points}
                    actualPoints={chartMap.get(p.task_no)?.actual_points}
                    xStart={chartMap.get(p.task_no)?.x_start ?? null}
                    xEnd={chartMap.get(p.task_no)?.x_end ?? null}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChartTask({ task_no: p.task_no, task_name: p.task_name });
                    }}
                    title="클릭하여 진도율 상세 차트 보기"
                  />
                </div>
              </CardHeader>
              {isOpen && (
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-2 py-1 text-left">Task No</th>
                       <th className="px-2 py-1 text-left">Sub Task 설명</th>
                        <th className="px-2 py-1 text-left">담당</th>
                        <th className="px-2 py-1 text-left">계획</th>
                        <th className="px-2 py-1 text-left">실적</th>
                        <th className="px-2 py-1 text-left">오늘 계획</th>
                        <th className="px-2 py-1 text-left">차이</th>
                        <th className="px-2 py-1 text-left">판정</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {kids.map((k) => {
                        const gap = computeVariance(k, asOfDate) ?? 0;
                        const j = resolveRowJudgment(k, thresholds, asOfForJudge);
                        const kDone = Number(k.actual_progress ?? 0) >= 1;
                        return (
                          <tr
                            key={k.id}
                            className={cn(
                              "cursor-pointer border-t hover:bg-accent/30",
                              kDone && "bg-muted/50 text-muted-foreground opacity-70",
                            )}
                            onClick={() =>
                              navigate({
                                to: "/closure/task-management/detail/$id",
                                params: { id: k.id },
                              })
                            }
                          >
                            <td className="px-2 py-1 font-mono text-primary underline-offset-2 hover:underline">
                              {k.task_no}
                            </td>
                            <td className="px-2 py-1">
                              {k.sub_task_desc ?? "-"}
                              {stalenessLabel(k.data_date) && (
                                <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                                  {stalenessLabel(k.data_date)}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1">{k.hdec_pic_name ?? k.hdec_eng_name ?? "-"}</td>
                            <td className="px-2 py-1 text-[10px] tabular-nums">
                              {k.plan_start ?? "-"} ~ {k.plan_end ?? "-"}
                            </td>
                            <td className="px-2 py-1">
                              <ProgressBar v={k.actual_progress} />
                            </td>
                            <td className="px-2 py-1 tabular-nums text-[10px]">
                              {(cumPlanProgress(k, asOfDate) * 100).toFixed(0)}%
                            </td>
                            <td className="px-2 py-1">
                              <GapCell gap={gap} buffer={thresholds.caution_gap_buffer} />
                            </td>
                            <td className="px-2 py-1">
                              {j && (
                                <Badge className={AUTO_JUDGMENT_COLORS[j] ?? "bg-muted"}>
                                  {j}
                                </Badge>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <MiniProgressChart
                                planPoints={chartMap.get(k.task_no)?.plan_points}
                                actualPoints={chartMap.get(k.task_no)?.actual_points}
                                xStart={chartMap.get(k.task_no)?.x_start ?? null}
                                xEnd={chartMap.get(k.task_no)?.x_end ?? null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChartTask({ task_no: k.task_no, task_name: k.task_name });
                                }}
                                title="클릭하여 진도율 상세 차트 보기"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && !isLoading && (
        <div className="rounded border p-6 text-center text-sm text-muted-foreground">
          표시할 Main Task가 없습니다.
        </div>
      )}

      {chartTask && (
        <Suspense fallback={null}>
          <TaskProgressChartDialog
            open={!!chartTask}
            onClose={() => setChartTask(null)}
            discipline={discipline}
            taskNo={chartTask?.task_no ?? null}
            taskName={chartTask?.task_name ?? null}
          />
        </Suspense>
      )}
    </div>
  );
}