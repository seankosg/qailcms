import { useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

const routeApi = getRouteApi("/_authenticated/closure/warranty/raw-data");

const BAND_LABEL: Record<string, string> = {
  COMMERCIAL: "Commercial Stage",
  DRAFT_APPROVAL: "Draft Approval Stage",
  SUBMISSION: "Submission Stage",
};

const JUDGMENTS = ["완료", "정상", "지연", "미분류", "제외"] as const;

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
  const bands = useMemo(() => {
    const out: Array<{ band: string; span: number }> = [];
    for (const s of catalog) {
      const span = s.value_type === "flag" ? 1 : s.value_type === "single" ? 2 : 4;
      const last = out[out.length - 1];
      if (last && last.band === s.band) last.span += span;
      else out.push({ band: s.band, span });
    }
    return out;
  }, [catalog]);

  const subHeaders = (s: WrtCatalogEntry): Array<{ field: keyof WrtStageCell; label: string }> =>
    s.value_type === "flag"
      ? [{ field: "fv", label: "Value" }]
      : s.value_type === "single"
        ? [
            { field: "ps", label: "Plan" },
            { field: "as", label: s.actual_authority === "ACONEX" ? "Actual (Aconex)" : "Actual" },
          ]
        : [
            { field: "ps", label: "P.Start" },
            { field: "as", label: "A.Start" },
            { field: "pf", label: "P.Finish" },
            { field: "af", label: "A.Finish" },
          ];

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return rows.filter((r) => {
      if (search.plot && search.plot !== "all" && (r.plot ?? "") !== search.plot) return false;
      if (search.round && search.round !== "all" && String(r.active_round) !== search.round) return false;
      // 카드 = 드릴다운: 정본이 내려준 judgment 필드를 그대로 술어로 사용
      if (search.judgment && search.judgment !== "all" && r.judgment !== search.judgment) return false;
      if (!q) return true;
      return [r.wrt_number, r.title, r.team, r.pic, r.eng, r.dis, r.service]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search.q, search.plot, search.judgment, search.round]);

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
      toast.success(`Export 완료 — ${name} (왕복 임포트 양식)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export 실패");
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
            표시·집계 수치는 정본 함수(wrt_rows_as_of → wrt_judge_v1) 경유. 완료 판정은 Final Approved(A) 기준입니다.
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
          <Button size="sm" variant="outline" onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Export (왕복 양식)
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
            {p === "all" ? "전체 Plot" : `PLOT-${p}`}
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
            {r === "all" ? "전체 Round" : `R${r}`}
          </Button>
        ))}
        {viol && (
          <>
            <Badge variant={viol.total > 0 ? "destructive" : "outline"} className="gap-1 text-[11px]">
              <AlertTriangle className="h-3 w-3" />
              위반 {viol.total}건 (선후관계 {viol.precedence} · 라운드 귀속 {viol.ghost_round} · 회신선행{" "}
              {viol.response_before_submission ?? 0})
              {viol.from_last_import > 0 && (
                <span className="opacity-80">· 최근 임포트 발생 {viol.from_last_import}건</span>
              )}
            </Badge>
            <Badge
              variant="outline"
              className="text-[11px]"
              title="HDEC 제출 실적이 전 라운드에 걸쳐 없는 상태에서 Aconex 회신만 존재 — 임포트 대기이며 위반 아님"
            >
              제출 대기(pending) {viol.pending_hdec ?? 0}건 · R1 {viol.pending_hdec_r1 ?? 0} / R2{" "}
              {viol.pending_hdec_r2 ?? 0}
            </Badge>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <KpiCard
          label="모집단 (문서)"
          value={population}
          active={(search.judgment ?? "all") === "all"}
          onClick={() => setSearch({ judgment: "all" })}
          note={reconOk ? "합계=모집단 ✓" : `검산 불일치: 합계 ${countsSum}`}
          tone={reconOk ? undefined : "warn"}
        />
        {JUDGMENTS.map((j) => (
          <KpiCard
            key={j}
            label={j}
            value={counts[j] ?? 0}
            active={search.judgment === j}
            onClick={() => setSearch({ judgment: search.judgment === j ? "all" : j })}
            note={
              j === "완료"
                ? "Final Approved (A)"
                : j === "미분류"
                  ? "계획·실적 없음 (분모 0)"
                  : j === "제외"
                    ? "Cancelled — 통계 제외"
                    : undefined
            }
            tone={j === "지연" ? "bad" : j === "미분류" ? "warn" : undefined}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
          ) : (
            <div className="max-h-[calc(100vh-320px)] overflow-auto">
              <table className="w-max border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr>
                    <StickyHead rowSpan={3} left={0} width={250}>
                      WRT NUMBER
                    </StickyHead>
                    <StickyHead rowSpan={3} left={250} width={70}>
                      Plot
                    </StickyHead>
                    <StickyHead rowSpan={3} left={320} width={80}>
                      Team
                    </StickyHead>
                    <StickyHead rowSpan={3} left={400} width={90}>
                      판정
                    </StickyHead>
                    <StickyHead rowSpan={3} left={490} width={80}>
                      진척률
                    </StickyHead>
                    <th className="border-b border-l bg-muted px-2 py-1 text-left" rowSpan={3}>
                      Round
                    </th>
                    <th className="border-b border-l bg-muted px-2 py-1 text-left" rowSpan={3}>
                      Latest Status
                    </th>
                    <th className="border-b border-l bg-muted px-2 py-1 text-left" rowSpan={3}>
                      Final Approved
                    </th>
                    {bands.map((b, i) => (
                      <th
                        key={`${b.band}-${i}`}
                        colSpan={b.span}
                        className="border-b border-l bg-muted/80 px-2 py-1 text-center font-semibold"
                      >
                        {BAND_LABEL[b.band] ?? b.band}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {catalog.map((s) => (
                      <th
                        key={s.stage_code}
                        colSpan={subHeaders(s).length}
                        className="whitespace-nowrap border-b border-l bg-muted/60 px-2 py-1 text-center"
                        title={`${s.stage_code} · ${s.value_type} · 실적 정본 ${s.actual_authority}`}
                      >
                        {s.label}
                        {s.actual_authority === "ACONEX" && (
                          <span className="ml-1 rounded bg-emerald-100 px-1 text-[9px] text-emerald-800">Aconex</span>
                        )}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {catalog.flatMap((s) =>
                      subHeaders(s).map((h) => (
                        <th
                          key={`${s.stage_code}-${h.field}`}
                          className="whitespace-nowrap border-b border-l bg-muted/40 px-2 py-1 text-center font-normal text-muted-foreground"
                        >
                          {h.label}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <WrtTableRow key={r.id} row={r} catalog={catalog} subHeaders={subHeaders} />
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8 + catalog.length * 2} className="p-8 text-center text-muted-foreground">
                        조건에 맞는 행이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-[11px] text-muted-foreground">
        표시 {filtered.length.toLocaleString()}행 / 모집단 {population.toLocaleString()}행 · As of {asOf} · NA 단계는{" "}
        <span className="rounded bg-muted px-1">NA</span> 로 표기하며 진척률 분모에서 제외됩니다(빈칸과 구분).
      </div>
    </div>
  );
}

function WrtTableRow({
  row,
  catalog,
  subHeaders,
}: {
  row: WrtRow;
  catalog: WrtCatalogEntry[];
  subHeaders: (s: WrtCatalogEntry) => Array<{ field: keyof WrtStageCell; label: string }>;
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
            : "bg-slate-100 text-slate-800";
  return (
    <tr className="hover:bg-muted/30">
      <StickyCell left={0} width={250} className="font-mono">
        {row.wrt_number}
      </StickyCell>
      <StickyCell left={250} width={70}>
        {row.plot ? `PLOT-${row.plot}` : "—"}
      </StickyCell>
      <StickyCell left={320} width={80}>
        {row.team ?? "—"}
      </StickyCell>
      <StickyCell left={400} width={90}>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", judgeTone)}>{row.judgment}</span>
      </StickyCell>
      <StickyCell left={490} width={80} className="tabular-nums">
        {row.progress_pct == null ? "—" : `${row.progress_pct}%`}
        <span className="ml-1 text-[9px] text-muted-foreground">
          {row.done}/{row.denom}
        </span>
      </StickyCell>
      <td className="whitespace-nowrap border-b border-l px-2 py-1 text-center">R{row.active_round}</td>
      <td className="whitespace-nowrap border-b border-l px-2 py-1 text-center">{row.latest_status_raw ?? "—"}</td>
      <td className="whitespace-nowrap border-b border-l px-2 py-1 text-center">
        {row.is_final_approved ? (
          <span className="rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">A</span>
        ) : (
          "—"
        )}
      </td>
      {catalog.flatMap((s) => {
        const cell = row.stages[s.stage_code];
        return subHeaders(s).map((h) => {
          const isNa = cell?.na;
          const raw = cell?.[h.field] as string | null | undefined;
          return (
            <td
              key={`${s.stage_code}-${h.field}`}
              className={cn(
                "whitespace-nowrap border-b border-l px-2 py-1 text-center tabular-nums",
                STATE_CLASS[cell?.st ?? "none"],
                isNa && "bg-muted/40",
              )}
              title={isNa ? "NA — 진척률 분모에서 제외" : undefined}
            >
              {isNa ? (
                <span className="rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">NA</span>
              ) : raw ? (
                h.field === "fv" ? raw : formatDdMmm(raw)
              ) : (
                ""
              )}
            </td>
          );
        });
      })}
    </tr>
  );
}

/** 고정(스티키) 헤더 — 배경 100% 불투명 유지 */
function StickyHead({
  children,
  left,
  width,
  rowSpan,
}: {
  children: React.ReactNode;
  left: number;
  width: number;
  rowSpan?: number;
}) {
  return (
    <th
      rowSpan={rowSpan}
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