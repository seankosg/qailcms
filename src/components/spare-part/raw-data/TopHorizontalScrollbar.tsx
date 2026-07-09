import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  targetRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  frozenWidth?: number;
  className?: string;
}

export function TopHorizontalScrollbar({ targetRef, width, frozenWidth = 0, className }: Props) {
  const selfRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    const self = selfRef.current;
    if (!target || !self) return;
    const onTargetScroll = () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      self.scrollLeft = target.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    };
    target.addEventListener("scroll", onTargetScroll, { passive: true });
    self.scrollLeft = target.scrollLeft;
    return () => target.removeEventListener("scroll", onTargetScroll);
  }, [targetRef]);

  const handleSelfScroll = () => {
    const target = targetRef.current;
    const self = selfRef.current;
    if (!target || !self || isSyncing.current) return;
    isSyncing.current = true;
    target.scrollLeft = self.scrollLeft;
    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  };

  return (
    <div className={cn("flex h-[14px] shrink-0 border-b bg-muted/30", className)} aria-hidden>
      {frozenWidth > 0 && (
        <div style={{ width: frozenWidth, minWidth: frozenWidth }} className="border-r bg-background" />
      )}
      <div
        ref={selfRef}
        onScroll={handleSelfScroll}
        className="h-full flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div style={{ width: Math.max(width, 1), height: 1 }} />
      </div>
    </div>
  );
}