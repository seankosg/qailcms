import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AbdOcsCommentRow } from "./AbdOcsCommentRow";
import { useAbdOcsComments, useSetAbdOcsComplied } from "./useAbdOcsComments";

const WIDTH_KEY = "abd.ocs.panelWidth";
const MIN_W = 440;
const DEFAULT_W = 720;
const PAGE = 100;

function maxWidth() {
  if (typeof window === "undefined") return 1100;
  return Math.min(1100, Math.round(window.innerWidth * 0.92));
}

export function AbdOcsCommentsPanel({
  open,
  onOpenChange,
  itemId,
  abdNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  itemId: string;
  abdNumber: string;
}) {
  const isMobile = useIsMobile();
  const [width, setWidth] = useState(DEFAULT_W);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_W) setWidth(Math.min(saved, maxWidth()));
  }, []);

  const commit = useCallback((w: number) => {
    const clamped = Math.max(MIN_W, Math.min(maxWidth(), Math.round(w)));
    setWidth(clamped);
    window.localStorage.setItem(WIDTH_KEY, String(clamped));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      commit(window.innerWidth - e.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [commit]);

  const query = useAbdOcsComments(itemId, open);
  const setComplied = useSetAbdOcsComplied(itemId);
  const data = query.data;
  const comments = data?.comments ?? [];
  const visible = showAll ? comments : comments.slice(0, PAGE);

  const toggle = (commentId: string, current: boolean, next: boolean) => {
    setBusyId(commentId);
    setComplied.mutate(
      { commentId, expected: current, complied: next },
      { onSettled: () => setBusyId(null) },
    );
  };

  const rows = (variant: "table" | "card") =>
    visible.map((c) => (
      <AbdOcsCommentRow
        key={c.id}
        comment={c}
        canWrite={!!data?.can_write}
        busy={busyId === c.id}
        variant={variant}
        onToggle={(next) => toggle(c.id, c.complied, next)}
      />
    ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("flex flex-col gap-0 p-0 sm:max-w-none", isMobile ? "w-screen" : "")}
        style={isMobile ? undefined : { width, maxWidth: "92vw" }}
      >
        {!isMobile && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize OCS comments panel. Use the Left and Right Arrow keys."
            tabIndex={0}
            onMouseDown={() => {
              dragging.current = true;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                commit(width + 16);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                commit(width - 16);
              }
            }}
            className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize bg-border/60 hover:bg-primary/50 focus:bg-primary focus:outline-none"
          />
        )}

        <SheetHeader className="border-b px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">{abdNumber}</span>
            <span className="text-muted-foreground">OCS Comments</span>
            {data && (
              <>
                <Badge variant="outline" className="text-[10px]">Total {data.total}</Badge>
                <Badge variant="secondary" className="text-[10px]">Complied {data.complied}</Badge>
                <Badge
                  variant={data.pending > 0 ? "destructive" : "secondary"}
                  className="text-[10px]"
                >
                  Pending {data.pending}
                </Badge>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7"
              onClick={() => void query.refetch()}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
            </Button>
          </SheetTitle>
          <SheetDescription className="text-xs">
            OCS comments linked to this drawing and their Complied status.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-3">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading OCS comments…
            </div>
          ) : query.isError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Unable to load OCS comments.
                <div className="mt-1 break-all font-mono text-[10px]">
                  {query.error instanceof Error ? query.error.message : String(query.error)}
                </div>
              </div>
            </div>
          ) : comments.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              No OCS comments are linked to this drawing.
              <br />
              Unlinked OCS comments are managed from the OCS Import page.
            </div>
          ) : isMobile ? (
            <div className="space-y-2">{rows("card")}</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-background">
                <tr className="border-b">
                  <th className="w-[112px] px-2 py-1.5 text-left font-medium">Attachment</th>
                  <th className="px-2 py-1.5 text-left font-medium">OCS Comment</th>
                  <th className="w-[168px] px-2 py-1.5 text-left font-medium">Complied</th>
                </tr>
              </thead>
              <tbody>{rows("table")}</tbody>
            </table>
          )}

          {!showAll && comments.length > PAGE && (
            <div className="mt-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>
                Show more ({comments.length - PAGE})
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}