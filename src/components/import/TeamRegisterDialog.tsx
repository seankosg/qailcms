import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addMasterName } from "@/lib/admin/users.functions";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface Props {
  open: boolean;
  unknownCodes: string[];
  canRegister: boolean;
  onClose: () => void;
  onRegistered: () => void;
}

interface DraftRow {
  code: string;
  name: string;
  sort_order: number;
  aliases: string;
}

export function TeamRegisterDialog({ open, unknownCodes, canRegister, onClose, onRegistered }: Props) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const add = useServerFn(addMasterName);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setDrafts(unknownCodes.map((c) => ({ code: c, name: c, sort_order: 0, aliases: "" })));
    }
  }, [open, unknownCodes]);

  const updateDraft = (i: number, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  const handleRegister = async () => {
    setSaving(true);
    try {
      for (const d of drafts) {
        const code = d.code.trim().toUpperCase();
        if (!code) continue;
        const aliasesArr = d.aliases
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s.toUpperCase() !== code);
        await add({
          data: {
            kind: "team",
            code,
            name: (d.name.trim() || code),
            sort_order: d.sort_order || 0,
            aliases: aliasesArr,
          } as any,
        });
      }
      qc.invalidateQueries({ queryKey: ["team-master", "active"] });
      qc.invalidateQueries({ queryKey: ["team-master", "all"] });
      qc.invalidateQueries({ queryKey: ["master", "team"] });
      toast.success("Team이 등록되었습니다.");
      onRegistered();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>미등록 Team 감지</DialogTitle>
          <DialogDescription>
            Import 파일에서 발견된 팀 코드가 마스터에 없습니다. Import를 계속하려면 먼저 팀을 등록해야 합니다.
          </DialogDescription>
        </DialogHeader>

        {!canRegister ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>등록 권한이 없습니다</AlertTitle>
            <AlertDescription>
              다음 팀 코드를 관리자에게 등록 요청해 주세요:
              <div className="mt-2 flex flex-wrap gap-2">
                {unknownCodes.map((c) => (
                  <span key={c} className="rounded bg-destructive/10 px-2 py-1 font-mono text-xs">{c}</span>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[100px_1fr_80px_1fr] gap-2 text-xs font-medium text-muted-foreground">
              <div>Code</div>
              <div>Name</div>
              <div>Sort</div>
              <div>별칭 (쉼표)</div>
            </div>
            {drafts.map((d, i) => (
              <div key={i} className="grid grid-cols-[100px_1fr_80px_1fr] gap-2">
                <Input value={d.code} onChange={(e) => updateDraft(i, { code: e.target.value.toUpperCase() })} className="font-mono" />
                <Input value={d.name} onChange={(e) => updateDraft(i, { name: e.target.value })} />
                <Input type="number" value={d.sort_order} onChange={(e) => updateDraft(i, { sort_order: Number(e.target.value) || 0 })} />
                <Input value={d.aliases} onChange={(e) => updateDraft(i, { aliases: e.target.value })} placeholder="예: 설비, MECHANICAL" />
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          {canRegister && (
            <Button onClick={handleRegister} disabled={saving || drafts.length === 0}>
              {saving ? "등록 중…" : "등록 후 재검증"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}