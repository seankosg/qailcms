import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  TOC_BANDS,
  TOC_BAND_STATE_COLOR,
  TOC_BAND_STATE_LABEL,
  TOC_JUDGMENT_COLOR,
} from "@/lib/toc/columns";
import type { TocCatalogEntry, TocRow } from "@/lib/toc/rows.functions";

const JUDGMENTS = [
  "Handed Over",
  "TOC Under Review",
  "TOC Ready",
  "Delayed",
  "Blocked",
  "In Progress",
  "Not Started",
  "Excluded",
] as const;

const BAND_STATES = ["complete", "active", "planned", "blocked", "na", "empty"] as const;

/**
 * TOC 대시보드 분포 카드.
 * 모든 수치는 정본(`toc_rows_as_of`)이 내려준 judgment / band_states / readiness 만 세며,
 * 화면에서 판정을 재계산하지 않는다. 각 버킷 합계 = 모집단(대상 행 수) 을 카드에 표기해 검산한다.
 */
export function TocBreakdownCards({
  rows,
  catalog,
  onDrill,
}: {
  rows: TocRow[];
  catalog: TocCatalogEntry[];
  onDrill: (patch: Record<string, unknown>) => void;
}) {
  const judgment = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of JUDGMENTS) m.set(j, 0);
    let unclassified = 0;
    for (const r of rows) {
      if (m.has(r.judgment)) m.set(r.judgment, (m.get(r.judgment) ?? 0) + 1);
      else unclassified += 1;
    }
    return { m, unclassified };
  }, [rows]);

  const bandMatrix = useMemo(
    () =>
      TOC_BANDS.map((b) => {
        const counts: Record<string, number> = {};
        for (const s of BAND_STATES) counts[s] = 0;
        let unclassified = 0;
        for (const r of rows) {
          const st = r.band_states?.[b.band] ?? "empty";
          if (st in counts) counts[st] += 1;
          else unclassified += 1;
        }
        return { ...b, counts, unclassified };
      }),
    [rows],
  );

  const readiness = useMemo(() => {
    const buckets = [
      { key: "100", label: "100%", test: (p: number) => p >= 100 },
      { key: "75", label: "75–99%", test: (p: number) => p >= 75 && p < 100 },
      { key: "50", label: "50–74%", test: (p: number) => p >= 50 && p < 75 },
      { key: "25", label: "25–49%", test: (p: number) => p >= 25 && p < 50 },
      { key: "0", label: "0–24%", test: (p: number) => p < 25 },
    ];
    const counts = buckets.map((b) => ({ ...b, n: 0 }));
    let unclassified = 0;
    for (const r of rows) {
      const p = r.readiness_pct;
      if (p == null) {
        unclassified += 1;
        continue;
      }
      const hit = counts.find((b) => b.test(p));
      if (hit) hit.n += 1;
      else unclassified += 1;
    }
    return { counts, unclassified };
  }, [rows]);

  const delayed = rows.filter((r) => r.delayed > 0).length;
  const handedOver = judgment.m.get("Handed Over") ?? 0;
  const tcDone = rows.filter((r) => (r.band_states?.TAC ?? "") === "complete").length;
  const stageCount = catalog.length;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Judgment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {JUDGMENTS.map((j) => {
            const n = judgment.m.get(j) ?? 0;
            return (
              <button
                key={j}
                type="button"
                onClick={() => onDrill({ filters: JSON.stringify({ judgment: [j] }), tab: "all" })}
                className="flex w-full items-center justify-between rounded border px-2 py-1 text-left text-xs transition hover:border-primary/60"
              >
                <span className={cn("rounded px-1.5 py-0.5", TOC_JUDGMENT_COLOR[j])}>{j}</span>
                <span className="tabular-nums font-semibold">{n.toLocaleString()}</span>
              </button>
            );
          })}
          <IdentityLine total={rows.length} unclassified={judgment.unclassified} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Band readiness ({TOC_BANDS.length} bands / {stageCount} stages)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="grid grid-cols-[64px_repeat(6,1fr)] gap-1 text-[10px] text-muted-foreground">
            <span />
            {BAND_STATES.map((s) => (
              <span key={s} className="text-center">
                {TOC_BAND_STATE_LABEL[s]}
              </span>
            ))}
          </div>
          {bandMatrix.map((b) => (
            <div key={b.band} className="grid grid-cols-[64px_repeat(6,1fr)] items-center gap-1">
              <span className="truncate text-[11px] font-medium" title={b.label}>
                {b.short}
              </span>
              {BAND_STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    onDrill({ filters: JSON.stringify({ [`band_${b.band}`]: [s] }), tab: "all" })
                  }
                  className={cn(
                    "rounded border py-0.5 text-center text-[11px] tabular-nums transition hover:border-primary/60",
                    TOC_BAND_STATE_COLOR[s],
                  )}
                  title={`${b.label} · ${TOC_BAND_STATE_LABEL[s]} ${b.counts[s]}`}
                >
                  {b.counts[s]}
                </button>
              ))}
            </div>
          ))}
          <IdentityLine
            total={rows.length}
            unclassified={bandMatrix.reduce((a, b) => a + b.unclassified, 0)}
            note="밴드별 6개 상태 합계 = 모집단"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Readiness / Attention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {readiness.counts.map((b) => (
            <div key={b.key} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
              <span className="text-muted-foreground">Readiness {b.label}</span>
              <span className="tabular-nums font-semibold">{b.n.toLocaleString()}</span>
            </div>
          ))}
          <div className="grid grid-cols-3 gap-1 pt-1">
            <Mini label="Delayed" value={delayed} tone="bad" onClick={() => onDrill({ filters: JSON.stringify({ judgment: ["Delayed"] }), tab: "all" })} />
            <Mini label="T&C 완료" value={tcDone} tone="good" onClick={() => onDrill({ filters: JSON.stringify({ band_TAC: ["complete"] }), tab: "all" })} />
            <Mini label="Handed Over" value={handedOver} tone="good" onClick={() => onDrill({ tab: "handed_over" })} />
          </div>
          <IdentityLine total={rows.length} unclassified={readiness.unclassified} note="Readiness 구간 합계 = 모집단" />
        </CardContent>
      </Card>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "good" | "bad";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border p-1.5 text-left transition hover:border-primary/60"
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums", tone === "bad" ? "text-destructive" : "text-emerald-600")}>
        {value.toLocaleString()}
      </div>
    </button>
  );
}

/** 합계 = 모집단 검산 표시 — 미분류가 생기면 즉시 눈에 보이게 한다. */
function IdentityLine({ total, unclassified, note }: { total: number; unclassified: number; note?: string }) {
  return (
    <div className="mt-1 border-t pt-1 text-[10px] text-muted-foreground">
      {note ? `${note} · ` : ""}모집단 {total.toLocaleString()} · 미분류{" "}
      <b className={unclassified !== 0 ? "text-destructive" : ""}>{unclassified}</b>
    </div>
  );
}
