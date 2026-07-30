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

const TEAM_ORDER = ["MECH", "ELEC"];
function sortByTeamOrder<T extends { team: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ia = TEAM_ORDER.indexOf(a.team);
    const ib = TEAM_ORDER.indexOf(b.team);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.team.localeCompare(b.team);
  });
}

interface KpiCardProps {
  label: string;
  count: number;
  total?: number;
  tone?: Tone;
  breakdown?: Array<{ team: string; count: number; onClick?: () => void }>;
  onClick?: () => void;
  stackBar?: Array<{ key: string; label: string; count: number; colorClass: string }>;
}

export function AbdKpiCard({ label, count, total, tone = "neutral", breakdown, onClick, stackBar }: KpiCardProps) {
  const pct = total && total > 0 ? Math.round((count / total) * 100) : null;
  const stackTotal = stackBar ? stackBar.reduce((s, x) => s + (x.count || 0), 0) : 0;
  return (
    <Card
      onClick={onClick}
      className={cn(onClick && "cursor-pointer transition-colors hover:bg-primary/10")}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
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
        {stackBar && stackTotal > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex h-1.5 w-full overflow-hidden rounded bg-muted">
              {stackBar.map((s) => {
                const w = (s.count / stackTotal) * 100;
                if (w <= 0) return null;
                const p = Math.round(w);
                return (
                  <div
                    key={s.key}
                    className={s.colorClass}
                    style={{ width: `${w}%` }}
                    title={`${s.label}: ${s.count.toLocaleString()} (${p}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
              {stackBar.map((s) => {
                const p = stackTotal > 0 ? Math.round((s.count / stackTotal) * 100) : 0;
                return (
                  <span key={s.key} className="inline-flex items-center gap-1">
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-sm", s.colorClass)} />
                    {s.label} {p}%
                  </span>
                );
              })}
            </div>
          </div>
        )}
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

  // TOTAL 팀별 breakdown: RPC가 TOTAL bucket에서 팀별 행을 주지 않으므로
  // 4개 스테이지 팀별 카운트를 합산해 fallback으로 구성.
  const totalByTeam = useMemo(() => {
    const agg = new Map<string, number>();
    for (const key of ["Approved", "UR", "DS", "NS"]) {
      for (const b of byTeam.get(key) ?? []) {
        agg.set(b.team, (agg.get(b.team) ?? 0) + b.count);
      }
    }
    return sortByTeamOrder(
      Array.from(agg.entries()).map(([team, count]) => ({ team, count })),
    );
  }, [byTeam]);

  const mk = (label: string, key: string, tone: Tone, statusGroup?: string) => (
    <AbdKpiCard
      key={key}
      label={label}
      count={totals.get(key) ?? 0}
      total={key === "TOTAL" ? undefined : total}
      tone={tone}
      breakdown={sortByTeamOrder(byTeam.get(key) ?? []).map((b) => ({
        team: b.team,
        count: b.count,
        onClick: () =>
          onOpenRaw({
            ...(statusGroup ? { status: statusGroup } : {}),
            team: b.team,
          }),
      }))}
      onClick={() => onOpenRaw(statusGroup ? { status: statusGroup } : {})}
    />
  );

  const totalStackBar = [
    { key: "Approved", label: "Approved", count: totals.get("Approved") ?? 0, colorClass: "bg-emerald-500" },
    { key: "UR", label: "UR", count: totals.get("UR") ?? 0, colorClass: "bg-blue-500" },
    { key: "DS", label: "DS", count: totals.get("DS") ?? 0, colorClass: "bg-amber-500" },
    { key: "NS", label: "NS", count: totals.get("NS") ?? 0, colorClass: "bg-red-500" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <AbdKpiCard
        key="TOTAL"
        label="Total"
        count={total}
        tone="neutral"
        breakdown={totalByTeam.map((b) => ({
          team: b.team,
          count: b.count,
          onClick: () => onOpenRaw({ team: b.team }),
        }))}
        stackBar={totalStackBar}
        onClick={() => onOpenRaw({})}
      />
      {mk("Approved", "Approved", "ok", "approved")}
      {/* 'UR' 은 내부 bucket_top 키(의미 = 회신 대기(RS)). 화면 라벨만 정정. */}
      {mk("Awaiting Response", "UR", "info", "under_review")}
      {mk("Draft Start", "DS", "warn", "drafting")}
      {mk("Not Started", "NS", "danger", "not_started")}
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

  // 지연 단일 귀속 원칙(2026-07-29): 카드는 primary_delay 정본 기준이므로 중복 없음.
  // ΣDS+DF+SB+RS = 지연 도면 총수. NoPlan 은 지연이 아닌 계획 부재 알람으로 별도 합산.
  const totalDelay =
    (totals.get("RS_DELAY") ?? 0) +
    (totals.get("SB_DELAY") ?? 0) +
    (totals.get("DF_DELAY") ?? 0) +
    (totals.get("DS_DELAY") ?? 0) +
    (totals.get("NO_PLAN") ?? 0);

  const totalDelayByTeam = useMemo(() => {
    const acc = new Map<string, number>();
    for (const k of ["RS_DELAY", "SB_DELAY", "DF_DELAY", "DS_DELAY", "NO_PLAN"]) {
      for (const b of byTeam.get(k) ?? []) {
        acc.set(b.team, (acc.get(b.team) ?? 0) + b.count);
      }
    }
    return sortByTeamOrder(
      Array.from(acc, ([team, count]) => ({ team, count })),
    );
  }, [byTeam]);

  const mk = (label: string, key: string, statusGroup: string) => (
    <AbdKpiCard
      key={key}
      label={label}
      count={totals.get(key) ?? 0}
      tone="danger"
      breakdown={sortByTeamOrder(byTeam.get(key) ?? []).map((b) => ({
        team: b.team,
        count: b.count,
        onClick: () => onOpenRaw({ status: statusGroup, team: b.team }),
      }))}
      onClick={() => onOpenRaw({ status: statusGroup })}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <AbdKpiCard
        label="Total Delay"
        count={totalDelay}
        tone="danger"
        breakdown={totalDelayByTeam.map((b) => ({
          team: b.team,
          count: b.count,
          onClick: () => onOpenRaw({ status: "delayed", team: b.team }),
        }))}
        onClick={() => onOpenRaw({ status: "delayed" })}
      />
      {mk("Response Delay", "RS_DELAY", "rs_delay")}
      {mk("Submission Delay", "SB_DELAY", "sb_delay")}
      {mk("Draft Finish Delay", "DF_DELAY", "df_delay")}
      {mk("Draft Start Delay", "DS_DELAY", "ds_delay")}
      {mk("No Plan", "NO_PLAN", "no_plan")}
    </div>
  );
}