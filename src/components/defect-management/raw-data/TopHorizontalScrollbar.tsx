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

    const onTargetScroll = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      self.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    };

    const onSelfScroll = () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      target.scrollLeft = self.scrollLeft;
      requestAnimationFrame(() => {
        isSyncingRef.current = false;
      });
    };

    target.addEventListener("scroll", onTargetScroll, { passive: true });
    self.addEventListener("scroll", onSelfScroll, { passive: true });
    self.scrollLeft = target.scrollLeft;
    return () => {
      target.removeEventListener("scroll", onTargetScroll);
      self.removeEventListener("scroll", onSelfScroll);
    };
  }, [targetRef]);

  const innerWidth = Math.max(width, 1);

  return (
    <div
      className={cn("flex h-[20px] shrink-0 border-b bg-background", className)}
      aria-hidden
    >
      {frozenWidth > 0 && (
        <div
          style={{ width: frozenWidth, minWidth: frozenWidth }}
          className="sticky left-0 z-10 border-r bg-background"
        />
      )}
      <div ref={selfRef} className="h-full flex-1 overflow-x-auto overflow-y-hidden bg-background">
        <div style={{ width: innerWidth, height: 1 }} />
      </div>
    </div>
  );
}