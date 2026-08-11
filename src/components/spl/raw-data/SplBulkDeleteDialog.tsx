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
import { applySplBulkHardDelete } from "@/lib/spl/bulk-actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 삭제 권한이 확인된 행 id 목록 */
  ids: string[];
  /** 선택했지만 권한이 없어 제외된 행 수 */
  excluded: number;
  onDone: () => void;
}

export function SplBulkDeleteDialog({ open, onOpenChange, ids, excluded, onDone }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toUpperCase() === "DELETE" && ids.length > 0;

  async function handleDelete() {
    setBusy(true);
    try {
      const r = await applySplBulkHardDelete(ids);
      if (r.deleted === 0) {
        toast.error("삭제되지 않았습니다", {
          description:
            r.linked > 0
              ? `${r.linked}건은 연결된 RSP·OCS·문서가 있어 삭제할 수 없습니다.`
              : `권한이 없어 ${r.requested}건이 삭제되지 않았습니다.${r.firstError ? ` (${r.firstError})` : ""}`,
        });
      } else {
        toast.success("삭제 완료", {
          description: `${r.deleted}건 삭제${r.failed > 0 ? ` · ${r.failed}건 실패` : ""}${
            r.blocked > 0 ? ` · ${r.blocked}건 권한 차단` : ""
          }`,
        });
        if (r.linked > 0) {
          toast.error("일부 행은 연결 데이터로 삭제 불가", {
            description: `${r.linked}건에 RSP·OCS·문서 연결이 있습니다.`,
          });
        }
      }
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
            선택한 <strong>{ids.length}</strong>개 행을 SPL 원본에서 영구 삭제합니다. 되돌릴 수 없습니다.
            {excluded > 0 && <> 권한이 없는 {excluded}건은 제외됩니다.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            계속하려면 아래에 <code className="font-mono">DELETE</code>를 입력하세요.
          </p>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className="h-8" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button variant="destructive" disabled={!ready || busy} onClick={handleDelete}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            영구 삭제
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
