import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Route as TocRawDataRoute } from "@/routes/_authenticated/closure/toc/raw-data";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Filter,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import { SortPriorityBadge } from "@/components/common/SortPriorityBadge";
import { TopHorizontalScrollbar } from "@/components/defect-management/raw-data/TopHorizontalScrollbar";
import { TocColumnFilterDropdown, EMPTY_TOKEN, type FacetItem } from "./TocColumnFilterDropdown";
import { TocColumnOrderMenu } from "./TocColumnOrderMenu";
import { TocExportDialog } from "./TocExportDialog";
import {
  TOC_BANDS,
  TOC_BAND_STATE_COLOR,
  TOC_BAND_STATE_LABEL,
  TOC_COLUMNS,
  TOC_DATE_FIELDS,
  TOC_JUDGMENT_COLOR,
  TOC_STATUS_COLOR,
  TOC_TEXT_FILTER_FIELDS,
  bandColumnId,
  tocCellValue,
  type TocColumnDef,
} from "@/lib/toc/columns";
import {
  getTocRowsAsOf,
  type TocBand,
  type TocCatalogEntry,
  type TocRow,
} from "@/lib/toc/rows.functions";

/**
 * TOC(Handover) Raw Data — SM Raw Data(`DefectRawDataPage.tsx`) UI 이식본.
 *
 * 차이(승인된 계획 C-1~C-5):
 *  - 필터/정렬/패싯/페이지는 TOC 전용 검색 RPC 없이 정본 조회(`toc_rows_as_of`) 결과 안에서 계산한다.
 *  - 컬럼 라벨 편집(서버 저장) 없음. 행 선택·일괄 수정·AI 분류·전체 XLSX 없음.
 *  - 판정·준비도·밴드 상태는 정본 값만 표시하며 화면에서 재계산하지 않는다.
 */

const PAGE_SIZE_OPTIONS: Array<number | "all"> = [50, 100, 200, 500, "all"];
const DEFAULT_ORDER = TOC_COLUMNS.map((c) => c.key);
const DEFAULT_SORT: SortingState = [{ id: "item_no", desc: false }];
const DEFAULT_FROZEN = ["item_no"];
const SEARCH_FIELDS = ["item_no", "sub_system", "location", "toc_ref", "supplier", "main_system"] as const;

type Tab = "in_progress" | "handed_over" | "all";

function parseSortFromUrl(s: string): SortingState {
  if (!s) return DEFAULT_SORT;
  const out = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [id, dir] = p.split(":");
      return { id, desc: (dir ?? "asc").toLowerCase() === "desc" };
    });
  return out.length ? out : DEFAULT_SORT;
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
  } catch {
    return [];
  }
}
function serializeFilters(f: ColumnFiltersState): string {
  if (!f.length) return "";
  const obj: Record<string, any> = {};
  for (const x of f) obj[x.id] = x.value;
  return JSON.stringify(obj);
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Y" : "N";
  return String(v);
}

/** 한 컬럼 필터가 행에 부합하는지 — 다중선택 / 텍스트 / 날짜범위 */
function passesFilter(row: TocRow, id: string, value: any): boolean {
  if (value == null) return true;
  const raw = tocCellValue(row, id);
  const text = asText(raw);
  if (Array.isArray(value)) {
    if (value.length === 0) return true;
    if (text === "") return value.includes(EMPTY_TOKEN);
    return value.includes(text);
  }
  if (typeof value === "object") {
    if (value.emptyOnly) return text === "";
    if (TOC_DATE_FIELDS.has(id) && (value.from || value.to)) {
      if (!text) return false;
      if (value.from && text < value.from) return false;
      if (value.to && text > value.to) return false;
      return true;
    }
    if (typeof value.text === "string" && value.text.trim()) {
      const terms = value.text
        .split(",")
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);
      const hay = text.toLowerCase();
      return terms.every((t: string) => hay.includes(t));
    }
  }
  return true;
}

