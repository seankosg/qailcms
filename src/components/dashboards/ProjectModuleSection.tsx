import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * 프로젝트 대시보드의 모듈 섹션 껍데기.
 * 제목(모듈 Dashboard 링크) · 진도율 · 기준일/미분류 안내만 담당한다.
 */
export function ProjectModuleSection({
  title,
  to,
  progressPct,
  progressHint,
  asOfNote,
  unclassified,
  children,
}: {
  title: string;
  to: string;
  progressPct: number | null;
  progressHint: string;
  asOfNote?: string | null;
  unclassified?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3 border-b pb-2">
        <Link to={to} className="text-2xl font-bold tracking-tight hover:underline">
          {title}
        </Link>
        <span
          className="text-2xl font-bold tabular-nums text-primary"
          title={progressHint}
        >
          {progressPct == null ? "—" : `${progressPct.toFixed(0)}%`}
        </span>
        {asOfNote && (
          <span className="text-[11px] tabular-nums text-muted-foreground">{asOfNote}</span>
        )}
        {unclassified != null && unclassified > 0 && (
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 tabular-nums">
            미분류 {unclassified.toLocaleString()}건
          </span>
        )}
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
