import { cn } from "@/lib/utils";

/**
 * Multi-Sort 우선순위 표시 배지.
 * 정렬 배열(SortingState)의 인덱스+1 을 헤더에 노출한다 — 선택한 순서가 곧 우선순위다.
 * 정렬 컬럼이 1개뿐일 때는 번호를 감춘다(노이즈 방지).
 */
export function SortPriorityBadge({
  index,
  total,
  className,
}: {
  /** SortingState 내 인덱스 (0-based). -1 이면 미정렬 */
  index: number;
  /** 현재 정렬 중인 컬럼 총 개수 */
  total: number;
  className?: string;
}) {
  if (index < 0 || total < 2) return null;
  return (
    <span
      title={`정렬 우선순위 ${index + 1} / ${total}`}
      className={cn(
        "ml-0.5 inline-flex h-3.5 min-w-[0.875rem] flex-shrink-0 items-center justify-center rounded-sm bg-primary px-[3px] text-[9px] font-bold leading-none text-primary-foreground",
        className,
      )}
    >
      {index + 1}
    </span>
  );
}
