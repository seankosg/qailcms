import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ImageIcon, Link2, Pencil, Tag, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SplOcsImageViewer } from "./SplOcsImageViewer";
import { SplOcsSourceFileButton } from "./SplOcsSourceFileButton";
import type { SplOcsComment, SplOcsComments } from "@/lib/spl/ocs.functions";

function fmtWhen(v: string | null) {
  return v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : null;
}

export function SplOcsCommentRow({
  comment: c,
  canWrite,
  categoriesAll,
  busy,
  onToggleComplied,
  onToggleCategory,
  onOpenRsp,
  onEdit,
  onDeactivate,
}: {
  comment: SplOcsComment;
  canWrite: boolean;
  categoriesAll: SplOcsComments["categories_all"];
  busy: boolean;
  onToggleComplied: (next: boolean) => void;
  onToggleCategory: (categoryId: string, on: boolean) => void;
  onOpenRsp: (rspItemId: string) => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const [viewer, setViewer] = useState(false);
  const resolved = c.is_resolved;
  const mine = new Set(c.categories.map((x) => x.id));

  return (
    <div
      id={`spl-ocs-${c.id}`}
      className={cn(
        "rounded-md border p-2.5 text-xs",
        resolved && "border-dashed bg-muted/30 text-muted-foreground",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-mono font-semibold">{c.ocs_number ?? "—"}</span>
        <span>Rev {c.revision ?? "—"}</span>
        <span>S/N {c.sn ?? "—"}</span>
        <span>Doc.Rev {c.doc_revision ?? "—"}</span>
        <Badge variant="outline" className="text-[10px]">
          Item {c.atomic_item_no}
          {c.atomic_item_count ? ` / ${c.atomic_item_count}` : ""}
        </Badge>
        {c.is_user_created && <Badge variant="secondary" className="text-[10px]">User added</Badge>}
        <Badge variant={resolved ? "secondary" : "destructive"} className="text-[10px]">
          {resolved ? "Resolved" : c.complied ? "Complied" : "Pending"}
        </Badge>
      </div>

      <div className={cn("mt-1 whitespace-pre-wrap break-words", resolved && "opacity-70")}>
        {c.comment_text ?? "—"}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {c.assessed_code && <Badge variant="outline" className="text-[10px]">Assessed: {c.assessed_code}</Badge>}
        {c.sign_off_status && <Badge variant="secondary" className="text-[10px]">Sign-Off: {c.sign_off_status}</Badge>}
        {c.resolved_reason && <span className="text-[10px]">{c.resolved_reason}</span>}
      </div>

      {c.contractor_response && (
        <div className="mt-1 rounded border bg-muted/30 p-1.5 text-[11px] whitespace-pre-wrap break-words">
          <span className="text-muted-foreground">Contractor Response: </span>
          {c.contractor_response}
        </div>
      )}

      {/* Category */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {c.categories.map((ct) => (
          <Badge key={ct.id} variant="outline" className="text-[10px]" title={`source: ${ct.source ?? "—"}`}>
            {ct.label}
            {ct.source === "user" ? " ·u" : ""}
          </Badge>
        ))}
        {canWrite && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-1 text-[10px]">
                <Tag className="h-3 w-3" /> Categories
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <div className="max-h-64 space-y-1 overflow-auto">
                {categoriesAll.map((ct) => (
                  <label key={ct.id} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={mine.has(ct.id)}
                      disabled={busy}
                      onCheckedChange={(v) => onToggleCategory(ct.id, v === true)}
                    />
                    {ct.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Linked RSP */}
      {c.rsp_links.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground">RSP:</span>
          {c.rsp_links.map((r) => (
            <Button
              key={r.id}
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => onOpenRsp(r.id)}
              title={r.description ?? undefined}
            >
              <Link2 className="h-3 w-3" /> {r.rsp_number}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          {c.attachments.length > 0 ? (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[10px]" onClick={() => setViewer(true)}>
              <ImageIcon className="h-3 w-3" />
              {c.attachments.length === 1 ? "Att. 1" : `Attachments (${c.attachments.length})`}
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground">No image</span>
          )}
          <SplOcsSourceFileButton commentId={c.id} fileName={c.source_file?.file_name ?? null} />
          <div className="break-all text-[10px] text-muted-foreground">
            {c.source_sheet ?? "—"} / row {c.source_row ?? "—"} <span className="font-mono">{c.source_comment_id}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {resolved ? (
            <span className="text-[10px]">Resolved (Closed / Code A) — read-only</span>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-[11px] font-medium">
              <Checkbox
                checked={c.complied}
                disabled={!canWrite || busy}
                onCheckedChange={(v) => onToggleComplied(v === true)}
                aria-label={`Mark OCS comment ${c.source_comment_id} as complied`}
              />
              Complied
            </label>
          )}
          {canWrite && (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-1" onClick={onEdit} aria-label="Edit OCS comment">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1 text-destructive"
                onClick={onDeactivate}
                aria-label="Deactivate OCS comment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {c.complied && c.complied_by_name && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {c.complied_by_name} · {fmtWhen(c.complied_at)} · {c.complied_source ?? "—"}
        </div>
      )}

      {viewer && (
        <SplOcsImageViewer
          open={viewer}
          onOpenChange={setViewer}
          attachments={c.attachments}
          ocsNumber={c.ocs_number}
        />
      )}
    </div>
  );
}
