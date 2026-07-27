import { useState } from "react";
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
import { Loader2 } from "lucide-react";
import { applyAbdBulkHardDelete } from "@/lib/abd/bulk-actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ids: string[];
  onDone: () => void;
}

export function AbdBulkDeleteDialog({ open, onOpenChange, ids, onDone }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const canDelete = typed.trim().toUpperCase() === "DELETE" && ids.length > 0;

  async function handleDelete() {
    setBusy(true);
    try {
      const r = await applyAbdBulkHardDelete(ids);
      toast.success("삭제 완료", {
        description: `${r.deleted} rows 삭제${r.failed > 0 ? ` · ${r.failed} 실패` : ""}`,
      });
      onOpenChange(false);
      setTyped("");
      onDone();
    } catch (e: any) {
      toast.error("삭제 실패", { description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTyped("");
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">영구 삭제</DialogTitle>
          <DialogDescription>
            선택한 <strong>{ids.length}</strong>개 행을 <code>abd_items_raw</code>에서
            영구 삭제합니다. 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            계속하려면 아래에 <code className="font-mono">DELETE</code>를 입력하세요.
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            className="h-8"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete || busy}
            onClick={handleDelete}
          >
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            영구 삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}