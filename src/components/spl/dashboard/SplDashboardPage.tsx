import { useMemo } from "react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { getSplRowsAsOf, type SplCatalogEntry } from "@/lib/spl/rows.functions";
import { splJudgmentLabel } from "@/components/spl/raw-data/spl-columns";
import { SplKpiCard } from "./SplKpiCard";

const routeApi = getRouteApi("/_authenticated/closure/spare-part/dashboard");

const BAND_LABEL: Record<string, string> = {
  REQUIRED_DOC: "Required Doc",
  DOCUMENTATION: "Documentation Stage",
  PO: "PO Stage",
};

const JUDGMENTS = ["제외", "완료", "정상", "지연", "미착수", "미분류"] as const;

export function SplDashboardPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const rootNavigate = useNavigate();
  const today = todayInDoha();
  const asOf = search.asOf || today;

  const fetchRows = useServerFn(getSplRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["spl-rows-as-of", asOf],
    queryFn: () => fetchRows({ data: { as_of: asOf } }),
  });

  const rows = data?.rows ?? [];
  const catalog: SplCatalogEntry[] = data?.catalog ?? [];

  const delayBands = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of catalog) if (!s.chain_excluded) m.set(s.band, m.get(s.band) ?? 0);
    for (const r of rows) if (r.primary_delay) m.set(r.primary_delay.band, (m.get(r.primary_delay.band) ?? 0) + 1);
    return [...m.entries()];
  }, [rows, catalog]);

  const reqDoc = useMemo(() => {
    const full = rows.filter((r) => r.req_doc_total > 0 && r.req_doc_done === r.req_doc_total).length;
    const sum = rows.reduce((a, r) => a + r.req_doc_done, 0);
    const denom = rows.reduce((a, r) => a + r.req_doc_total, 0);
    return { full, pct: denom === 0 ? 0 : Math.round((sum * 1000) / denom) / 10 };
  }, [rows]);

  const counts = data?.judgment_counts ?? {};
  const countsSum = JUDGMENTS.reduce((a, j) => a + (counts[j] ?? 0), 0);
  const population = data?.total_count ?? 0;
  const reconOk = countsSum === population;
  const viol = data?.violations;

  /** 카드 = 드릴다운 — Raw Data 로 이동하며 동일 술어를 검색 파라미터로 전달 */
  const drill = (patch: Record<string, unknown>) =>
    (rootNavigate as (opts: unknown) => void)({
      to: "/closure/spare-part/raw-data",
      search: { asOf: search.asOf ?? "", ...patch },
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spare Part List — Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            All figures come from the canonical functions (spl_rows_as_of → spl_eval_as_of → spl_judge_v1) and are
            recomputed on read. Clicking a card opens the matching Raw Data drill-down.
          </p>
        </div>
        <DataDatePicker
          value={search.asOf ?? ""}
          latest={data?.as_of ?? today}
          options={[]}
          onChange={(v) => (navigate as (opts: unknown) => void)({ search: { ...search, asOf: v } })}
          onReset={() => (navigate as (opts: unknown) => void)({ search: { ...search, asOf: "" } })}
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : error ? (
        <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <SplKpiCard
              label="Population (documents)"
              value={population}
              onClick={() => drill({ judgment: "all" })}
              note={reconOk ? "Sum = population ✓" : `Reconciliation mismatch: sum ${countsSum}`}
              tone={reconOk ? undefined : "warn"}
            />
            {JUDGMENTS.map((j) => (
              <SplKpiCard
                key={j}
                label={splJudgmentLabel(j)}
                value={counts[j] ?? 0}
                onClick={() => drill({ judgment: j })}
                note={
                  j === "미분류"
                    ? "No plan and no actual (denominator 0)"
                    : j === "지연"
                      ? "Documents with a primary delay"
                      : j === "미착수"
                        ? "No judgeable stage in the active band"
                        : j === "완료"
                          ? `No HDEC actual: ${data?.hdec_missing_done ?? 0}`
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
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => drill({ delayBand: band })}
              >
                {BAND_LABEL[band] ?? band} {n}
              </Button>
            ))}
            <Badge variant="outline" className="text-[11px]">
              Required documents ready {reqDoc.pct}% · fully ready {reqDoc.full} (not part of the judgment population)
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => drill({ hdecMissing: true })}
            >
              No HDEC actual: {data?.hdec_missing_items ?? 0}
            </Button>
            {viol && (
              <Badge variant={viol.total > 0 ? "destructive" : "outline"} className="gap-1 text-[11px]">
                <AlertTriangle className="h-3 w-3" />
                선후관계 위반 {viol.total}건
              </Badge>
            )}
          </div>
        </>
      )}
    </div>
  );
}