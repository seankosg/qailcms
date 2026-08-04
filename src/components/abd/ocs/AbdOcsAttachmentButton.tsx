import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageIcon } from "lucide-react";
import { AbdOcsImageViewer } from "./AbdOcsImageViewer";
import type { AbdOcsAttachment } from "@/lib/abd/ocs.functions";

export function AbdOcsAttachmentButton({
  attachments,
  ocsNumber,
}: {
  attachments: AbdOcsAttachment[];
  ocsNumber: string | null;
}) {
  const [open, setOpen] = useState(false);
  const n = attachments.length;

  if (n === 0) {
    return (
      <span className="inline-flex h-11 min-w-[92px] items-center text-xs text-muted-foreground md:h-auto">—</span>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 min-w-[92px] justify-start gap-1.5 px-2 text-xs md:h-8"
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        {n === 1 ? "Att. 1" : `Attachments (${n})`}
      </Button>
      {open && (
        <AbdOcsImageViewer
          open={open}
          onOpenChange={setOpen}
          attachments={attachments}
          ocsNumber={ocsNumber}
          startIndex={0}
        />
      )}
    </>
  );
}