import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getAbdDashboardRow1,
  getAbdDashboardRow2,
  pivotRows,
} from "@/lib/abd/dashboard.functions";

type Tone = "neutral" | "ok" | "info" | "warn" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "text-foreground",
  ok: "text-emerald-600 dark:text-emerald-400",
  info: "text-blue-600 dark:text-blue-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

interface KpiCardProps {
  label: string;
  count: number;
  total?: number;
  tone?: Tone;
  breakdown?: Array<{ team: string; count: number; onClick?: () => void }>;
  onClick?: () => void;
}

export function AbdKpiCard({ label, count, total, tone = "neutral", breakdown, onClick }: KpiCardProps) {
  const pct = total && total > 0 ? Math.round((count / total) * 100) : null;
  return (
    <Card
      onClick={onClick}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-primary/10")}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className={cn("text-3xl font-bold tabular-nums leading-tight", TONE[tone])}>
              {count.toLocaleString()}
            </div>
            {pct != null && (
              <div className="text-[11px] text-muted-foreground tabular-nums">{pct}% of total</div>
            )}
          </div>
          {breakdown && breakdown.length > 0 && (
            <div
              className="flex max-h-28 min-w-[92px] flex-col gap-0.5 overflow-y-auto border-l pl-2"
              onClick={(e) => e.stopPropagation()}
            >
              {breakdown.map((b, i) => (
                <button
                  key={`${b.team}-${i}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    b.onClick?.();
                  }}
                  className={cn(
                    "flex h-5 items-center justify-between gap-2 rounded px-1 text-[11px] tabular-nums",
                    b.onClick && "hover:bg-primary/10 cursor-pointer",
                  )}
                >
                  <span className="truncate">{b.team || "—"}</span>
                  <span className={cn("font-medium", TONE[tone])}>{b.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  plots?: string[];
  teams?: string[];
  batchNo?: string[];
  onOpenRaw: (params: Record<string, string>) => void;
}

/** Row 1: 배타적 5분류 (Total, Approved, UR, DS, NS) */
export function AbdRow1Kpis({ plots = [], teams = [], batchNo = [], onOpenRaw }: Props) {
  const fn = useServerFn(getAbdDashboardRow1);
  const { data } = useQuery({
    queryKey: ["abd-dash-row1", plots.join(","), teams.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { plots, teams, batch_no: batchNo } }),
    staleTime: 30_000,
  });
  const { totals, byTeam } = useMemo(() => pivotRows(data ?? []), [data]);
  const total = totals.get("TOTAL") ?? 0;

  const mk = (label: string, key: string, tone: Tone, statusGroup?: string) => (
    <AbdKpiCard
      key={key}
      label={label}
      count={totals.get(key) ?? 0}
      total={key === "TOTAL" ? undefined : total}
      tone={tone}
      breakdown={(byTeam.get(key) ?? []).map((b) => ({
        team: b.team,
        count: b.count,
        onClick: () =>
          onOpenRaw({
            ...(statusGroup ? { status_group: statusGroup } : {}),
            team: b.team,
          }),
      }))}
      onClick={() => onOpenRaw(statusGroup ? { status_group: statusGroup } : {})}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {mk("Total", "TOTAL", "neutral")}
      {mk("Approved", "Approved", "ok", "approved")}
      {mk("UR (Under Review)", "UR", "info", "under_review")}
      {mk("DS (Drafting)", "DS", "warn", "drafting")}
      {mk("NS (Not Started)", "NS", "danger", "not_started")}
    </div>
  );
}

/** Row 2: 지연 카드 (RS/SB/DS 지연 · No Plan) */
export function AbdRow2Kpis({ plots = [], teams = [], batchNo = [], onOpenRaw }: Props) {
  const fn = useServerFn(getAbdDashboardRow2);
  const { data } = useQuery({
    queryKey: ["abd-dash-row2", plots.join(","), teams.join(","), batchNo.join(",")],
    queryFn: () => fn({ data: { plots, teams, batch_no: batchNo } }),
    staleTime: 30_000,
  });
  const { totals, byTeam } = useMemo(() => pivotRows(data ?? []), [data]);

  const totalDelay =
    (totals.get("RS_DELAY") ?? 0) +
    (totals.get("SB_DELAY") ?? 0) +
    (totals.get("DS_DELAY") ?? 0) +
    (totals.get("NO_PLAN") ?? 0);

  const mk = (label: string, key: string, statusGroup: string) => (
    <AbdKpiCard
      key={key}
      label={label}
      count={totals.get(key) ?? 0}
      tone="danger"
      breakdown={(byTeam.get(key) ?? []).map((b) => ({
        team: b.team,
        count: b.count,
        onClick: () => onOpenRaw({ status_group: statusGroup, team: b.team }),
      }))}
      onClick={() => onOpenRaw({ status_group: statusGroup })}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <AbdKpiCard
        label="Total Delay"
        count={totalDelay}
        tone="danger"
        onClick={() => onOpenRaw({ status_group: "delayed" })}
      />
      {mk("RS Delay", "RS_DELAY", "rs_delay")}
      {mk("SB Delay", "SB_DELAY", "sb_delay")}
      {mk("DS Delay", "DS_DELAY", "ds_delay")}
      {mk("No Plan", "NO_PLAN", "no_plan")}
    </div>
  );
}