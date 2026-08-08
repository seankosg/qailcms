import { useEffect, useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, Download, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha, formatDdMmm } from "@/lib/time/doha";
import {
  getWrtRowsAsOf,
  getWrtExportRows,
  type WrtCatalogEntry,
  type WrtRow,
  type WrtStageCell,
} from "@/lib/wrt/rows.functions";
import { downloadWrtRoundtripWorkbook } from "@/lib/wrt/roundtrip-export";
import { updateWrtField } from "@/lib/wrt/mutations.functions";
import { AbdEditCellPopover } from "@/components/abd/raw-data/AbdEditCellPopover";
import { useRclCan } from "@/hooks/useRclCan";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import {
  WRT_BAND_LABEL,
  WRT_COLUMNS,
  WRT_DEFAULT_ORDER,
  WRT_DEFAULT_VISIBILITY,
  buildWrtStageColumns,
  wrtBandHeaderClass,
  wrtJudgmentLabel,
  type WrtColumnDef,
  type WrtStageColumn,
} from "./wrt-columns";
import { WrtColumnFilterDropdown } from "./WrtColumnFilterDropdowns";
import { WrtColumnOrderMenu } from "./WrtColumnOrderMenu";
import { WrtBulkEditBar } from "./WrtBulkEditBar";
import { WrtDetailSheet } from "./WrtDetailSheet";
import { WrtExportDialog } from "./WrtExportDialog";

const routeApi = getRouteApi("/_authenticated/closure/warranty/raw-data");

const BAND_LABEL = WRT_BAND_LABEL;

const JUDGMENTS = ["완료", "정상", "지연", "미착수", "미분류", "제외"] as const;

/**
 * ★ 계획일 임포트 직후 재실행 필수 검증 체크리스트 (D-4-3)
 *  1. 지연 KPI 카드 클릭 → 드릴다운 목록 건수 == 카드값
 *  2. Primary delay by band 칩 합계 == 지연 카드값
 *  3. 아이템당 primary_delay ≤ 1
 *  현재 상태: 불변식 I-1 / I-3 / I-5 는 지연 표본 0 위에서 관측된 것이므로 "미검증".
 */

/** 라운드 선행 표기 — "R1 Submission" (ABD "R1 DS" 어휘 규칙 동일) */
function stageLabel(s: { label: string; round_no?: number | null } | null | undefined) {
  if (!s) return "—";
  const base = s.label.replace(/\s*\(R\d\)\s*$/, "");
  return s.round_no ? `R${s.round_no} ${base}` : base;
}

