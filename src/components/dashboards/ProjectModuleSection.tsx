import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type PlotHeadStat = {
  plot: "D" | "C";
  progressPct: number | null;
  total: number;
};

/** 모듈 구분용 accent (좌측 라인) — 섹션 전체를 색으로 채우지 않는다 */
export type ModuleTone = "tm" | "sm" | "abd";

const TONE: Record<ModuleTone, string> = {
  tm: "border-l-sky-500 dark:border-l-sky-400",
  sm: "border-l-amber-500 dark:border-l-amber-400",
  abd: "border-l-emerald-500 dark:border-l-emerald-400",
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
        // 색은 좌측 accent line 에만 — 카드/섹션 테두리가 겹쳐 보이지 않게 한 겹만 둔다.
        "flex flex-col gap-3 rounded-lg border border-l-4 bg-card/30 p-3",
        tone ? TONE[tone] : "border-l-border",
      )}
    >
      <div className="border-b pb-2">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">
          <Link to={to} className="hover:underline">
            {title}
          </Link>
        </h2>
        <div className="mt-1.5 grid gap-3 xl:grid-cols-2">
          {plots.map((p, i) => (
            <div
              key={p.plot}
              className={cn(
                "flex items-baseline gap-2",
                // 데스크톱 2열일 때만 열 사이 약한 세로 구분선
                i === 1 && "xl:border-l xl:pl-4",
              )}
            >
              <PlotColumnHeader plot={p.plot} />
              <span className="text-xl font-bold tabular-nums text-primary" title={progressHint}>
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
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Plot {plot}
    </div>
  );
}
