import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  targetRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  frozenWidth?: number;
  className?: string;
}

/**
 * A mirror horizontal scrollbar shown above the table body.
 * Keeps scroll position in sync with the actual scroll container.
 */
export function TopHorizontalScrollbar({ targetRef, width, frozenWidth = 0, className }: Props) {
  const selfRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    const self = selfRef.current;
    if (!target || !self) return;
    const onTop = () => {
      if (isSyncingRef.current) { isSyncingRef.current = false; return; }
      isSyncingRef.current = true;
      target.scrollLeft = self.scrollLeft;
    };
    const onBot = () => {
      if (isSyncingRef.current) { isSyncingRef.current = false; return; }
      isSyncingRef.current = true;
      self.scrollLeft = target.scrollLeft;
    };
    self.addEventListener("scroll", onTop, { passive: true });
    target.addEventListener("scroll", onBot, { passive: true });
    return () => {
      self.removeEventListener("scroll", onTop);
      target.removeEventListener("scroll", onBot);
    };
  }, [targetRef]);

  return (
    <div
      ref={selfRef}
      className={cn("overflow-x-auto overflow-y-hidden border-b bg-muted/20", className)}
      style={{ height: 12, marginLeft: frozenWidth }}
    >
      <div style={{ width: Math.max(0, width - frozenWidth), height: 1 }} />
    </div>
  );
}