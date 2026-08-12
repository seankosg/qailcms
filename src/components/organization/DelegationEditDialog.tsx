/**
 * 부재중 업무 이관(위임) 기록 수정 · 삭제 다이얼로그.
 *
 * 권한: 본인(등록자 또는 인계자 본인) 또는 Superuser 이상.
 * 판정은 서버 RLS(`tm_pic_delegations`)가 정본이며 여기서는 화면 게이트만 둔다.
 *
 * 수정 가능 범위는 DB 가드 트리거(`tm_pic_deleg_guard`)와 동일하게 제한한다.
 *  - 시작 전: 시작일 · 종료일 · 사유 수정, 취소(삭제) 가능
 *  - 진행 중: 종료일(오늘 이후) · 사유만 수정
 *  - 종료/취소됨: 수정 불가(삭제만)
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { todayInDoha } from "@/lib/time/doha";

export interface DelegationEditRow {
  id: string;
  from_pic: string;
  to_pic: string;
  start_date: string;
  end_date: string;
  status: string;
  note: string | null;
  task?: { task_no: string | null; task_name: string | null } | null;
}

function todayIso() {
  try { return todayInDoha(); } catch { return new Date().toISOString().slice(0, 10); }
}

export function DelegationEditDialog({
  row, open, onOpenChange,
}: {
  row: DelegationEditRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const today = todayIso();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setStart(row.start_date);
    setEnd(row.end_date);
    setNote(row.note ?? "");
  }, [row]);

  if (!row) return null;

  const cancelled = row.status !== "active";
  const ended = !cancelled && row.end_date < today;
  const started = !cancelled && !ended && row.start_date <= today;
  const editable = !cancelled && !ended;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["organization"] });
    await qc.invalidateQueries({ queryKey: ["tm-deleg"] });
    await qc.invalidateQueries({ queryKey: ["my-workspace"] });
  };

  const save = async () => {
    if (!editable) return;
    if (end < start) { toast.error("종료일이 시작일보다 빠릅니다."); return; }
    if (started && end < today) { toast.error("진행 중인 위임의 종료일은 오늘보다 앞당길 수 없습니다."); return; }
    setBusy(true);
    try {
      const patch: Record<string, unknown> = started
        ? { end_date: end, note: note.trim() || null }
        : { start_date: start, end_date: end, note: note.trim() || null };
      const { error } = await (supabase as any)
        .from("tm_pic_delegations")
        .update(patch)
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      toast.success("이관 내용을 수정했습니다.");
      await refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("tm_pic_delegations")
        .delete()
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      toast.success("이관 기록을 삭제했습니다.");
      await refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">이관 기록 수정 · 삭제</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-mono">{row.task?.task_no ?? "-"}</span> · {row.from_pic} → <span className="font-medium">{row.to_pic}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">시작일</Label>
              <Input
                type="date"
                value={start}
                disabled={!editable || started}
                onChange={(e) => setStart(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">종료일</Label>
              <Input
                type="date"
                value={end}
                min={started ? today : start}
                disabled={!editable}
                onChange={(e) => setEnd(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">사유</Label>
            <Textarea
              value={note}
              disabled={!editable}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-16 text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {cancelled
              ? "취소된 기록입니다. 삭제만 할 수 있습니다."
              : ended
                ? "이미 종료된 기록입니다. 삭제만 할 수 있습니다."
                : started
                  ? "이미 시작된 위임이라 종료일(오늘 이후)과 사유만 바꿀 수 있습니다."
                  : "아직 시작 전이라 기간과 사유를 모두 바꿀 수 있습니다."}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={busy}>삭제</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>이 이관 기록을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  삭제하면 해당 기간의 담당자 위임이 사라지고 원 담당자({row.from_pic})로 즉시 되돌아갑니다. 되돌릴 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>닫기</Button>
            <Button size="sm" onClick={save} disabled={busy || !editable}>저장</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
