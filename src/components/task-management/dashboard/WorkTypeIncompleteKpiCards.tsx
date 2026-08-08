import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { RiskKpiCard, type RiskKpiBreakdownRow } from "./RiskKpiCard";
import { EMPTY_TOKEN } from "@/lib/task-management/filters";
import { useTmWorkTypeCounts, type TmWorkTypeTeamEntry } from "@/hooks/useTmWorkTypeCounts";

interface Props {
  asOfDate: string;
  ownerContext?: {
    team?: string[];
    hdec_pic_name?: string[];
    hdec_eng_name?: string[];
    discipline?: string[];
    plot?: string[];
    q?: string;
  };
}

export function WorkTypeIncompleteKpiCards({ asOfDate, ownerContext }: Props) {
  const navigate = useNavigate();
  /** 이 카드의 집계 단위는 Subtask 고정 — 상단 과업 스코프와 무관 */
  const taskScope = "sub" as const;
  const { data, isLoading, isError } = useTmWorkTypeCounts({
    filters: {
      team: ownerContext?.team,
      hdec_pic_name: ownerContext?.hdec_pic_name,
      hdec_eng_name: ownerContext?.hdec_eng_name,
      discipline: ownerContext?.discipline,
      plot: ownerContext?.plot,
      q: ownerContext?.q,
    },
    asOf: asOfDate,
  });

  const total = data?.total ?? 0;

  const goRaw = (workType: string, isNull: boolean, team?: TmWorkTypeTeamEntry) => {
    const s: Record<string, string> = {
      source: "dashboard",
      asOf: asOfDate,
      taskScope,
      rowType: isNull ? EMPTY_TOKEN : workType,
      incompleteOnly: "1",
    };
    if (team) s.team = team.isNull ? EMPTY_TOKEN : team.team;
    else if (ownerContext?.team?.length) s.team = ownerContext.team.join(",");
    if (ownerContext?.hdec_pic_name?.length) s.hdec_pic_name = ownerContext.hdec_pic_name.join(",");
    if (ownerContext?.hdec_eng_name?.length) s.hdec_eng_name = ownerContext.hdec_eng_name.join(",");
    if (ownerContext?.discipline?.length) s.discipline = ownerContext.discipline.join(",");
    if (ownerContext?.plot?.length) s.plot = ownerContext.plot.join(",");
    if (ownerContext?.q && ownerContext.q.trim()) s.q = ownerContext.q.trim();
    navigate({ to: "/closure/task-management/raw-data", search: s as any });
  };

  const rows = (item: {
    work_type: string;
    isNull: boolean;
    by_team: TmWorkTypeTeamEntry[];
  }): RiskKpiBreakdownRow[] => {
    const list = item.by_team ?? [];
    const MAX = 6;
    const top = list.slice(0, MAX);
    const rest = list.slice(MAX);
    const out: RiskKpiBreakdownRow[] = top.map((e) => ({
      label: e.team,
      count: e.count,
      suffix: `(${e.delayed.toLocaleString()})`,
      onClick: () => goRaw(item.work_type, item.isNull, e),
    }));
    if (rest.length) {
      out.push({
        label: `기타 (${rest.length}팀)`,
        count: rest.reduce((a, b) => a + b.count, 0),
        suffix: `(${rest.reduce((a, b) => a + b.delayed, 0).toLocaleString()})`,
        disabled: true,
      });
    }
    return out;
  };

  const items = data?.items ?? [];
  const PRIORITY_ORDER = ["Physical Work", "T&C", "Approval", "Documentation"];
  const sortedItems = [...items].sort((a, b) => {
    const ai = PRIORITY_ORDER.indexOf(a.work_type);
    const bi = PRIORITY_ORDER.indexOf(b.work_type);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Work Type Status (Actual &lt; 100%)</h3>
        <span className="text-[11px] text-muted-foreground">
          Subtask 기준 · 전체 {total.toLocaleString()} items · 괄호 안은 지연(Cum. Diff &lt; 0) 건수 ·
          지연 합계 {(data?.delayed_total ?? 0).toLocaleString()}
        </span>
      </div>
      {isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="h-4 w-4" />
          Work Type 집계를 불러오지 못했습니다.
        </div>
      )}
      {isLoading ? (
        <div className="text-xs text-muted-foreground">불러오는 중…</div>
      ) : (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {sortedItems.map((it) => (
          <RiskKpiCard
              key={it.work_type}
              label={it.work_type}
              count={it.count}
              countSuffix={`(${it.delayed.toLocaleString()})`}
              percent={total ? (it.count / total) * 100 : undefined}
              sub={`${it.count.toLocaleString()} / ${total.toLocaleString()} items · 지연 ${it.delayed.toLocaleString()}`}
              tone={it.delayed > 0 ? "warn" : "neutral"}
              onClick={() => goRaw(it.work_type, it.isNull)}
              breakdown={rows(it)}
              formula={`Actual % < 100% 인 Subtask 중 ${it.work_type}\n괄호 = Cum. Diff < 0 (지연) 건수`}
            />
          ))}
        </div>
      )}
    </div>
  );
}