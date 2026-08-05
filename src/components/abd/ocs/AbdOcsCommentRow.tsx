import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AbdOcsAttachmentButton } from "./AbdOcsAttachmentButton";
import { AbdOcsSourceFileButton } from "./AbdOcsSourceFileButton";
import type { AbdOcsComment } from "@/lib/abd/ocs.functions";

function fmtWhen(v: string | null) {
  if (!v) return null;
  return new Date(v).toLocaleString("en-GB", { hour12: false });
}

function CompliedControl({
  comment,
  canWrite,
  onToggle,
  busy,
}: {
  comment: AbdOcsComment;
  canWrite: boolean;
  onToggle: (next: boolean) => void;
  busy: boolean;
}) {
  const id = `ocs-complied-${comment.id}`;
  const box = (
    <span className="inline-flex min-h-11 items-center gap-2 md:min-h-0">
      <Checkbox
        id={id}
        checked={comment.complied}
        disabled={!canWrite || busy}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={`Mark OCS comment ${comment.source_comment_id} as complied`}
        aria-describedby={canWrite ? `${id}-label` : `${id}-readonly`}
      />
      <label
        id={`${id}-label`}
        htmlFor={id}
        className={cn("cursor-pointer text-[11px] font-medium", !canWrite && "cursor-not-allowed")}
      >
        Complied
      </label>
    </span>
  );

  return (
    <div className="space-y-1">
      {canWrite ? (
        box
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{box}</span>
            </TooltipTrigger>
            <TooltipContent id={`${id}-readonly`}>
              You do not have permission to update this drawing (read-only).
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {comment.compliance_source === "import_status_a" && (
        <Badge variant="secondary" className="text-[10px]">
          Status A · Auto
        </Badge>
      )}
      {comment.complied && comment.complied_by_name && (
        <div className="text-[10px] text-muted-foreground">
          {comment.complied_by_name} · {fmtWhen(comment.complied_at)}
        </div>
      )}
    </div>
  );
}

function MetaBlock({ c }: { c: AbdOcsComment }) {
  return (
    <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
      <AbdOcsSourceFileButton commentId={c.id} fileName={c.source_file_name} />
      <div className="break-words">
        {c.source_sheet_name ?? "—"} / row {c.source_row_index ?? "—"}
        <span className="ml-1 font-mono">{c.source_comment_id}</span>
      </div>
    </div>
  );
}

function Body({ c }: { c: AbdOcsComment }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-mono font-semibold">{c.ocs_number ?? "—"}</span>
        <span className="text-muted-foreground">S/N {c.ocs_sn ?? "—"}</span>
        <span className="text-muted-foreground">Rev {c.comment_revision ?? c.file_revision ?? "—"}</span>
        {c.comment_part && <Badge variant="outline" className="text-[10px]">{c.comment_part}</Badge>}
        {c.atomic_item_no != null && (
          <Badge variant="outline" className="text-[10px]">
            Item {c.atomic_item_no}
            {c.atomic_item_count ? ` / ${c.atomic_item_count}` : ""}
          </Badge>
        )}
        {c.response_mapping_status === "inherited" && (
          <Badge variant="secondary" className="text-[10px]">Inherited</Badge>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-xs">{c.ocs_comment ?? "—"}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {c.assessed_code && (
          <Badge variant="outline" className="text-[10px]">
            Assessed: {c.assessed_code}
          </Badge>
        )}
        {c.sign_off_status && (
          <Badge variant="secondary" className="text-[10px]">
            Sign-Off: {c.sign_off_status}
          </Badge>
        )}
        {c.complied && <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
      </div>
      {c.contractor_response && (
        <div className="rounded border bg-muted/30 p-1.5 text-[11px] whitespace-pre-wrap break-words">
          <span className="text-muted-foreground">Contractor Response: </span>
          {c.contractor_response}
        </div>
      )}
      <MetaBlock c={c} />
    </div>
  );
}

export function AbdOcsCommentRow({
  comment,
  canWrite,
  onToggle,
  busy,
  variant,
}: {
  comment: AbdOcsComment;
  canWrite: boolean;
  onToggle: (next: boolean) => void;
  busy: boolean;
  variant: "table" | "card";
}) {
  if (variant === "table") {
    return (
      <tr className="border-t align-top">
        <td className="w-[112px] px-2 py-2">
          <AbdOcsAttachmentButton attachments={comment.attachments} ocsNumber={comment.ocs_number} />
        </td>
        <td className="px-2 py-2">
          <Body c={comment} />
        </td>
        <td className="w-[168px] px-2 py-2">
          <CompliedControl comment={comment} canWrite={canWrite} onToggle={onToggle} busy={busy} />
        </td>
      </tr>
    );
  }
  return (
    <div className="rounded-md border p-2.5">
      <Body c={comment} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <AbdOcsAttachmentButton attachments={comment.attachments} ocsNumber={comment.ocs_number} />
        <CompliedControl comment={comment} canWrite={canWrite} onToggle={onToggle} busy={busy} />
      </div>
    </div>
  );
}