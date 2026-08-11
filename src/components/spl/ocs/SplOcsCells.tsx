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

/** OCS 셀 — 총건수 + Pending 강조 */
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
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  const hasPending = (pending ?? 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Total ${total} · Pending ${pending ?? 0} · Complied ${complied ?? 0} · Resolved ${resolved ?? 0}`}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums hover:underline",
        hasPending ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800",
      )}
    >
      {total}
      {hasPending && <span className="ml-1 font-normal">({pending})</span>}
    </button>
  );
}
