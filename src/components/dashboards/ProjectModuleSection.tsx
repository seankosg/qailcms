import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export type PlotHeadStat = {
  plot: "D" | "C";
  progressPct: number | null;
  total: number;
};

/**
 * 프로젝트 대시보드의 모듈 섹션 껍데기.
 * 진도율은 플롯별로 각각 — 합산값은 만들지 않는다.
 * D · C 값은 각각 아래 플롯 열 위에 오도록 2열 격자로 정렬한다.
 */
export function ProjectModuleSection({
  title,
  to,
  progressHint,
  plots,
  filterChips,
  children,
}: {
  title: string;
  to: string;
  progressHint: string;
  plots: [PlotHeadStat, PlotHeadStat];
  /** Admin > Setting 에서 저장된 현재 필터 현황 */
  filterChips?: Array<{ label: string; value: string }>;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="border-b pb-2">
        <Link to={to} className="text-2xl font-bold tracking-tight hover:underline">
          {title}
        </Link>
        <div className="mt-1 grid gap-3 xl:grid-cols-2">
          {plots.map((p) => (
            <div key={p.plot} className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">Plot {p.plot}</span>
              <span
                className="text-2xl font-bold tabular-nums text-primary"
                title={progressHint}
              >
                {p.progressPct == null ? "—" : `${p.progressPct.toFixed(0)}%`}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                모수 {p.total.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        {filterChips && filterChips.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {filterChips.map((f) => (
              <span
                key={f.label}
                className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
              >
                <span className="font-semibold uppercase tracking-wide">{f.label}</span>{" "}
                <span className="text-foreground">{f.value}</span>
              </span>
            ))}
            <Link
              to="/admin/setting"
              className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Admin &gt; Setting 에서 변경
            </Link>
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function PlotColumnHeader({ plot }: { plot: "C" | "D" }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      Plot {plot}
    </div>
  );
}