function compareValues(a: unknown, b: unknown, numeric: boolean): number {
  const an = a == null || a === "";
  const bn = b == null || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (numeric) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function TocRawDataPage() {
  const urlSearch = TocRawDataRoute.useSearch() as Record<string, any>;
  const navigate = useNavigate();
  const today = todayInDoha();
  const { data: user } = useCurrentUser();

  const tab: Tab = (urlSearch.tab as Tab) ?? "in_progress";
  const page = Number(urlSearch.page ?? 1) || 1;
  const isAllPage = urlSearch.pageSize === "all";
  const pageSize = isAllPage ? 1_000_000 : Number(urlSearch.pageSize ?? 100) || 100;
  const q = (urlSearch.q ?? "").trim();

  const [searchInput, setSearchInput] = useState<string>(urlSearch.q ?? "");
  const [sorting, setSorting] = useState<SortingState>(() => parseSortFromUrl(urlSearch.sort ?? ""));
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(() =>
    parseFiltersFromUrl(urlSearch.filters ?? ""),
  );
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [frozenExtras, setFrozenExtras] = useState<string[]>(DEFAULT_FROZEN);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [stateLoaded, setStateLoaded] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const setUrl = useCallback(
    (patch: Record<string, any>) => {
      navigate({ to: ".", search: (prev: any) => ({ ...prev, ...patch }), replace: true } as any);
    },
    [navigate],
  );

  // ── 정본 조회 ───────────────────────────────────────────────────────────
  const fetchRows = useServerFn(getTocRowsAsOf);
  const { data, isFetching, error } = useQuery({
    queryKey: ["toc-rows-as-of", urlSearch.asOf || ""],
    queryFn: () => fetchRows({ data: { as_of: urlSearch.asOf || null } }),
  });
  const allRows = data?.rows ?? [];
  const catalog = data?.catalog ?? [];

  // ── 계정별 화면 설정 복원/저장 (SM 과 동일 규칙) ─────────────────────────
  const viewPref = useUserViewPreference("toc-raw-data");
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!viewPref.ready || restoredRef.current) return;
    restoredRef.current = true;
    const s: any = viewPref.state ?? null;
    const valid = new Set(DEFAULT_ORDER);
    let nextOrder = DEFAULT_ORDER;
    let nextVisibility: VisibilityState = {};
    let nextFrozen = DEFAULT_FROZEN;
    let nextSizing: ColumnSizingState = {};
    if (s && typeof s === "object") {
      const saved: string[] = Array.isArray(s.order) ? s.order.filter((k: any) => valid.has(k)) : [];
      if (saved.length) {
        const savedSet = new Set(saved);
        nextOrder = [...saved, ...DEFAULT_ORDER.filter((k) => !savedSet.has(k))];
      }
      if (s.visibility && typeof s.visibility === "object") {
        for (const [k, v] of Object.entries(s.visibility)) if (valid.has(k)) nextVisibility[k] = !!v;
      }
      if (Array.isArray(s.frozenExtras)) {
        const f = s.frozenExtras.filter((k: any) => valid.has(k));
        nextFrozen = f.length ? f : DEFAULT_FROZEN;
      }
      if (s.columnSizing && typeof s.columnSizing === "object") nextSizing = s.columnSizing;
    }
    setOrder(nextOrder);
    setVisibility(nextVisibility);
    setFrozenExtras(nextFrozen);
    setColumnSizing(nextSizing);
    setStateLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPref.ready]);

  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stateLoaded) return;
    const next = { columnSizing, order, visibility, frozenExtras };
    const sig = JSON.stringify(next);
    if (lastSavedRef.current === sig) return;
    lastSavedRef.current = sig;
    viewPref.save(next as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, columnSizing, order, visibility, frozenExtras]);

  const saveLayoutNow = useCallback(() => {
    const next = { columnSizing, order, visibility, frozenExtras };
    lastSavedRef.current = JSON.stringify(next);
    viewPref.save(next as any);
    toast.success("컬럼 설정을 저장했습니다");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnSizing, order, visibility, frozenExtras, viewPref.save]);

  // ── sorting/filters → URL ──────────────────────────────────────────────
  useEffect(() => {
    if (!stateLoaded) return;
    const nextSort = serializeSort(sorting);
    const nextFilters = serializeFilters(columnFilters);
    if (nextSort !== (urlSearch.sort ?? "") || nextFilters !== (urlSearch.filters ?? "")) {
      setUrl({ sort: nextSort, filters: nextFilters, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, columnFilters, stateLoaded]);

  // ── 탭 / 검색 / 필터 / 정렬 (클라이언트 계산) ──────────────────────────
  const tabRows = useMemo(() => {
    if (tab === "handed_over") return allRows.filter((r) => r.judgment === "Handed Over");
    if (tab === "in_progress") return allRows.filter((r) => r.judgment !== "Handed Over");
    return allRows;
  }, [allRows, tab]);

  const tabCounts = useMemo(() => {
    const handed = allRows.filter((r) => r.judgment === "Handed Over").length;
    return { handed_over: handed, in_progress: allRows.length - handed, all: allRows.length };
  }, [allRows]);

  const searchedRows = useMemo(() => {
    if (!q) return tabRows;
    const terms = q
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!terms.length) return tabRows;
    return tabRows.filter((r) => {
      const hay = SEARCH_FIELDS.map((f) => asText((r as any)[f]))
        .join(" ")
        .toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }, [tabRows, q]);

  const filteredRows = useMemo(
    () => searchedRows.filter((r) => columnFilters.every((f) => passesFilter(r, f.id, f.value))),
    [searchedRows, columnFilters],
  );

  const columnDefMap = useMemo(() => new Map(TOC_COLUMNS.map((c) => [c.key, c] as const)), []);

  const sortedRows = useMemo(() => {
    if (!sorting.length) return filteredRows;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      for (const s of sorting) {
        const numeric = ["number", "percent"].includes(columnDefMap.get(s.id)?.type ?? "");
        const cmp = compareValues(tocCellValue(a, s.id), tocCellValue(b, s.id), numeric);
        if (cmp !== 0) return s.desc ? -cmp : cmp;
      }
      return 0;
    });
    return arr;
  }, [filteredRows, sorting, columnDefMap]);

  const total = sortedRows.length;
  const pageCount = isAllPage ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const pageRows = useMemo(
    () => (isAllPage ? sortedRows : sortedRows.slice((page - 1) * pageSize, page * pageSize)),
    [sortedRows, page, pageSize, isAllPage],
  );

  /** 교차 필터 패싯 — 자기 컬럼 필터만 제외하고 계산 (SM 서버 facet 과 동일 규칙) */
  const facetFor = useCallback(
    (columnId: string): FacetItem[] => {
      const others = columnFilters.filter((f) => f.id !== columnId);
      const counts = new Map<string, number>();
      for (const r of searchedRows) {
        if (!others.every((f) => passesFilter(r, f.id, f.value))) continue;
        const t = asText(tocCellValue(r, columnId));
        const key = t === "" ? EMPTY_TOKEN : t;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([value, count]) => ({ value, count }));
    },
    [searchedRows, columnFilters],
  );

  // ── 컬럼 구성 ───────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<TocRow>[]>(
    () => TOC_COLUMNS.map((c) => buildTocColumn(c, catalog)),
    [catalog],
  );

  const orderedKeys = useMemo(() => {
    const frozen = order.filter((k) => frozenExtras.includes(k));
    const rest = order.filter((k) => !frozenExtras.includes(k));
    return [...frozen, ...rest];
  }, [order, frozenExtras]);

  const table = useReactTable({
    data: pageRows,
    columns,
    state: { sorting, columnFilters, columnVisibility: visibility, columnOrder: orderedKeys, columnSizing },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    enableMultiSort: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getRowId: (r) => r.id,
  });

  // ── 판정 카드 (필터 결과 기준) ─────────────────────────────────────────
  const judgmentCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredRows) m.set(r.judgment, (m.get(r.judgment) ?? 0) + 1);
    return m;
  }, [filteredRows]);
  const judgmentSum = [...judgmentCounts.values()].reduce((a, b) => a + b, 0);
  const judgmentFilter = (columnFilters.find((f) => f.id === "judgment")?.value as string[]) ?? [];

  const toggleJudgment = (j: string) => {
    const col = table.getColumn("judgment");
    if (!col) return;
    col.setFilterValue(judgmentFilter.length === 1 && judgmentFilter[0] === j ? undefined : [j]);
  };

  const searchDirty = (urlSearch.q ?? "") !== searchInput;
  const runSearch = () => {
    if ((urlSearch.q ?? "") !== searchInput) setUrl({ q: searchInput, page: 1 });
  };
  const clearSearch = () => {
    setSearchInput("");
    if ((urlSearch.q ?? "") !== "") setUrl({ q: "", page: 1 });
  };

  const activeChips = useMemo(() => {
    return columnFilters.map((f) => {
      const label = columnDefMap.get(f.id)?.label ?? f.id;
      const v: any = f.value;
      let text = "";
      let full = "";
      if (Array.isArray(v)) {
        const vals = v.map((x) => (x === EMPTY_TOKEN ? "(Empty)" : String(x)));
        full = vals.join(", ");
        text = vals.length > 3 ? `${vals.slice(0, 2).join(", ")} 외 ${vals.length - 2}개` : full;
      } else if (v && typeof v === "object") {
        if (v.emptyOnly) text = "(Empty)";
        else if (v.text) text = v.text;
        else if (v.from || v.to) text = `${v.from ?? ""} ~ ${v.to ?? ""}`;
        full = text;
      }
      return {
        id: f.id,
        label: `${label}: ${text}`,
        title: `${label}: ${full}`,
        onClear: () => table.getColumn(f.id)?.setFilterValue(undefined),
      };
    });
  }, [columnFilters, columnDefMap, table]);

  const exportRowFor = useCallback(
    (r: TocRow) => {
      const out: Record<string, any> = {};
      for (const k of orderedKeys) {
        if (visibility[k] === false) continue;
        const v = tocCellValue(r, k);
        out[k] = k.startsWith("band_")
          ? TOC_BAND_STATE_LABEL[String(v)] ?? String(v)
          : typeof v === "boolean"
            ? v
              ? "Y"
              : "N"
            : v;
      }
      return out;
    },
    [orderedKeys, visibility],
  );

  const exportHeaders = useMemo(
    () =>
      orderedKeys
        .filter((k) => visibility[k] !== false)
        .map((k) => ({ key: k, label: columnDefMap.get(k)?.label ?? k })),
    [orderedKeys, visibility, columnDefMap],
  );

  return (
    <div className="space-y-3">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Handover (TOC) — Raw Data</h1>
          <p className="text-sm text-muted-foreground">
            Readiness bands, judgment and delay are read from the canonical functions (toc_rows_as_of →
            toc_eval_as_of). Nothing on this screen is recalculated.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DataDatePicker
            value={urlSearch.asOf ?? ""}
            latest={data?.as_of ?? today}
            options={[]}
            onChange={(v) => setUrl({ asOf: v, page: 1 })}
            onReset={() => setUrl({ asOf: "", page: 1 })}
          />
          <TocColumnOrderMenu
            order={order}
            visibility={visibility as Record<string, boolean>}
            frozenExtras={frozenExtras}
            defaultOrder={DEFAULT_ORDER}
            onOrderChange={setOrder}
            onVisibilityChange={(v) => setVisibility(v)}
            onFrozenChange={setFrozenExtras}
            onSaveLayout={saveLayoutNow}
          />
          <Button asChild variant="outline" size="sm">
            <Link to="/import-log/import" search={{ tab: "toc" } as any}>
              <Upload className="mr-1 h-3.5 w-3.5" /> Import
            </Link>
          </Button>
          <Button size="sm" onClick={() => setExportOpen(true)}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v, page: 1 })}>
        <TabsList className="h-9">
          <TabsTrigger value="in_progress" className="text-xs">
            In Progress
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {tabCounts.in_progress.toLocaleString()}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="handed_over" className="text-xs">
            Handed Over
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {tabCounts.handed_over.toLocaleString()}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs">
            All
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {tabCounts.all.toLocaleString()}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {(
          [
            "Handed Over",
            "TOC Under Review",
            "TOC Ready",
            "Delayed",
            "Blocked",
            "In Progress",
            "Not Started",
            "Excluded",
          ] as const
        ).map((j) => (
          <button
            key={j}
            type="button"
            onClick={() => toggleJudgment(j)}
            className={cn(
              "rounded-lg border p-2 text-left transition-colors hover:border-primary",
              judgmentFilter.includes(j) && "border-primary",
            )}
          >
            <div className="text-[11px] text-muted-foreground">{j}</div>
            <div className="text-xl font-semibold tabular-nums">{judgmentCounts.get(j) ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground">
        판정 카드 합계 {judgmentSum.toLocaleString()} · 필터 결과 {total.toLocaleString()} · 전체{" "}
        {allRows.length.toLocaleString()} · as-of {data?.as_of ?? today}
        {judgmentSum !== total ? " · MISMATCH" : ""}
      </div>

      {activeChips.length > 0 && (
        <div className="flex max-h-24 flex-wrap items-center gap-2 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Active column filters:</span>
          {activeChips.map((c) => (
            <button
              key={c.id}
              onClick={c.onClear}
              className="inline-flex max-w-[420px] items-center gap-1 truncate rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80"
              title={`${c.title} — Click to remove`}
            >
              {c.label} ✕
            </button>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={() => setColumnFilters([])}>
            Clear all
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder="Search item no, equipment, location, TOC ref... (comma = OR)"
            className="h-9 pl-8"
          />
        </div>
        <Button size="sm" className="h-9" variant={searchDirty ? "default" : "secondary"} onClick={runSearch}>
          검색
        </Button>
        {(searchInput || (urlSearch.q ?? "")) && (
          <Button size="sm" variant="ghost" className="h-9" onClick={clearSearch}>
            초기화
          </Button>
        )}
        <span className="self-center text-sm text-muted-foreground">{total.toLocaleString()} records</span>
        {sorting.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setSorting(DEFAULT_SORT)}>
            Clear sort ({sorting.length})
          </Button>
        )}
        <span className="hidden self-center text-xs text-muted-foreground md:inline">
          Tip: Shift+Click headers for multi-sort · Click <Filter className="inline h-3 w-3" /> to filter columns
        </span>
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
            value={isAllPage ? "all" : String(pageSize)}
            onValueChange={(v) => setUrl({ pageSize: v === "all" ? "all" : Number(v), page: 1 })}
          >
            <SelectTrigger className="h-7 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
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
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: 1 })}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setUrl({ page: page - 1 })}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="tabular-nums">
                {page} / {pageCount}
              </span>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: page + 1 })}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pageCount} onClick={() => setUrl({ page: pageCount })}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-destructive/40 p-6 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : (
        <TocRawTableView
          table={table}
          tableRef={tableRef}
          loading={!stateLoaded || isFetching}
          frozenColIds={frozenExtras}
          facetFor={facetFor}
        />
      )}

      <TocExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        getFilteredRows={() => sortedRows.map(exportRowFor)}
        getPageRows={() => pageRows.map(exportRowFor)}
        columnHeaders={exportHeaders}
        dateFields={[...TOC_DATE_FIELDS]}
        meta={{
          userName: user?.name ?? user?.email ?? "unknown",
          asOf: data?.as_of ?? today,
          sourceLabel: `TOC Raw Data · tab=${tab}`,
          search: q,
          filterSummary: activeChips.map((c) => c.title).join(" | "),
          sortSummary: serializeSort(sorting),
        }}
      />
    </div>
  );
}

