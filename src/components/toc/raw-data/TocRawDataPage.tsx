import { useMemo } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { DataDatePicker } from "@/components/task-management/shared/DataDatePicker";
import { todayInDoha } from "@/lib/time/doha";
import { cn } from "@/lib/utils";
import {
  getTocRowsAsOf,
  type TocBand,
  type TocBandState,
  type TocCatalogEntry,
  type TocRow,
} from "@/lib/toc/rows.functions";

const routeApi = getRouteApi("/_authenticated/closure/toc/raw-data");

const BANDS: Array<{ band: TocBand; label: string }> = [
  { band: "TAC", label: "T&C" },
  { band: "OMM", label: "O&M Manual" },
  { band: "TRAINING", label: "Training" },
  { band: "ASSET_TAG", label: "Asset Tag" },
  { band: "ABD", label: "As-Built" },
  { band: "SERVICE_REPORT", label: "Service Report" },
  { band: "TOC", label: "TOC / Handover" },
];

const BAND_STATE_STYLE: Record<TocBandState, string> = {
  complete: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  active: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  planned: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  blocked: "bg-destructive/20 text-destructive",
  na: "bg-muted text-muted-foreground",
  empty: "bg-transparent text-muted-foreground",
};

const BAND_STATE_LABEL: Record<TocBandState, string> = {
  complete: "Complete",
  active: "In Progress",
  planned: "Planned",
  blocked: "Blocked",
  na: "N/A",
  empty: "—",
};

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

const JUDGMENT_STYLE: Record<string, string> = {
  "Handed Over": "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  "TOC Under Review": "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  "TOC Ready": "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  Delayed: "bg-destructive/20 text-destructive",
  Blocked: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "In Progress": "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "Not Started": "bg-muted text-muted-foreground",
  Excluded: "bg-muted text-muted-foreground line-through",
};

/** 밴드 셀 tooltip — 단계별 상태·계획·실적을 원본 값 그대로 나열 */
function bandTooltip(row: TocRow, band: TocBand, catalog: TocCatalogEntry[]) {
  return catalog
    .filter((c) => c.band === band)
    .map((c) => {
      const s = row.stages[c.stage_code];
      if (!s) return `${c.label}: —`;
      const parts = [s.st];
      if (s.cv) parts.push(`code=${s.cv}`);
      if (s.pf) parts.push(`plan=${s.pf}`);
      if (s.af) parts.push(`actual=${s.af}`);
      return `${c.label}: ${parts.join(" · ")}`;
    })
    .join("\n");
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} className="h-7 text-[11px]" onClick={onClick}>
      {children}
    </Button>
  );
}

