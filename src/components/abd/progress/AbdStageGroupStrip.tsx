import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getAbdStageGroupCounts } from "@/lib/abd/dashboard.functions";

/** 생애주기 순 7카드 — stage_group 정본 축 */
const GROUPS: Array<{ code: string; label: string }> = [
  { code: "NS", label: "Not Started" },
  { code: "DS", label: "Draft Start" },
  { code: "DF", label: "Draft Finish" },
  { code: "SB", label: "Submission" },
  { code: "RS", label: "Response" },
  { code: "RESUBMIT", label: "Resubmit" },
  { code: "APPROVED", label: "Approved" },
];

const TEAM_ORDER = ["MECH", "ELEC"];

interface Props {
  plots: string[];
  teams: string[];
  /** 드릴다운: status(=sg_/sgd_ 코드) + 선택적 team */
  onOpenRaw: (params: { status: string; team?: string }) => void;
}

export function AbdStageGroupStrip({ plots, teams, onOpenRaw }: Props) {
  const fn = useServerFn(getAbdStageGroupCounts);
  const { data } = useQuery({
    queryKey: ["abd-stage-group-counts", plots.join(","), teams.join(",")],
    queryFn: () => fn({ data: { plots, teams, batch_no: [] } }),
    staleTime: 30_000,
  });

  const { byGroup, grandTotal, grandDelay } = useMemo(() => {
    const map = new Map<string, Array<{ team: string; total: number; delayed: number }>>();
    let gt = 0;
    let gd = 0;
    for (const r of data ?? []) {
      const arr = map.get(r.stage_group) ?? [];
      arr.push({ team: r.team, total: r.total, delayed: r.delayed });
      map.set(r.stage_group, arr);
      gt += r.total;
      gd += r.delayed;
    }
    for (const [k, arr] of map) {
      map.set(
        k,
        [...arr].sort((a, b) => {
          const ia = TEAM_ORDER.indexOf(a.team);
          const ib = TEAM_ORDER.indexOf(b.team);
          if (ia !== -1 || ib !== -1) {
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
          }
          return a.team.localeCompare(b.team);
        }),
      );
    }
    return { byGroup: map, grandTotal: gt, grandDelay: gd };
  }, [data]);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {GROUPS.map(({ code, label }) => {
          const rows = byGroup.get(code) ?? [];
          const total = rows.reduce((s, r) => s + r.total, 0);
          const delayed = rows.reduce((s, r) => s + r.delayed, 0);
          const sgCode = code.toLowerCase();
          const sub =
            code === "APPROVED" ? (
              <span className="text-muted-foreground">
                {grandTotal > 0 ? `${((total / grandTotal) * 100).toFixed(1)}% of total` : "—"}
              </span>
            ) : code === "RESUBMIT" ? (
              <span className="text-muted-foreground">—</span>
            ) : delayed > 0 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenRaw({ status: `sgd_${sgCode}` });
                }}
                className="rounded px-1 font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                title="지연(primary_delay) 항목만 보기"
              >
                지연 {delayed.toLocaleString()}
                {rows.length > 0 && (
                  <> ({rows.map((r) => `${r.team.charAt(0)} ${r.delayed}`).join(" · ")})</>
                )}
              </button>
            ) : (
              <span className="text-muted-foreground">—</span>
            );

          return (
            <Card
              key={code}
              onClick={() => onOpenRaw({ status: `sg_${sgCode}` })}
              className="cursor-pointer transition-colors hover:bg-primary/10"
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {label}
                    </div>
                    <div className="text-3xl font-bold leading-tight tabular-nums">
                      {total.toLocaleString()}
                    </div>
                  </div>
                  {rows.length > 0 && (
                    <div
                      className="flex min-w-[74px] flex-col gap-0.5 border-l pl-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rows.map((r) => (
                        <button
                          key={r.team || "—"}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenRaw({ status: `sg_${sgCode}`, team: r.team });
                          }}
                          className={cn(
                            "flex h-5 items-center justify-between gap-2 rounded px-1 text-[11px] tabular-nums",
                            "cursor-pointer hover:bg-primary/10",
                          )}
                        >
                          <span className="truncate">{r.team || "—"}</span>
                          <span className="font-medium">{r.total.toLocaleString()}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-1.5 text-[11px] tabular-nums">{sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        합계 {grandTotal.toLocaleString()} = Raw Data 전체 (완전 분할 불변식) · 지연{" "}
        {grandDelay.toLocaleString()}
      </div>
    </div>
  );
}