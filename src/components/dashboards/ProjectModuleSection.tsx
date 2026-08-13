import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type PlotHeadStat = {
  plot: "D" | "C";
  progressPct: number | null;
  total: number;
};

/** 모듈 구분용 연한 테두리 + 바탕색 */
export type ModuleTone = "tm" | "sm" | "abd";

const TONE: Record<ModuleTone, string> = {
  tm: "border-sky-200/70 bg-sky-50/50 dark:border-sky-900/60 dark:bg-sky-950/20",
  sm: "border-amber-200/70 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20",
  abd: "border-emerald-200/70 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20",
};

const TONE_DIVIDER: Record<ModuleTone, string> = {
  tm: "border-b-sky-200/80 dark:border-b-sky-900/70",
  sm: "border-b-amber-200/80 dark:border-b-amber-900/70",
  abd: "border-b-emerald-200/80 dark:border-b-emerald-900/70",
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
  tone,
  children,
}: {
  title: string;
  to: string;
  progressHint: string;
  plots: [PlotHeadStat, PlotHeadStat];
  tone?: ModuleTone;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        tone ? TONE[tone] : "bg-card/40",
      )}
    >
      <div className={cn("border-b pb-2", tone && TONE_DIVIDER[tone])}>
        <Link to={to} className="text-2xl font-bold tracking-tight hover:underline">
          {title}
        </Link>
        <div className="mt-1 grid gap-3 xl:grid-cols-2">
          {plots.map((p) => (
            <div key={p.plot} className="flex items-baseline gap-2">
              <PlotColumnHeader plot={p.plot} />
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
      </div>
      {children}
    </section>
  );
}

export function PlotColumnHeader({ plot }: { plot: "C" | "D" }) {
  return (
    <div className="text-2xl font-bold uppercase tracking-wide text-muted-foreground">
      Plot {plot}
    </div>
  );
}
