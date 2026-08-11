import { ColumnResizeHandle } from "@/components/common/ColumnResizeHandle";
import { useEffect, useMemo, useState } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Loader2, Search } from "lucide-react";
import { SortPriorityBadge } from "@/components/common/SortPriorityBadge";
import { cn } from "@/lib/utils";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha, formatDdMmm } from "@/lib/time/doha";
import {
  getSplRowsAsOf,
  getSplEstimatedCells,
  getSplExportRows,
  type SplCatalogEntry,
  type SplRow,
  type SplStageCell,
} from "@/lib/spl/rows.functions";
import { downloadSplRoundtripWorkbook } from "@/lib/spl/roundtrip-export";
import { updateSplField } from "@/lib/spl/mutations.functions";
import { AbdEditCellPopover } from "@/components/abd/raw-data/AbdEditCellPopover";
import { useRclCan } from "@/hooks/useRclCan";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import {
  SPL_COLUMNS,
  SPL_DEFAULT_ORDER,
  SPL_DEFAULT_VISIBILITY,
  SPL_TEAM_OPTIONS,
  buildSplStageColumns,
  splBandHeaderClass,
  splJudgmentLabel,
  type SplColumnDef,
  type SplStageColumn,
} from "./spl-columns";
import { SplColumnFilterDropdown } from "./SplColumnFilterDropdowns";
import { SplOcsCell, SplCountCell } from "@/components/spl/ocs/SplOcsCells";
import { SplOcsPanels, type SplPanelKind, type SplPanelTarget } from "@/components/spl/ocs/SplOcsPanels";
import { SplColumnOrderMenu } from "./SplColumnOrderMenu";
import { SplBulkEditBar } from "./SplBulkEditBar";
import { SplExportDialog } from "./SplExportDialog";

const routeApi = getRouteApi("/_authenticated/closure/spare-part/raw-data");

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

const JUDGMENTS = ["제외", "완료", "정상", "지연", "미착수", "미분류"] as const;

/**
 * ★ 계획일 임포트 직후 재실행 필수 검증 체크리스트 (D-4-3)
 *  1. 지연 KPI 카드 클릭 → 드릴다운 목록 건수 == 카드값
 *  2. Primary delay by band 칩 합계 == 지연 카드값
 *  3. 아이템당 primary_delay ≤ 1 (서버 pd CTE DISTINCT ON 보증 — 실측 재확인)
 *  현재 상태: 계획일 0건 → 지연 표본 0 → 불변식 I-1 / I-3 / I-5 는 "미검증".
 */

