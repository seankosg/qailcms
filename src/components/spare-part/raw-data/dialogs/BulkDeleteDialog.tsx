import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  applyBulkHardDelete,
  previewBulkDelete,
  type CascadePreview,
} from "@/lib/spare-part/bulk-actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docRefs: string[];
  onDone: () => void;
}

export function BulkDeleteDialog({ open, onOpenChange, docRefs, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [preview, setPreview] = useState<CascadePreview | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmText("");
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await previewBulkDelete(docRefs);
        if (!cancelled) setPreview(p);
      } catch (e: any) {
        if (!cancelled)
          toast.error("Preview 실패", { description: e?.message ?? String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, docRefs]);

  const canConfirm = useMemo(
    () => confirmText === "DELETE" && docRefs.length > 0 && !busy,
    [confirmText, docRefs.length, busy],
  );

  async function handleConfirm() {
    setBusy(true);
    try {
      const r = await applyBulkHardDelete(docRefs);
      toast.success("삭제 완료", {
        description: `${r.succeeded} 건 영구 삭제${r.failed ? ` · ${r.failed} 실패` : ""}`,
      });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error("삭제 실패", { description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg border-l-4 border-l-destructive">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Delete permanently
          </DialogTitle>
          <DialogDescription>
            선택된 {docRefs.length} 개 spare part 행과 관련된 코멘트/상태이력/커스텀필드가 영구
            삭제됩니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="font-medium">
              {docRefs.length} row{docRefs.length === 1 ? "" : "s"} will be permanently deleted
            </div>
          </div>

          {preview && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cascade impact
              </div>
              <div className="overflow-hidden rounded border">
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(preview).map(([k, v]) => (
                      <tr key={k} className="border-t first:border-t-0">
                        <td className="px-2 py-1">
                          {k === "spare_parts" ? "Spare parts" : k}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Type <span className="font-mono font-semibold text-destructive">DELETE</span> to
              confirm.
            </div>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-8 font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canConfirm}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete {docRefs.length} row{docRefs.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}