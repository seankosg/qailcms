import { cn } from "@/lib/utils";

interface Props {
  /** 완료 건수 */
  value: number;
  /** 전체 건수 */
  total: number;
  /** px 지름 */
  size?: number;
  className?: string;
  /** 트랙/진행 색상 (Tailwind text-* 토큰 기반 currentColor 사용) */
  tone?: "ok" | "pending" | "muted";
}

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  pending: "text-amber-600 dark:text-amber-400",
  muted: "text-muted-foreground",
};

/**
 * 진행률 도넛 아이콘 (SVG). 텍스트 없이 원형 게이지만 렌더한다.
 * 라벨/수치는 호출 측에서 옆에 배치한다.
 */
export function ProgressDonutIcon({ value, total, size = 14, className, tone = "pending" }: Props) {
  const safeTotal = Math.max(0, total);
  const safeValue = Math.min(Math.max(0, value), safeTotal);
  const pct = safeTotal > 0 ? safeValue / safeTotal : 0;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn("shrink-0", TONE[tone], className)}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      {pct > 0 && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  );
}