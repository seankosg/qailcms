import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type RollbackKind = "task_management" | "defect_management" | "abd";

interface PreviewResult {
  insert_count: number;
  update_count: number;
  conflict_count: number;
}

interface Props {
  kind: RollbackKind;
  batchId: string;
  fileName: string;
  onDone?: () => void;
}

const PREVIEW_FN = {
  task_management: "preview_rollback_task_management_import",
  defect_management: "preview_rollback_defect_import",
  abd: "preview_rollback_abd_import",
} as const;

const ROLLBACK_FN = {
  task_management: "rollback_task_management_import",
  defect_management: "rollback_defect_import",
  abd: "rollback_abd_import",
} as const;

export function RollbackDialog({ kind, batchId, fileName, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setForce(false);
      return;
    }
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc(PREVIEW_FN[kind], {
        _batch_id: batchId,
      });
      if (error) throw error;
      setPreview(data as PreviewResult);
    } catch (e: any) {
      toast.error("Preview 실패", {
        description: e?.message || "롤백 미리보기를 불러오지 못했습니다",
      });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const runRollback = async () => {
    setRunning(true);
    try {
      const { data, error } = await (supabase as any).rpc(ROLLBACK_FN[kind], {
        _batch_id: batchId,
        _force: force,
      });
      if (error) throw error;
      const r = data as { restored_count: number; deleted_count: number; skipped_count: number };
      toast.success("롤백 완료", {
        description: `복원 ${r.restored_count} · 비활성화 ${r.deleted_count} · 스킵 ${r.skipped_count}`,
      });
      setOpen(false);
      onDone?.();
    } catch (e: any) {
      toast.error("롤백 실패", { description: e?.message || "롤백에 실패했습니다" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="이 배치 롤백 (변경분만 되돌림)"
          onClick={(e) => e.stopPropagation()}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>배치 롤백?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                <strong>{fileName}</strong> 이 만든 변경만 되돌립니다. 다른 사용자 편집 및 이후
                배치는 유지됩니다.
              </p>
              {loading || !preview ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 영향 계산 중…
                </div>
              ) : (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                  <div className="flex justify-between">
                    <span>이 배치가 추가한 행 (비활성화):</span>
                    <span className="font-medium">{preview.insert_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>되돌릴 필드 업데이트:</span>
                    <span className="font-medium">{preview.update_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>충돌 (이후 다시 변경됨):</span>
                    <span
                      className={
                        preview.conflict_count > 0
                          ? "font-medium text-destructive"
                          : "font-medium"
                      }
                    >
                      {preview.conflict_count}
                    </span>
                  </div>
                </div>
              )}
              {preview && preview.conflict_count > 0 && (
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={force}
                    onCheckedChange={(v) => setForce(v === true)}
                    className="mt-0.5"
                  />
                  <span>충돌 필드도 강제 복원 (이후 변경분 덮어씀 — 주의)</span>
                </label>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void runRollback();
            }}
            disabled={running || loading || !preview}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}
            Rollback
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}