const STATE_CLASS: Record<WrtStageCell["st"], string> = {
  done: "text-emerald-700 dark:text-emerald-400 font-medium",
  delayed: "text-red-600 dark:text-red-400 font-medium",
  wip: "text-amber-600 dark:text-amber-400",
  planned: "text-muted-foreground",
  na: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function WrtRawDataPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;
  const [exporting, setExporting] = useState(false);

  const fetchRows = useServerFn(getWrtRowsAsOf);
  const fetchExport = useServerFn(getWrtExportRows);
  const saveField = useServerFn(updateWrtField);
  const queryClient = useQueryClient();
  const { canRow } = useRclCan("WRT", "write");
  const isToday = asOf === today;

  // ── 컬럼 설정(순서·표시·고정) — 계정 단위 저장 ──
  const viewPref = useUserViewPreference("wrt.raw-data.v1");
  const [order, setOrder] = useState<string[]>(WRT_DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(WRT_DEFAULT_VISIBILITY);
  const [frozenExtras, setFrozenExtras] = useState<string[]>(["wrt_number"]);
  const [stateLoaded, setStateLoaded] = useState(false);
  useEffect(() => {
    if (!viewPref.ready || stateLoaded) return;
    const s = (viewPref.state ?? {}) as any;
    const valid = new Set(WRT_DEFAULT_ORDER);
    if (Array.isArray(s.order)) {
      const kept = s.order.filter((k: any) => typeof k === "string" && valid.has(k));
      setOrder([...kept, ...WRT_DEFAULT_ORDER.filter((k) => !kept.includes(k))]);
    }
    if (s.visibility && typeof s.visibility === "object") {
      setVisibility({ ...WRT_DEFAULT_VISIBILITY, ...s.visibility });
    }
    if (Array.isArray(s.frozenExtras)) {
      setFrozenExtras(s.frozenExtras.filter((k: any) => typeof k === "string" && valid.has(k)));
    }
    setStateLoaded(true);
  }, [viewPref.ready, viewPref.state, stateLoaded]);
  const persistColumns = () => viewPref.save({ order, visibility, frozenExtras } as any);
  useEffect(() => {
    if (!stateLoaded) return;
    viewPref.save({ order, visibility, frozenExtras } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateLoaded, order, visibility, frozenExtras]);

  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailRow, setDetailRow] = useState<WrtRow | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wrt-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
  });

  type WrtSearch = typeof search;
  const setSearch = (patch: Partial<WrtSearch>) =>
    (navigate as (opts: unknown) => void)({
      to: "/closure/warranty/raw-data",
      search: (prev: WrtSearch) => ({ ...prev, ...patch }),
    });

  const catalog: WrtCatalogEntry[] = data?.catalog ?? [];
  /** A. Single-row header — one cell per stage field, code taken from the catalog */
  const stageCols = useMemo(() => buildWrtStageColumns(catalog), [catalog]);

  const rows = data?.rows ?? [];

  /** 필터 후보값 — 필터 적용 전 원본 행 distinct */
  const distinctValues = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of WRT_COLUMNS) if (c.filter === "multi") m.set(c.key, new Set<string>());
    for (const r of rows) {
      for (const c of WRT_COLUMNS) {
        if (c.filter !== "multi") continue;
        m.get(c.key)!.add(c.get(r));
      }
    }
    const out: Record<string, string[]> = {};
    for (const [k, s] of m) out[k] = [...s].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    return out;
  }, [rows]);

  const colDefMap = useMemo(() => new Map(WRT_COLUMNS.map((c) => [c.key, c] as const)), []);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return rows.filter((r) => {
      if (search.plot && search.plot !== "all" && (r.plot ?? "") !== search.plot) return false;
      if (search.round && search.round !== "all" && String(r.active_round) !== search.round) return false;
      // 카드 = 드릴다운: 정본이 내려준 judgment 필드를 그대로 술어로 사용
      if (search.judgment && search.judgment !== "all" && r.judgment !== search.judgment) return false;
      // HDEC 실적 미확보 드릴다운 — 판정과 독립된 술어
      if (search.hdecMissing && (r.hdec_actual_count ?? 0) !== 0) return false;
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
      return [r.wrt_number, r.title, r.team, r.pic, r.eng, r.dis, r.service]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search.q, search.plot, search.judgment, search.round, search.delayBand, search.hdecMissing, colFilters, colDefMap]);

  /** 표시 컬럼 배치 — __select 는 항상 좌측 고정, 그다음 사용자 pin */
  const layout = useMemo(() => {
    const visibleOrder = order.filter((k) => visibility[k] !== false && colDefMap.has(k));
    const frozen = frozenExtras.filter((k) => visibleOrder.includes(k));
    const rest = visibleOrder.filter((k) => !frozen.includes(k));
    const items: Array<{ key: string; def: WrtColumnDef | null; width: number; left: number | null }> = [
      { key: "__select", def: null, width: 36, left: 0 },
    ];
    let left = 36;
    for (const k of frozen) {
      const def = colDefMap.get(k)!;
      items.push({ key: k, def, width: def.width, left });
      left += def.width;
    }
    for (const k of rest) {
      const def = colDefMap.get(k)!;
      items.push({ key: k, def, width: def.width, left: null });
    }
    return items;
  }, [order, visibility, frozenExtras, colDefMap]);

  const exportColumns = useMemo(
    () => layout.filter((i) => i.def).map((i) => ({ key: i.key, label: i.def!.label })),
    [layout],
  );

  const teamOptions = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const saveOne = async (id: string, field: string, value: string | null) => {
    await saveField({ data: { id, field, value } });
  };
  const refetchRows = async () => {
    await queryClient.invalidateQueries({ queryKey: ["wrt-rows-as-of"] });
  };

  const delayBands = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of catalog) if (!s.chain_excluded) m.set(s.band, m.get(s.band) ?? 0);
    for (const r of rows) if (r.primary_delay) m.set(r.primary_delay.band, (m.get(r.primary_delay.band) ?? 0) + 1);
    return [...m.entries()];
  }, [rows, catalog]);

  const responseWaitItems = useMemo(() => rows.filter((r) => r.response_wait.length > 0).length, [rows]);

  // 합계 = 모집단 자체 검산 (불일치 시 미분류 노출)
  const counts = data?.judgment_counts ?? {};
  const countsSum = JUDGMENTS.reduce((a, j) => a + (counts[j] ?? 0), 0);
  const population = data?.total_count ?? 0;
  const reconOk = countsSum === population;

  async function onExport() {
    setExporting(true);
    try {
      const payload = await fetchExport({ data: {} } as any);
      const name = downloadWrtRoundtripWorkbook(payload as any);
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
          <h1 className="text-2xl font-semibold tracking-tight">Warranty — Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            All displayed and aggregated figures come from the canonical functions (wrt_rows_as_of → wrt_eval_as_of →
            wrt_judge_v1) and are recomputed on read. Completion follows Final Approved (A).
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
          <WrtColumnOrderMenu
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
            placeholder="WRT NUMBER · Title · Team · PIC · DIS"
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
        {(["all", "1", "2"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={(search.round ?? "all") === r ? "secondary" : "outline"}
            className="h-8 text-xs"
            onClick={() => setSearch({ round: r })}
          >
            {r === "all" ? "All Rounds" : `R${r}`}
          </Button>
        ))}
        {viol && (
          <>
            <Badge
              variant={viol.total > 0 ? "destructive" : (viol.inspected_items ?? 0) === 0 ? "secondary" : "outline"}
              className="gap-1 text-[11px]"
            >
              <AlertTriangle className="h-3 w-3" />
              {(viol.inspected_items ?? 0) === 0 ? (
                <>Violation check not run — HDEC submission actuals not imported</>
              ) : (
                <>
                  Violations {viol.total} (inspected {viol.inspected_items}) · precedence {viol.precedence} · round attribution{" "}
                  {viol.ghost_round} · response before submission {viol.response_before_submission ?? 0}
                  {viol.from_last_import > 0 && (
                    <span className="opacity-80"> · from the latest import {viol.from_last_import}</span>
                  )}
                </>
              )}
            </Badge>
            <Badge
              variant="outline"
              className="text-[11px]"
              title="Aconex response exists while no HDEC submission actual is present in any round — pending import, not a violation"
            >
              Pending submission {viol.pending_hdec_items ?? 0} ({viol.pending_hdec ?? 0} round pairs · R1{" "}
              {viol.pending_hdec_r1 ?? 0} / R2 {viol.pending_hdec_r2 ?? 0})
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

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <KpiCard
          label="Population (documents)"
          value={population}
          active={(search.judgment ?? "all") === "all" && !search.delayBand}
          onClick={() => setSearch({ judgment: "all", delayBand: "" })}
          note={reconOk ? "Sum = population ✓" : `Reconciliation mismatch: sum ${countsSum}`}
          tone={reconOk ? undefined : "warn"}
        />
        {JUDGMENTS.map((j) => (
          <KpiCard
            key={j}
            label={j}
            value={counts[j] ?? 0}
            active={search.judgment === j && !search.delayBand}
            onClick={() =>
              setSearch({ judgment: search.judgment === j ? "all" : j, delayBand: "", hdecMissing: false })
            }
            note={
              j === "완료"
                ? `Final Approved (A) · no HDEC actual: ${data?.hdec_missing_done ?? 0}`
                : j === "미분류"
                  ? "No plan and no actual (denominator 0)"
                  : j === "제외"
                    ? "Cancelled — excluded from statistics"
                    : j === "지연"
                      ? "Documents with a primary delay"
                      : j === "미착수"
                        ? "No judgeable stage in the active band"
                        : undefined
            }
            tone={j === "지연" ? "bad" : j === "미분류" ? "warn" : undefined}
          />
        ))}
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
          Awaiting response: {responseWaitItems} (Aconex-owned · not counted in the delay card)
        </Badge>
        <Button
          size="sm"
          variant={search.hdecMissing ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() => setSearch({ hdecMissing: !search.hdecMissing, delayBand: "" })}
        >
          No HDEC actual: {data?.hdec_missing_items ?? 0}
        </Button>
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
                            checked={filtered.length > 0 && selectedIds.length === filtered.length}
                            onCheckedChange={(v) =>
                              setSelectedIds(v ? filtered.map((r) => r.id) : [])
                            }
                            aria-label="Select all"
                          />
                        ) : (
                          <span className="inline-flex items-center">
                            {it.def!.label}
                            {it.def!.filter === "multi" && (
                              <WrtColumnFilterDropdown
                                label={it.def!.label}
                                values={distinctValues[it.key] ?? []}
                                selected={colFilters[it.key] ?? []}
                                onChange={(next) =>
                                  setColFilters((p) => ({ ...p, [it.key]: next }))
                                }
                              />
                            )}
                          </span>
                        );
                      return it.left != null ? (
                        <StickyHead key={it.key} left={it.left} width={it.width}>
                          {inner}
                        </StickyHead>
                      ) : (
                        <th
                          key={it.key}
                          style={{ minWidth: it.width }}
                          className="whitespace-nowrap border-b border-l bg-muted px-2 py-1 text-left"
                        >
                          {inner}
                        </th>
                      );
                    })}
                    {stageCols.map((sc) => (
                      <th
                        key={sc.key}
                        title={sc.title}
                        className={cn(
                          "whitespace-nowrap border-b border-l px-2 py-1 text-center font-medium",
                          wrtBandHeaderClass(sc.band),
                          sc.bandStart && "border-l-2 border-l-foreground/40",
                        )}
                      >
                        {sc.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <WrtTableRow
                      key={r.id}
                      row={r}
                      stageCols={stageCols}
                      layout={layout}
                      selected={selectedIds.includes(r.id)}
                      onToggleSelect={() =>
                        setSelectedIds((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))
                      }
                      onOpenDetail={() => setDetailRow(r)}
                      canEdit={isToday && canRow(r as unknown as Record<string, unknown>)}
                      onSave={async (field, value) => {
                        await saveField({ data: { id: r.id, field, value } });
                        await queryClient.invalidateQueries({ queryKey: ["wrt-rows-as-of"] });
                      }}
                    />
                  ))}
                  {filtered.length === 0 && (
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

      <WrtBulkEditBar
        selectedIds={selectedIds}
        teamOptions={teamOptions}
        onClear={() => setSelectedIds([])}
        onSaveField={saveOne}
        onDone={refetchRows}
        disabledReason={isToday ? null : "Editing is disabled in as-of (historical) view."}
      />

      <WrtDetailSheet
        row={detailRow}
        catalog={catalog}
        canEdit={isToday && !!detailRow && canRow(detailRow as unknown as Record<string, unknown>)}
        onSave={async (id, field, value) => {
          await saveOne(id, field, value);
          await refetchRows();
        }}
        onOpenChange={(o) => { if (!o) setDetailRow(null); }}
      />

      <WrtExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rows={filtered}
        exportColumns={exportColumns}
        onRoundtrip={onExport}
      />

      <div className="text-[11px] text-muted-foreground">
        Showing {filtered.length.toLocaleString()} of {population.toLocaleString()} rows · As of {asOf} · NA stages are marked{" "}
        <span className="rounded bg-muted px-1">NA</span> and excluded from the progress denominator (distinct from blank).
      </div>
    </div>
  );
}

function WrtTableRow({
  row,
  stageCols,
  layout,
  selected,
  onToggleSelect,
  onOpenDetail,
  canEdit,
  onSave,
}: {
  row: WrtRow;
  stageCols: WrtStageColumn[];
  layout: Array<{ key: string; def: WrtColumnDef | null; width: number; left: number | null }>;
  selected: boolean;
  onToggleSelect: () => void;
  onOpenDetail: () => void;
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
          : row.judgment === "제외"
            ? "bg-muted text-muted-foreground"
            : // 미착수 = 중립(회색). 지연색 사용 금지
              "bg-slate-100 text-slate-800";

  const renderCell = (key: string) => {
    switch (key) {
      case "wrt_number":
        return (
          <button type="button" className="font-mono text-primary hover:underline" onClick={onOpenDetail}>
            {row.wrt_number}
          </button>
        );
      case "plot":
        return row.plot ? `PLOT-${row.plot}` : "—";
      case "team":
      case "pic":
      case "eng":
        return (
          <AbdEditCellPopover
            id={row.id}
            field={key}
            label={key.toUpperCase()}
            editorType="text"
            currentValue={(row as any)[key]}
            canEdit={canEdit}
            saveFn={async (p) => onSave(p.field, p.value == null ? null : String(p.value))}
          >
            <span>{(row as any)[key] ?? "—"}</span>
          </AbdEditCellPopover>
        );
      case "judgment":
        return (
          <>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", judgeTone)}>
              {wrtJudgmentLabel(row.judgment)}
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
      case "active_round":
        return `R${row.active_round}`;
      case "current_stage":
        return (
          <span className="text-muted-foreground">
            {row.current_stage ? stageLabel(row.current_stage) : row.active_band ? "—" : "All bands closed"}
          </span>
        );
      case "primary_delay":
        return (
          <>
            {row.primary_delay ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                {stageLabel(row.primary_delay)} · {row.primary_delay.days}d
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {row.delay_bucket.length > 0 && (
              <span className="ml-1 text-[9px] text-muted-foreground" title="Trailing delays — informational, not counted in the delay card">
                +{row.delay_bucket.length}
              </span>
            )}
            {row.response_wait.length > 0 && (
              <span className="ml-1 text-[9px] text-amber-700" title="Awaiting Aconex response — not attributable to HDEC">
                Awaiting response
              </span>
            )}
          </>
        );
      case "latest_status_raw":
        return row.latest_status_raw ?? "—";
      case "is_final_approved":
        return row.is_final_approved ? (
          <span className="rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">A</span>
        ) : (
          "—"
        );
      case "data_date":
        return row.data_date ? formatDdMmm(row.data_date) : "—";
      default:
        return <span className="text-muted-foreground">{(row as any)[key] ?? "—"}</span>;
    }
  };

  return (
    <tr className={cn("hover:bg-muted/30", selected && "bg-primary/5")}>
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
          <td key={it.key} className="whitespace-nowrap border-b border-l px-2 py-1">
            {inner}
          </td>
        );
      })}
      {stageCols.map((sc) => {
        const cell = row.stages[sc.stage_code];
        const isNa = cell?.na;
        const raw = cell?.[sc.field] as string | null | undefined;
        return (
          <td
            key={sc.key}
            className={cn(
              "whitespace-nowrap border-b border-l px-2 py-1 text-center tabular-nums",
              STATE_CLASS[cell?.st ?? "none"],
              isNa && "bg-muted/40",
            )}
            title={isNa ? "NA — excluded from the progress denominator" : sc.title}
          >
            {isNa ? (
              <span className="rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">NA</span>
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
      style={{ left, width, minWidth: width }}
      className="sticky z-20 border-b border-l bg-background px-2 py-1 text-left [background-image:linear-gradient(hsl(var(--muted)),hsl(var(--muted)))]"
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
      style={{ left, width, minWidth: width }}
      className={cn(
        "sticky z-10 whitespace-nowrap border-b border-l px-2 py-1",
        "bg-background [background-image:linear-gradient(hsl(var(--background)),hsl(var(--background)))]",
        className,
      )}
    >
      {children}
    </td>
  );
}

function KpiCard({
  label,
  value,
  note,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  active?: boolean;
  onClick?: () => void;
  tone?: "warn" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-2 text-left transition hover:border-primary/60",
        active && "border-primary ring-1 ring-primary/30",
      )}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "bad" && "text-red-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value.toLocaleString()}
      </div>
      {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
    </button>
  );
}