export function TocRawDataPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const today = todayInDoha();

  const fetchRows = useServerFn(getTocRowsAsOf);
  const { data, isLoading, error } = useQuery({
    queryKey: ["toc-rows-as-of", search.asOf || ""],
    queryFn: () => fetchRows({ data: { as_of: search.asOf || null } }),
  });

  const rows = data?.rows ?? [];
  const catalog = data?.catalog ?? [];

  const team = search.team ?? "all";
  const system = search.system ?? "all";
  const judgment = search.judgment ?? "all";
  const q = (search.q ?? "").trim().toLowerCase();

  const setSearch = (patch: Record<string, unknown>) =>
    (navigate as (opts: unknown) => void)({ search: { ...search, ...patch }, replace: true });

  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const systems = useMemo(
    () => [...new Set(rows.map((r) => r.main_system).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (team !== "all" && (r.team ?? "") !== team) return false;
        if (system !== "all" && (r.main_system ?? "") !== system) return false;
        if (judgment !== "all" && r.judgment !== judgment) return false;
        if (q) {
          const hay = [r.item_no, r.sub_system, r.location, r.toc_ref, r.supplier]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [rows, team, system, judgment, q],
  );

  /** 판정 카드 — 합계 = 모집단 검산을 화면에 그대로 노출 */
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(r.judgment, (m.get(r.judgment) ?? 0) + 1);
    return m;
  }, [filtered]);
  const countedSum = [...counts.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Handover (TOC) — Raw Data</h1>
          <p className="text-xs text-muted-foreground">
            Every figure is recomputed on read by the canonical functions (toc_rows_as_of → toc_eval_as_of). The
            six readiness bands progress independently; Training is rolled up from linked sessions.
          </p>
        </div>
        <DataDatePicker
          value={search.asOf ?? ""}
          latest={data?.as_of ?? today}
          options={[]}
          onChange={(v) => setSearch({ asOf: v })}
          onReset={() => setSearch({ asOf: "" })}
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {JUDGMENTS.map((j) => (
              <button
                key={j}
                type="button"
                onClick={() => setSearch({ judgment: judgment === j ? "all" : j })}
                className={cn(
                  "rounded-lg border p-2 text-left transition-colors hover:border-primary",
                  judgment === j && "border-primary",
                )}
              >
                <div className="text-[11px] text-muted-foreground">{j}</div>
                <div className="text-xl font-semibold tabular-nums">{counts.get(j) ?? 0}</div>
              </button>
            ))}
          </div>

          <div className="space-y-1.5 rounded-lg border p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] text-[11px] text-muted-foreground">Team</span>
              {["all", ...teams].map((t) => (
                <TabButton key={t} active={team === t} onClick={() => setSearch({ team: t })}>
                  {t === "all" ? "All Teams" : t}
                </TabButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[52px] text-[11px] text-muted-foreground">System</span>
              {["all", ...systems].map((s) => (
                <TabButton key={s} active={system === s} onClick={() => setSearch({ system: s })}>
                  {s === "all" ? "All Systems" : s}
                </TabButton>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                value={search.q ?? ""}
                onChange={(e) => setSearch({ q: e.target.value })}
                placeholder="Search item no, equipment, location, TOC ref…"
                className="h-7 max-w-xs text-[11px]"
              />
              <span className="text-[11px] text-muted-foreground">
                {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} items · card total{" "}
                {countedSum.toLocaleString()}
                {countedSum !== filtered.length ? " · MISMATCH" : ""} · as-of {data?.as_of ?? today}
              </span>
            </div>
          </div>

          <div className="overflow-auto rounded-lg border">
            <table className="w-full min-w-[1200px] border-collapse text-[11px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-background">
                  <th className="sticky left-0 z-20 border-b border-r bg-background px-2 py-1.5 text-left">Item No</th>
                  <th className="border-b px-2 py-1.5 text-left">Sub System</th>
                  <th className="border-b px-2 py-1.5 text-left">Main System</th>
                  <th className="border-b px-2 py-1.5 text-left">Location</th>
                  <th className="border-b px-2 py-1.5 text-left">Team</th>
                  {BANDS.map((b) => (
                    <th key={b.band} className="border-b border-l px-2 py-1.5 text-center">
                      {b.label}
                    </th>
                  ))}
                  <th className="border-b border-l px-2 py-1.5 text-right">Ready</th>
                  <th className="border-b px-2 py-1.5 text-left">TOC Ref</th>
                  <th className="border-b px-2 py-1.5 text-left">TOC Status</th>
                  <th className="border-b px-2 py-1.5 text-left">Exp. H/O</th>
                  <th className="border-b px-2 py-1.5 text-left">Judgment</th>
                  <th className="border-b px-2 py-1.5 text-left">Top Delay</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="sticky left-0 z-10 border-b border-r bg-background px-2 py-1 font-medium">
                      {r.item_no ?? r.item_key}
                    </td>
                    <td className="border-b px-2 py-1">{r.sub_system ?? "—"}</td>
                    <td className="border-b px-2 py-1">{r.main_system ?? "—"}</td>
                    <td className="border-b px-2 py-1">{r.location ?? "—"}</td>
                    <td className="border-b px-2 py-1">{r.team_raw ?? r.team ?? "—"}</td>
                    {BANDS.map((b) => {
                      const st = (r.band_states[b.band] ?? "empty") as TocBandState;
                      return (
                        <td key={b.band} className="border-b border-l px-1 py-1 text-center">
                          <span
                            title={bandTooltip(r, b.band, catalog)}
                            className={cn("inline-block w-full rounded px-1 py-0.5", BAND_STATE_STYLE[st])}
                          >
                            {BAND_STATE_LABEL[st]}
                            {b.band === "TRAINING" && r.training_sessions > 0
                              ? ` (${r.training_sessions})`
                              : ""}
                          </span>
                        </td>
                      );
                    })}
                    <td className="border-b border-l px-2 py-1 text-right tabular-nums">
                      {r.readiness_pct == null ? "—" : `${r.readiness_pct}%`}
                      <span className="ml-1 text-muted-foreground">
                        ({r.ready_bands}/{r.ready_denom})
                      </span>
                    </td>
                    <td className="border-b px-2 py-1">{r.toc_ref ?? "—"}</td>
                    <td className="border-b px-2 py-1">{r.toc_status}</td>
                    <td className="border-b px-2 py-1">{r.expected_ho_date ?? "—"}</td>
                    <td className="border-b px-2 py-1">
                      <span className={cn("rounded px-1.5 py-0.5", JUDGMENT_STYLE[r.judgment])}>{r.judgment}</span>
                    </td>
                    <td className="border-b px-2 py-1">
                      {r.primary_delay ? `${r.primary_delay.label} (+${r.primary_delay.days}d)` : "—"}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={18} className="px-2 py-6 text-center text-muted-foreground">
                      No items match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