// ── 컬럼 빌더 ───────────────────────────────────────────────────────────────
function buildTocColumn(c: TocColumnDef, catalog: TocCatalogEntry[]): ColumnDef<TocRow> {
  const filterType = TOC_DATE_FIELDS.has(c.key)
    ? "date-range"
    : TOC_TEXT_FILTER_FIELDS.has(c.key)
      ? "text"
      : "multi-select";
  return {
    id: c.key,
    accessorFn: (row) => tocCellValue(row, c.key),
    header: c.label,
    size: c.width,
    enableSorting: true,
    enableColumnFilter: true,
    meta: { filterType },
    cell: ({ row, getValue }) => renderTocCell(c, getValue(), row.original, catalog),
  };
}

/** 밴드 셀 tooltip — 단계별 상태·코드·계획·실적을 원본 값 그대로 나열 */
function bandTooltip(row: TocRow, band: TocBand, catalog: TocCatalogEntry[]) {
  return catalog
    .filter((e) => e.band === band)
    .map((e) => {
      const s = row.stages?.[e.stage_code];
      if (!s) return `${e.label}: —`;
      const parts: string[] = [s.st];
      if (s.cv) parts.push(`code=${s.cv}`);
      if (s.pf) parts.push(`plan=${s.pf}`);
      if (s.af) parts.push(`actual=${s.af}`);
      return `${e.label}: ${parts.join(" · ")}`;
    })
    .join("\n");
}

