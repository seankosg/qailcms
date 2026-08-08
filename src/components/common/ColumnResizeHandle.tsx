import { useCallback } from "react";
import { cn } from "@/lib/utils";

/**
 * 헤더 우측 드래그 핸들 — 컬럼 폭 조절.
 * TanStack Table 을 쓰지 않는 표(WRT·SPL 등)에서 ABD 와 동일한 리사이즈 UX 를 제공한다.
 */
export function ColumnResizeHandle({
  width,
  min = 48,
  onChange,
  className,
}: {
  width: number;
  min?: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  const start = useCallback(
    (clientX: number) => {
      const startX = clientX;
      const startWidth = width;
      const move = (e: MouseEvent | TouchEvent) => {
        const x = "touches" in e ? e.touches[0]?.clientX ?? startX : e.clientX;
        onChange(Math.max(min, Math.round(startWidth + (x - startX))));
      };
      const end = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("touchmove", move);
        window.removeEventListener("touchend", end);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", end);
      window.addEventListener("touchmove", move);
      window.addEventListener("touchend", end);
    },
    [width, min, onChange],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(e.clientX);
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
        start(e.touches[0]?.clientX ?? 0);
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40",
        className,
      )}
    />
  );
}
