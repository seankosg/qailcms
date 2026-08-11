import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SplOcsComment } from "@/lib/spl/ocs.functions";

export type SplOcsCommentDraft = {
  id: string | null;
  ocsNumber: string;
  revision: string;
  commentText: string;
  contractorResponse: string;
  assessedCode: string;
  signOffStatus: string;
};

/** OCS 코멘트 추가·수정 — source identity 는 편집 대상이 아니다 */
export function SplOcsCommentDialog({
  open,
  onOpenChange,
  comment,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  comment: SplOcsComment | null;
  busy: boolean;
  onSave: (d: SplOcsCommentDraft) => void;
}) {
  const [d, setD] = useState<SplOcsCommentDraft>({
    id: null,
    ocsNumber: "",
    revision: "",
    commentText: "",
    contractorResponse: "",
    assessedCode: "",
    signOffStatus: "",
  });

  useEffect(() => {
    if (!open) return;
    setD({
      id: comment?.id ?? null,
      ocsNumber: comment?.ocs_number ?? "",
      revision: comment?.revision ?? "",
      commentText: comment?.comment_text ?? "",
      contractorResponse: comment?.contractor_response ?? "",
      assessedCode: comment?.assessed_code ?? "",
      signOffStatus: comment?.sign_off_status ?? "",
    });
  }, [open, comment]);

  const set = (k: keyof SplOcsCommentDraft, v: string) => setD((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{comment ? "Edit OCS comment" : "Add OCS comment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">OCS Number</Label>
              <Input
                className="h-8 text-xs"
                value={d.ocsNumber}
                disabled={!!comment}
                onChange={(e) => set("ocsNumber", e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px]">Revision</Label>
              <Input
                className="h-8 text-xs"
                value={d.revision}
                disabled={!!comment}
                onChange={(e) => set("revision", e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-[11px]">OCS Comment</Label>
            <Textarea rows={4} className="text-xs" value={d.commentText} onChange={(e) => set("commentText", e.target.value)} />
          </div>
          <div>
            <Label className="text-[11px]">Contractor Response</Label>
            <Textarea
              rows={3}
              className="text-xs"
              value={d.contractorResponse}
              onChange={(e) => set("contractorResponse", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Assessed Code</Label>
              <Input className="h-8 text-xs" value={d.assessedCode} onChange={(e) => set("assessedCode", e.target.value)} />
            </div>
            <div>
              <Label className="text-[11px]">Sign-Off / Status</Label>
              <Input className="h-8 text-xs" value={d.signOffStatus} onChange={(e) => set("signOffStatus", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || d.commentText.trim().length === 0} onClick={() => onSave(d)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