function renderTocCell(c: TocColumnDef, v: any, row: TocRow, catalog: TocCatalogEntry[]): React.ReactNode {
  if (c.type === "band" && c.band) {
    const st = String(v ?? "empty");
    return (
      <span
        title={bandTooltip(row, c.band, catalog)}
        className={cn("inline-block w-full truncate rounded px-1 py-0.5 text-center text-[10px]", TOC_BAND_STATE_COLOR[st])}
      >
        {TOC_BAND_STATE_LABEL[st] ?? st}
        {c.band === "TRAINING" && row.training_sessions > 0 ? ` (${row.training_sessions})` : ""}
      </span>
    );
  }
  if (c.type === "boolean") return <span className="text-xs">{v ? "Y" : "N"}</span>;
  if (v == null || v === "") return <span className="text-muted-foreground/50">—</span>;
  if (c.key === "judgment")
    return <Badge className={cn("text-[10px]", TOC_JUDGMENT_COLOR[String(v)])}>{String(v)}</Badge>;
  if (c.key === "toc_status")
    return <Badge className={cn("text-[10px]", TOC_STATUS_COLOR[String(v)])}>{String(v)}</Badge>;
  if (c.key === "team") return <Badge variant="outline" className="text-[10px]">{String(v)}</Badge>;
  if (c.key === "readiness_pct")
    return (
      <span className="tabular-nums text-xs">
        {String(v)}% <span className="text-muted-foreground">({row.ready_bands}/{row.ready_denom})</span>
      </span>
    );
  if (c.key === "primary_delay_label")
    return (
      <span className="truncate text-xs" title={String(v)}>
        {String(v)}
        {row.primary_delay ? ` (+${row.primary_delay.days}d)` : ""}
      </span>
    );
  if (c.type === "date" || c.type === "number") return <span className="tabular-nums text-xs">{String(v)}</span>;
  return (
    <span className="truncate text-xs" title={String(v)}>
      {String(v)}
    </span>
  );
}

