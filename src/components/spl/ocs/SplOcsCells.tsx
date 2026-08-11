import { cn } from "@/lib/utils";

/**
 * Raw Data 카운트 배지.
 * 값이 null = 과거 as-of 조회(캐시 비적용) → 공란.
 */
export function SplCountCell({
  value,
  tone,
  title,
  onClick,
}: {
  value: number | null | undefined;
  tone?: "pending" | "done" | "neutral";
  title?: string;
  onClick: () => void;
}) {
  if (value == null) return <span className="text-muted-foreground" title="As-of 조회에서는 표시하지 않습니다">—</span>;
  if (value === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums hover:underline",
        tone === "pending"
          ? "bg-red-100 text-red-800"
          : tone === "done"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-slate-100 text-slate-800",
      )}
    >
      {value}
    </button>
  );
}

/** OCS 셀 — ABD Raw Data와 동일한 원형 숫자 배지 (원 안에는 총건수만) */
export function SplOcsCell({
  total,
  pending,
  complied,
  resolved,
  onClick,
}: {
  total: number | null | undefined;
  pending: number | null | undefined;
  complied: number | null | undefined;
  resolved: number | null | undefined;
  onClick: () => void;
}) {
  if (total == null) return <span className="text-muted-foreground" title="As-of 조회에서는 표시하지 않습니다">—</span>;
  const n = total ?? 0;
  const hasPending = (pending ?? 0) > 0;
  const tone =
    n === 0
      ? "border-slate-400/60 bg-slate-400/15 text-slate-600 dark:text-slate-300"
      : hasPending
        ? "border-rose-500/70 bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : "border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Total ${n} · Complied ${complied ?? 0} · Pending ${pending ?? 0} · Resolved ${resolved ?? 0}`}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-shadow hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone,
      )}
    >
      {n}
    </button>
  );
}
