import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AbdOcsCommentsPanel } from "./AbdOcsCommentsPanel";
import { useAbdOcsComments } from "./useAbdOcsComments";

export function AbdOcsCommentsButton({
  itemId,
  abdNumber,
}: {
  itemId: string;
  abdNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data, isError } = useAbdOcsComments(itemId, true);

  if (isError) return null;

  const total = data?.total ?? 0;
  const pending = data?.pending ?? 0;
  const allDone = pending === 0;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        className={cn(
          "h-8 shrink-0 gap-1.5 text-xs",
          total === 0 && "text-muted-foreground",
          allDone && "border-emerald-500/40 text-emerald-700",
        )}
        onClick={() => setOpen(true)}
      >
        {allDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
        <span>OCS Comments {total}</span>
        {pending > 0 && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
            {pending} pending
          </span>
        )}
      </Button>
      {open && (
        <AbdOcsCommentsPanel
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) triggerRef.current?.focus();
          }}
          itemId={itemId}
          abdNumber={abdNumber}
        />
      )}
    </>
  );
}