// ── 가상화 표 (sticky header + frozen columns) ───────────────────────────────
function TocRawTableView({
  table,
  tableRef,
  loading,
  frozenColIds,
  facetFor,
}: {
  table: ReturnType<typeof useReactTable<TocRow>>;
  tableRef: React.RefObject<HTMLDivElement | null>;
  loading: boolean;
  frozenColIds: string[];
  facetFor: (columnId: string) => FacetItem[];
}) {
  const leaf = table.getVisibleLeafColumns();
  const frozenSet = useMemo(() => new Set(frozenColIds), [frozenColIds]);
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

  const autoSizeColumn = (columnId: string) => {
    const container = tableRef.current;
    if (!container) return;
    const cells = container.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`);
    let max = 72;
    cells.forEach((cell) => {
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.style.cssText =
        "position:absolute; visibility:hidden; width:auto; white-space:nowrap; max-width:none; left:-9999px; top:0;";
      document.body.appendChild(clone);
      max = Math.max(max, clone.getBoundingClientRect().width);
      document.body.removeChild(clone);
    });
    table.setColumnSizing((prev) => ({ ...prev, [columnId]: Math.min(Math.ceil(max) + 18, 640) }));
  };

  /** 스티키 컬럼은 항상 100% 불투명 — 뒤 컬럼이 비치면 안 된다 */
  const stickyBgFor = (row: TocRow): string => {
    if (row.judgment === "Handed Over") return "color-mix(in oklab, var(--muted) 45%, var(--background))";
    if (row.judgment === "Delayed") return "color-mix(in oklab, var(--destructive) 6%, var(--background))";
    return "var(--background)";
  };

  return (
    <div className="flex max-h-[calc(100dvh-330px)] flex-col overflow-hidden rounded-md border bg-background">
      <TopHorizontalScrollbar targetRef={tableRef} width={totalWidth} frozenWidth={frozenWidth} />
      <div ref={tableRef} className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <table className="w-full caption-bottom text-sm" style={{ width: totalWidth, tableLayout: "fixed" }}>
          <TableHeader className="bg-background">
            <TableRow className="border-b bg-background [&>th]:sticky [&>th]:top-0 [&>th]:z-[2] [&>th]:bg-background">
              {table.getHeaderGroups().at(-1)?.headers.map((header, i) => {
                const isSticky = frozenSet.has(header.column.id);
                const leftPx = isSticky ? stickyLefts.get(header.column.id) ?? 0 : undefined;
                const isLastFrozen = i === lastFrozenIndex;
                return (
                  <TableHead
                    key={header.id}
                    data-column-id={header.column.id}
                    title={String(header.column.columnDef.header ?? header.column.id)}
                    style={{
                      width: header.getSize(),
                      minWidth: header.getSize(),
                      maxWidth: header.getSize(),
                      ...(isSticky
                        ? { position: "sticky", left: leftPx, zIndex: 3, background: "var(--background)" }
                        : {}),
                    }}
                    className={cn(
                      "relative h-9 cursor-pointer select-none whitespace-nowrap border-b px-3 py-0 text-left text-xs font-medium",
                      !isSticky && "bg-background",
                      isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]",
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        {header.column.getIsSorted() && (
                          <span className="flex flex-shrink-0 items-center">
                            <span>{header.column.getIsSorted() === "asc" ? "▲" : "▼"}</span>
                            <SortPriorityBadge index={header.column.getSortIndex()} total={table.getState().sorting.length} />
                          </span>
                        )}
                      </span>
                      {header.column.getCanFilter() && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <TocColumnFilterDropdown column={header.column} facet={facetFor(header.column.id)} />
                        </span>
                      )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          autoSizeColumn(header.column.id);
                        }}
                        title="Drag to resize, double-click to auto-fit"
                        className={cn(
                          "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40",
                          header.column.getIsResizing() && "bg-primary/60",
                        )}
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={leaf.length} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={leaf.length} className="py-8 text-center text-muted-foreground">
                  조건에 맞는 항목이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr style={{ height: paddingTop }} aria-hidden>
                    <td colSpan={leaf.length} style={{ padding: 0, border: 0 }} />
                  </tr>
                )}
                {vRows.map((vr) => {
                  const row = rows[vr.index];
                  const r = row.original;
                  return (
                    <TableRow
                      key={row.id}
                      style={{ height: 36 }}
                      className={cn(
                        "raw-hover-row",
                        r.judgment === "Handed Over" && "bg-muted/30 text-muted-foreground",
                        r.judgment === "Delayed" && "bg-destructive/5",
                        "hover:bg-muted/50",
                      )}
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
                              width: cell.column.getSize(),
                              minWidth: cell.column.getSize(),
                              maxWidth: cell.column.getSize(),
                              height: 36,
                              maxHeight: 36,
                              overflow: "hidden",
                              ...(isSticky
                                ? {
                                    position: "sticky",
                                    left: leftPx,
                                    zIndex: 1,
                                    background: "var(--sticky-bg)",
                                    ["--sticky-bg" as any]: stickyBgFor(r),
                                  }
                                : {}),
                            }}
                            className={cn(
                              "truncate whitespace-nowrap px-3 py-2 text-xs",
                              isLastFrozen && "shadow-[2px_0_4px_-2px_hsl(var(--border))]",
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr style={{ height: paddingBottom }} aria-hidden>
                    <td colSpan={leaf.length} style={{ padding: 0, border: 0 }} />
                  </tr>
                )}
              </>
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}

/** 미사용 방지: 밴드 컬럼 id 생성기는 컬럼 정의에서만 쓰인다 */
void bandColumnId;
void TOC_BANDS;