const STATE_CLASS: Record<SplStageCell["st"], string> = {
  done: "text-emerald-700 dark:text-emerald-400 font-medium",
  delayed: "text-red-600 dark:text-red-400 font-medium",
  wip: "text-amber-600 dark:text-amber-400",
  planned: "text-muted-foreground",
  na: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function SplRawDataPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const rootNavigate = useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;
  const [exporting, setExporting] = useState(false);

  const fetchRows = useServerFn(getSplRowsAsOf);
  const fetchEstimated = useServerFn(getSplEstimatedCells);
  const fetchExport = useServerFn(getSplExportRows);
  const saveField = useServerFn(updateSplField);
  const queryClient = useQueryClient();
  const { canRow } = useRclCan("SPL", "write");
  const isToday = asOf === today;

  // ── 컬럼 설정(순서·표시·고정) — 계정 단위 저장 ──
  const viewPref = useUserViewPreference("spl.raw-data.v1");
  const [order, setOrder] = useState<string[]>(SPL_DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(SPL_DEFAULT_VISIBILITY);
  const [frozenExtras, setFrozenExtras] = useState<string[]>(["spl_number"]);
  /** 컬럼 폭(px) — 사용자가 드래그로 조절한 값만 담는다 */
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  /** 다중 정렬 — 클릭한 순서가 곧 우선순위 */
  const [sorts, setSorts] = useState<Array<{ key: string; desc: boolean }>>([]);
  const [stateLoaded, setStateLoaded] = useState(false);
  useEffect(() => {
    if (!viewPref.ready || stateLoaded) return;
    const s = (viewPref.state ?? {}) as any;
    const valid = new Set(SPL_DEFAULT_ORDER);
    if (Array.isArray(s.order)) {
      const kept = s.order.filter((k: any) => typeof k === "string" && valid.has(k));
      setOrder([...kept, ...SPL_DEFAULT_ORDER.filter((k) => !kept.includes(k))]);
    }
    if (s.visibility && typeof s.visibility === "object") {
      setVisibility({ ...SPL_DEFAULT_VISIBILITY, ...s.visibility });
    }
    if (Array.isArray(s.frozenExtras)) {
      setFrozenExtras(s.frozenExtras.filter((k: any) => typeof k === "string" && valid.has(k)));
    }
    if (s.colWidths && typeof s.colWidths === "object") {
      const kept: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.colWidths as Record<string, unknown>)) {
        if (typeof v === "number" && v > 0 && (valid.has(k) || k.startsWith("stage:"))) kept[k] = v;
      }
      setColWidths(kept);
    }
    if (Array.isArray(s.sorts)) {
      setSorts(
        s.sorts
          .filter((x: any) => x && typeof x.key === "string" && valid.has(x.key))
          .map((x: any) => ({ key: x.key as string, desc: !!x.desc })),
      );
    }
    setStateLoaded(true);
  }, [viewPref.ready, viewPref.state, stateLoaded]);
  const persistColumns = () => viewPref.save({ order, visibility, frozenExtras, colWidths, sorts } as any);
  useEffect(() => {
    if (!stateLoaded) return;
    viewPref.save({ order, visibility, frozenExtras, colWidths, sorts } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, order, visibility, frozenExtras, colWidths, sorts]);

  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [panelTarget, setPanelTarget] = useState<SplPanelTarget>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["spl-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
  });

  /** 역산 추정 실적 표시용 (이탤릭 + 툴팁) */
  const { data: estimated } = useQuery({
    queryKey: ["spl-estimated-cells"],
    queryFn: () => fetchEstimated({ data: undefined as never }),
  });
  const estMap = estimated?.map ?? {};

  type SplSearch = typeof search;
  const setSearch = (patch: Partial<SplSearch>) =>
    (navigate as (opts: unknown) => void)({
      to: "/closure/spare-part/raw-data",
      search: (prev: SplSearch) => ({ ...prev, ...patch }),
    });

  const catalog: SplCatalogEntry[] = data?.catalog ?? [];
  /** A. Single-row header — one cell per stage field, code taken from the catalog */
  const stageCols = useMemo(() => buildSplStageColumns(catalog), [catalog]);

  const rows = data?.rows ?? [];

  /** 필터 후보값 — 필터 적용 전 원본 행 distinct */
  const distinctValues = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of SPL_COLUMNS) if (c.filter === "multi") m.set(c.key, new Set<string>());
    for (const r of rows) {
      for (const c of SPL_COLUMNS) {
        if (c.filter !== "multi") continue;
        m.get(c.key)!.add(c.get(r));
      }
    }
    const out: Record<string, string[]> = {};
    for (const [k, s] of m) out[k] = [...s].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    return out;
  }, [rows]);

  const colDefMap = useMemo(() => new Map(SPL_COLUMNS.map((c) => [c.key, c] as const)), []);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return rows.filter((r) => {
      if (search.plot && search.plot !== "all" && (r.plot ?? "") !== search.plot) return false;
      // 카드 = 드릴다운: 정본이 내려준 judgment 필드를 그대로 술어로 사용
      if (search.judgment && search.judgment !== "all" && r.judgment !== search.judgment) return false;
      // HDEC 실적 미확보 드릴다운 — 판정과 독립된 술어
      if (search.hdecMissing && (r.hdec_actual_count ?? 0) !== 0) return false;
      // OCS 캐시 숫자 필터 — 과거 as-of(캐시 null)에서는 미적용
      if (isToday && search.ocs && search.ocs !== "all") {
        const t = r.ocs_total;
        const p = r.ocs_pending;
        if (t == null) return false;
        if (search.ocs === "pending" && !((p ?? 0) > 0)) return false;
        if (search.ocs === "complied" && !(t > 0 && (p ?? 0) === 0)) return false;
        if (search.ocs === "none" && t !== 0) return false;
      }
      // 밴드 지연 셀 드릴다운 = 활성 밴드 + 대표 지연이 그 밴드
      if (search.delayBand) {
        if (r.active_band !== search.delayBand) return false;
        if (r.primary_delay?.band !== search.delayBand) return false;
      }
      for (const [key, vals] of Object.entries(colFilters)) {
        if (!vals || vals.length === 0) continue;
        const def = colDefMap.get(key);
        if (!def) continue;
        if (!vals.includes(def.get(r))) return false;
      }
      if (!q) return true;
      return [r.spl_number, r.title, r.team, r.pic, r.eng, r.supplier, r.dis, r.service]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search.q, search.plot, search.judgment, search.delayBand, search.hdecMissing, search.ocs, isToday, colFilters, colDefMap]);

  /** 표시 컬럼 배치 — __select 는 항상 좌측 고정, 그다음 사용자 pin */
  const layout = useMemo(() => {
    const visibleOrder = order.filter((k) => visibility[k] !== false && colDefMap.has(k));
    const frozen = frozenExtras.filter((k) => visibleOrder.includes(k));
    const rest = visibleOrder.filter((k) => !frozen.includes(k));
    const items: Array<{ key: string; def: SplColumnDef | null; width: number; left: number | null }> = [
      { key: "__select", def: null, width: 36, left: 0 },
    ];
    let left = 36;
    for (const k of frozen) {
      const def = colDefMap.get(k)!;
      const w = colWidths[k] ?? def.width;
      items.push({ key: k, def, width: w, left });
      left += w;
    }
    for (const k of rest) {
      const def = colDefMap.get(k)!;
      items.push({ key: k, def, width: colWidths[k] ?? def.width, left: null });
    }
    return items;
  }, [order, visibility, frozenExtras, colDefMap, colWidths]);

  const exportColumns = useMemo(
    () => layout.filter((i) => i.def).map((i) => ({ key: i.key, label: i.def!.label })),
    [layout],
  );

  /** 다중 정렬 적용 — 빈 값은 항상 뒤로, 숫자로 읽히면 숫자 비교 */
  const sorted = useMemo(() => {
    if (sorts.length === 0) return filtered;
    const cmpText = (a: string, b: string) => {
      if (a === b) return 0;
      if (a === "") return 1;
      if (b === "") return -1;
      const na = Number.parseFloat(a);
      const nb = Number.parseFloat(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
      return a.localeCompare(b, undefined, { numeric: true });
    };
    return [...filtered].sort((ra, rb) => {
      for (const s of sorts) {
        const def = colDefMap.get(s.key);
        if (!def) continue;
        const r = cmpText(def.get(ra), def.get(rb));
        if (r !== 0) return s.desc ? -r : r;
      }
      return 0;
    });
  }, [filtered, sorts, colDefMap]);

  /** 헤더 클릭 = 오름차순 → 내림차순 → 해제. 선택 순서가 우선순위가 된다. */
  const toggleSort = (key: string) =>
    setSorts((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      if (i < 0) return [...prev, { key, desc: false }];
      if (!prev[i].desc) {
        const next = [...prev];
        next[i] = { key, desc: true };
        return next;
      }
      return prev.filter((s) => s.key !== key);
    });

  const saveOne = async (id: string, field: string, value: string | null) => {
    await saveField({ data: { id, field, value } });
  };
  const refetchRows = async () => {
    await queryClient.invalidateQueries({ queryKey: ["spl-rows-as-of"] });
  };

  // Primary delay by band 분포 (Required Doc 은 사슬·판정 제외 → 집계 대상 아님)
  const delayBands = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of catalog) if (!s.chain_excluded) m.set(s.band, m.get(s.band) ?? 0);
    for (const r of rows) if (r.primary_delay) m.set(r.primary_delay.band, (m.get(r.primary_delay.band) ?? 0) + 1);
    return [...m.entries()];
  }, [rows, catalog]);

  // Required Doc 충족률 — 병렬 지표. 판정 5분류에 합산되지 않음
  const reqDoc = useMemo(() => {
    const total = rows.length;
    const full = rows.filter((r) => r.req_doc_total > 0 && r.req_doc_done === r.req_doc_total).length;
    const sum = rows.reduce((a, r) => a + r.req_doc_done, 0);
    const denom = rows.reduce((a, r) => a + r.req_doc_total, 0);
    return { total, full, pct: denom === 0 ? 0 : Math.round((sum * 1000) / denom) / 10 };
  }, [rows]);

  // 합계 = 모집단 자체 검산 (불일치 시 미분류 노출)
  const counts = data?.judgment_counts ?? {};
  const countsSum = JUDGMENTS.reduce((a, j) => a + (counts[j] ?? 0), 0);
  const population = data?.total_count ?? 0;
  const reconOk = countsSum === population;

  async function onExport() {
    setExporting(true);
    try {
      const payload = await fetchExport({ data: {} } as any);
      const name = downloadSplRoundtripWorkbook(payload as any);
      toast.success(`Export complete — ${name} (HDEC re-importable format)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const viol = data?.violations;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spare Part List — Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            All displayed and aggregated figures come from the canonical functions (spl_rows_as_of → spl_eval_as_of → spl_judge_v1) and are recomputed on read. Data Date
            is per row and for display only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataDatePicker
            value={search.asOf ?? ""}
            latest={data?.as_of ?? today}
            options={[]}
            onChange={(v) => setSearch({ asOf: v })}
            onReset={() => setSearch({ asOf: "" })}
          />
          <SplColumnOrderMenu
            order={order}
            visibility={visibility}
            frozenExtras={frozenExtras}
            onOrderChange={setOrder}
            onVisibilityChange={setVisibility}
            onFrozenChange={setFrozenExtras}
            onSave={() => {
              persistColumns();
              toast.success("Column settings saved.");
            }}
          />
          <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Export
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.q ?? ""}
            onChange={(e) => setSearch({ q: e.target.value })}
            placeholder="SPL NUMBER · Title · Team · PIC · Supplier"
            className="h-8 w-[320px] pl-7 text-xs"
          />
        </div>
        {(["all", "C", "D"] as const).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={(search.plot ?? "all") === p ? "default" : "outline"}
            className="h-8 text-xs"
            onClick={() => setSearch({ plot: p })}
          >
            {p === "all" ? "All Plots" : `PLOT-${p}`}
          </Button>
        ))}
        <span className="ml-1 text-[11px] text-muted-foreground">OCS</span>
        {([
          ["all", "All"],
          ["pending", "Pending OCS"],
          ["complied", "Complied"],
          ["none", "No OCS"],
        ] as const).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={(search.ocs ?? "all") === v ? "default" : "outline"}
            className="h-8 text-xs"
            disabled={!isToday}
            title={isToday ? undefined : "과거 As-of 조회에서는 OCS 필터를 사용할 수 없습니다"}
            onClick={() => setSearch({ ocs: v })}
          >
            {label}
          </Button>
        ))}
        {viol && (
          <>
          <Badge variant={viol.total > 0 ? "destructive" : "outline"} className="gap-1 text-[11px]">
            <AlertTriangle className="h-3 w-3" />
            선후관계 위반 {viol.total}건
            {viol.total > 0 && <span className="opacity-80">· 최근 임포트 발생 {viol.from_last_import}건</span>}
          </Badge>
          <Badge
            variant="outline"
            className="text-[11px]"
            title="No progress row exists for the preceding stage — HDEC import incomplete, not an actual sequence reversal"
          >
            Data not loaded {viol.import_incomplete ?? 0}
          </Badge>
          </>
        )}
        {(data?.plan_items ?? 0) === 0 && (
          <Badge variant="secondary" className="text-[11px]">
            No HDEC plan dates loaded — delay judgment not applied (items with a plan date: {data?.plan_items ?? 0})
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", ...JUDGMENTS] as const).map((j) => (
          <Button
            key={j}
            size="sm"
            variant={(search.judgment ?? "all") === j && !search.delayBand ? "default" : "outline"}
            className="h-7 text-[11px]"
            onClick={() =>
              setSearch({
                judgment: search.judgment === j ? "all" : j,
                delayBand: "",
                hdecMissing: false,
              })
            }
          >
            {j === "all" ? `All (${population})` : `${splJudgmentLabel(j)} ${counts[j] ?? 0}`}
          </Button>
        ))}
        {!reconOk && (
          <Badge variant="outline" className="text-[11px] text-amber-600">
            Reconciliation mismatch: sum {countsSum} / population {population}
          </Badge>
        )}
        {sorts.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setSorts([])}>
            Clear sort ({sorts.length})
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Primary delay by band</span>
        {delayBands.map(([band, n]) => (
          <Button
            key={band}
            size="sm"
            variant={search.delayBand === band ? "default" : "outline"}
            className="h-7 text-[11px]"
            onClick={() => setSearch({ delayBand: search.delayBand === band ? "" : band, judgment: "all" })}
          >
            {BAND_LABEL[band] ?? band} {n}
          </Button>
        ))}
        <Badge variant="outline" className="text-[11px]">
          Required documents ready {reqDoc.pct}% · fully ready {reqDoc.full} (not part of the judgment population)
        </Badge>
        <Button
          size="sm"
          variant={search.hdecMissing ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => setSearch({ hdecMissing: !search.hdecMissing, delayBand: "" })}
        >
          No HDEC actual: {data?.hdec_missing_items ?? 0}
        </Button>
        <Badge variant="outline" className="text-[11px]">
          Estimated actuals: {estimated?.items ?? 0} documents (back-filled · shown in italics)
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : (
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-max border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr>
                    {layout.map((it) => {
                      const inner =
                        it.key === "__select" ? (
                          <Checkbox
                            checked={sorted.length > 0 && selectedIds.length === sorted.length}
                            onCheckedChange={(v) => setSelectedIds(v ? sorted.map((r) => r.id) : [])}
                            aria-label="Select all"
                          />
                        ) : (
                          <span className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={() => toggleSort(it.key)}
                              title="클릭: 오름차순 → 내림차순 → 해제 (클릭 순서가 정렬 우선순위)"
                              className="inline-flex items-center gap-0.5 hover:text-primary"
                            >
                              {it.def!.label}
                              {(() => {
                                const idx = sorts.findIndex((s) => s.key === it.key);
                                if (idx < 0) return null;
                                return (
                                  <>
                                    {sorts[idx].desc ? (
                                      <ArrowDown className="h-3 w-3" />
                                    ) : (
                                      <ArrowUp className="h-3 w-3" />
                                    )}
                                    <SortPriorityBadge index={idx} total={sorts.length} />
                                  </>
                                );
                              })()}
                            </button>
                            {it.def!.filter === "multi" && (
                              <SplColumnFilterDropdown
                                label={it.def!.label}
                                values={distinctValues[it.key] ?? []}
                                selected={colFilters[it.key] ?? []}
                                onChange={(next) => setColFilters((p) => ({ ...p, [it.key]: next }))}
                              />
                            )}
                          </span>
                        );
                      const resizer =
                        it.def == null ? null : (
                          <ColumnResizeHandle
                            width={it.width}
                            onChange={(w: number) => setColWidths((p) => ({ ...p, [it.key]: w }))}
                          />
                        );
                      return it.left != null ? (
                        <StickyHead key={it.key} left={it.left} width={it.width}>
                          {inner}
                          {resizer}
                        </StickyHead>
                      ) : (
                        <th
                          key={it.key}
                          style={{ width: it.width, minWidth: it.width, maxWidth: it.width }}
                          className="sticky top-0 z-30 relative overflow-hidden whitespace-nowrap border-b border-l px-2 py-1 text-left bg-muted [background-image:linear-gradient(hsl(var(--muted)),hsl(var(--muted)))]"
                        >
                          {inner}
                          {resizer}
                        </th>
                      );
                    })}
                    {stageCols.map((sc) => (
                      <th
                        key={sc.key}
                        title={sc.title}
                        style={
                          colWidths[`stage:${sc.key}`]
                            ? {
                                width: colWidths[`stage:${sc.key}`],
                                minWidth: colWidths[`stage:${sc.key}`],
                              }
                            : undefined
                        }
                        className={cn(
                          "sticky top-0 z-30 relative overflow-hidden whitespace-nowrap border-b border-l px-2 py-1 text-center font-medium",
                          splBandHeaderClass(sc.band),
                          sc.bandStart && "border-l-2 border-l-foreground/40",
                        )}
                      >
                        {sc.code}
                        <ColumnResizeHandle
                          width={colWidths[`stage:${sc.key}`] ?? 84}
                          min={40}
                          onChange={(w: number) =>
                            setColWidths((p) => ({ ...p, [`stage:${sc.key}`]: w }))
                          }
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <SplTableRow
                      key={r.id}
                      row={r}
                      stageCols={stageCols}
                      estCells={estMap[r.id]}
                      layout={layout}
                      stageWidths={colWidths}
                      selected={selectedIds.includes(r.id)}
                      onToggleSelect={() =>
                        setSelectedIds((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))
                      }
                      onOpenDetail={() =>
                        rootNavigate({ to: "/closure/spare-part/detail/$id", params: { id: r.id } })
                      }
                      onOpenPanel={(kind) =>
                        setPanelTarget({ id: r.id, splNumber: r.spl_number, kind })
                      }
                      canEdit={isToday && canRow(r as unknown as Record<string, unknown>)}
                      onSave={async (field, value) => {
                        await saveField({ data: { id: r.id, field, value } });
                        await queryClient.invalidateQueries({ queryKey: ["spl-rows-as-of"] });
                      }}
                    />
                  ))}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={layout.length + stageCols.length} className="p-8 text-center text-muted-foreground">
                        No rows match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SplBulkEditBar
        selectedIds={selectedIds}
        teamOptions={[...SPL_TEAM_OPTIONS]}
        onClear={() => setSelectedIds([])}
        onSaveField={saveOne}
        onDone={refetchRows}
        disabledReason={isToday ? null : "Editing is disabled in as-of (historical) view."}
      />

      <SplExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={sorted}
        exportColumns={exportColumns}
        onRoundtrip={onExport}
      />

      <SplOcsPanels
        key={panelTarget ? `${panelTarget.id}:${panelTarget.kind}` : "none"}
        target={panelTarget}
        onClose={() => setPanelTarget(null)}
      />

      <div className="text-[11px] text-muted-foreground">
        Showing {sorted.length.toLocaleString()} of {population.toLocaleString()} rows · As of {asOf} · NA stages are marked{" "}
        <span className="rounded bg-muted px-1">NA</span> and excluded from the progress denominator (distinct from blank).
      </div>
    </div>
  );
}

function SplEditableCell({
  row,
  field,
  label,
  value,
  canEdit,
  onSave,
}: {
  row: SplRow;
  field: string;
  label: string;
  value: string | null;
  canEdit: boolean;
  onSave: (field: string, value: string | null) => Promise<void>;
}) {
  return (
    <AbdEditCellPopover
      id={row.id}
      field={field}
      label={label}
      editorType="text"
      currentValue={value}
      canEdit={canEdit}
      saveFn={async (p) => onSave(p.field, p.value == null ? null : String(p.value))}
    >
      <span>{value ?? "—"}</span>
    </AbdEditCellPopover>
  );
}

function SplTableRow({
  row,
  stageCols,
  estCells,
  layout,
  stageWidths,
  selected,
  onToggleSelect,
  onOpenDetail,
  onOpenPanel,
  canEdit,
  onSave,
}: {
  row: SplRow;
  stageCols: SplStageColumn[];
  /** 역산 추정 실적 칸 — stage_code -> { as, af } */
  estCells?: Record<string, { as?: boolean; af?: boolean }>;
  layout: Array<{ key: string; def: SplColumnDef | null; width: number; left: number | null }>;
  /** 사용자가 조절한 스테이지 컬럼 폭 — 키는 `stage:<컬럼키>` */
  stageWidths?: Record<string, number>;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
  onOpenPanel: (kind: SplPanelKind) => void;
  canEdit: boolean;
  onSave: (field: string, value: string | null) => Promise<void>;
}) {
  const judgeTone =
    row.judgment === "지연"
      ? "bg-red-100 text-red-800"
      : row.judgment === "완료"
        ? "bg-emerald-100 text-emerald-800"
        : row.judgment === "미분류"
          ? "bg-amber-100 text-amber-800"
          : // 미착수 = 중립(회색). 지연색 사용 금지
            "bg-slate-100 text-slate-800";

  const renderCell = (key: string) => {
    switch (key) {
      case "spl_number":
        return (
          <button type="button" className="font-mono text-primary hover:underline" onClick={onOpenDetail}>
            {row.spl_number}
          </button>
        );
      case "plot":
        return row.plot ? `PLOT-${row.plot}` : "—";
      case "team":
      case "pic":
      case "eng":
      case "pic_po":
      case "eng_po":
        return (
          <SplEditableCell
            row={row}
            field={key}
            label={key.toUpperCase()}
            value={(row as any)[key] ?? null}
            canEdit={canEdit}
            onSave={onSave}
          />
        );
      case "judgment":
        return (
          <>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", judgeTone)}>
              {splJudgmentLabel(row.judgment)}
            </span>
            {(row.hdec_actual_count ?? 0) === 0 && (
              <span
                className="ml-1 rounded bg-muted px-1 text-[9px] text-muted-foreground"
                title="No actual recorded on any HDEC-authoritative stage — data status only, independent of judgment"
              >
                No HDEC actual
              </span>
            )}
          </>
        );
      case "progress_pct":
        return (
          <span className="tabular-nums">
            {row.progress_pct == null ? "—" : `${row.progress_pct}%`}
            <span className="ml-1 text-[9px] text-muted-foreground">
              {row.done}/{row.denom}
            </span>
          </span>
        );
      case "current_stage":
        return (
          <span className="text-muted-foreground">
            {row.current_stage ? row.current_stage.label : row.active_band ? "—" : "All bands closed"}
          </span>
        );
      case "primary_delay":
        return (
          <>
            {row.primary_delay ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                {row.primary_delay.label} · {row.primary_delay.days}d
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {row.delay_bucket.length > 0 && (
              <span className="ml-1 text-[9px] text-muted-foreground" title="Trailing delays — informational, not counted in the delay card">
                +{row.delay_bucket.length}
              </span>
            )}
          </>
        );
      case "req_doc":
        return (
          <span className="tabular-nums text-muted-foreground">
            {row.req_doc_done}/{row.req_doc_total}
          </span>
        );
      case "ocs":
        return (
          <SplOcsCell
            total={row.ocs_total}
            pending={row.ocs_pending}
            complied={row.ocs_complied}
            resolved={row.ocs_check}
            onClick={() => onOpenPanel("ocs")}
          />
        );
      case "rsp":
        return (
          <SplCountCell
            value={row.rsp_total}
            tone="neutral"
            title="Recommended Spare Parts"
            onClick={() => onOpenPanel("rsp")}
          />
        );
      case "documents":
        return (
          <SplCountCell
            value={row.document_total}
            tone="neutral"
            title="Submitted documents"
            onClick={() => onOpenPanel("documents")}
          />
        );
      case "data_date":
        return <span className="text-muted-foreground">{row.data_date ? formatDdMmm(row.data_date) : "—"}</span>;
      default: {
        const v = (row as any)[key] as string | null | undefined;
        const naLike =
          v != null && /^\s*(n\/?a|not\s*applicable|not\s*applicable\s*\(na\))\s*$/i.test(String(v).trim());
        return (
          <span className={cn(naLike && "rounded bg-slate-200 px-1.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
            {v ?? "—"}
          </span>
        );
      }
    }
  };

  return (
    <tr
      className={cn(
        "hover:bg-muted/30",
        selected && "bg-primary/5",
        row.judgment === "완료" && "bg-slate-100/70 text-slate-500",
      )}
    >
      {layout.map((it) => {
        const inner =
          it.key === "__select" ? (
            <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label="Select row" />
          ) : (
            renderCell(it.key)
          );
        return it.left != null ? (
          <StickyCell key={it.key} left={it.left} width={it.width}>
            {inner}
          </StickyCell>
        ) : (
          <td
            key={it.key}
            style={{ width: it.width, minWidth: it.width, maxWidth: it.width }}
            className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-l px-2 py-1"
          >
            {inner}
          </td>
        );
      })}
      {stageCols.map((sc) => {
        const cell = row.stages[sc.stage_code];
        const isNa = cell?.na;
        const raw = cell?.[sc.field] as string | null | undefined;
        const isEst =
          !!raw && (sc.field === "as" || sc.field === "af") && !!estCells?.[sc.stage_code]?.[sc.field];
        return (
          <td
            key={sc.key}
            style={
              stageWidths?.[`stage:${sc.key}`]
                ? {
                    width: stageWidths[`stage:${sc.key}`],
                    minWidth: stageWidths[`stage:${sc.key}`],
                  }
                : undefined
            }
            className={cn(
              "overflow-hidden whitespace-nowrap border-b border-l px-2 py-1 text-center tabular-nums",
              STATE_CLASS[cell?.st ?? "none"],
              isNa && "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              isEst && "italic",
            )}
            title={
              isNa
                ? "NA — excluded from the progress denominator"
                : isEst
                  ? `Estimated (back-filled) — ${sc.title}`
                  : sc.title
            }
          >
            {isNa ? (
              <span className="text-[9px] font-semibold uppercase tracking-wide">N/A</span>
            ) : raw ? (
              sc.field === "fv" ? raw : formatDdMmm(raw)
            ) : (
              ""
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** Sticky header cell — background must stay 100% opaque */
function StickyHead({
  children,
  left,
  width,
}: {
  children: React.ReactNode;
  left: number;
  width: number;
}) {
  return (
    <th
      style={{ left, top: 0, width, minWidth: width, maxWidth: width }}
      className="sticky z-40 relative overflow-hidden whitespace-nowrap border-b border-l bg-background px-2 py-1 text-left [background-image:linear-gradient(hsl(var(--muted)),hsl(var(--muted)))]"
    >
      {children}
    </th>
  );
}

/** 고정(스티키) 셀 — 배경 100% 불투명 유지 */
function StickyCell({
  children,
  left,
  width,
  className,
}: {
  children: React.ReactNode;
  left: number;
  width: number;
  className?: string;
}) {
  return (
    <td
      style={{ left, width, minWidth: width, maxWidth: width }}
      className={cn(
        "sticky z-10 overflow-hidden text-ellipsis whitespace-nowrap border-b border-l px-2 py-1",
        "bg-background [background-image:linear-gradient(hsl(var(--background)),hsl(var(--background)))]",
        className,
      )}
    >
      {children}
    </td>
  );
}
