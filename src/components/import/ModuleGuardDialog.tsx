import { useMemo, useState } from "react";
import { AlertTriangle, XCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  MODULE_LABELS,
  MODULE_IMPORT_ROUTES,
  type FileEvaluation,
  type ModuleId,
} from "@/lib/import/module-fingerprint";

interface Props {
  open: boolean;
  target: ModuleId;
  evaluations: FileEvaluation[];
  onCancel: () => void;
  onConfirm: (acceptedFiles: File[]) => void;
}

/**
 * 파일 헤더 지문 판정 결과 확인 다이얼로그.
 * - block: 표시만 하고 임포트 대상에서 제외
 * - ambiguous: 사용자가 체크 후 계속 진행 가능
 * - ok: 자동 통과
 */
export function ModuleGuardDialog({
  open,
  target,
  evaluations,
  onCancel,
  onConfirm,
}: Props) {
  const [confirmAmbiguous, setConfirmAmbiguous] = useState(false);

  const blocked = useMemo(
    () => evaluations.filter((e) => e.evaluation.verdict === "block"),
    [evaluations],
  );
  const ambiguous = useMemo(
    () => evaluations.filter((e) => e.evaluation.verdict === "ambiguous"),
    [evaluations],
  );
  const ok = useMemo(
    () => evaluations.filter((e) => e.evaluation.verdict === "ok"),
    [evaluations],
  );

  const suggestedTarget = useMemo(() => {
    const first = blocked[0]?.evaluation.detected;
    if (first && first !== target) return first;
    return null;
  }, [blocked, target]);

  const handleConfirm = () => {
    const accepted: File[] = [];
    for (const e of ok) accepted.push(e.file);
    if (confirmAmbiguous) {
      for (const e of ambiguous) accepted.push(e.file);
    }
    onConfirm(accepted);
    setConfirmAmbiguous(false);
  };

  const handleCancel = () => {
    setConfirmAmbiguous(false);
    onCancel();
  };

  const canProceed =
    ok.length > 0 || (ambiguous.length > 0 && confirmAmbiguous);

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? handleCancel() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>임포트 파일 사전 검증</DialogTitle>
          <DialogDescription>
            {MODULE_LABELS[target]} 임포트 화면에 업로드된 파일의 헤더 지문
            판정 결과입니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {blocked.length > 0 && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-medium">
                <XCircle className="h-4 w-4" /> 차단된 파일 ({blocked.length})
              </div>
              <ul className="space-y-2 text-sm">
                {blocked.map((b, i) => (
                  <li key={i} className="space-y-1">
                    <div className="font-medium">{b.file.name}</div>
                    <div className="text-muted-foreground">
                      {b.evaluation.reason}
                    </div>
                    {b.evaluation.hint && (
                      <div className="text-muted-foreground">
                        {b.evaluation.hint}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {suggestedTarget && (
                <div className="pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to={MODULE_IMPORT_ROUTES[suggestedTarget].split("?")[0] as string}
                      search={
                        (Object.fromEntries(
                          new URLSearchParams(
                            MODULE_IMPORT_ROUTES[suggestedTarget].split("?")[1] ?? "",
                          ),
                        ) as never)
                      }
                    >
                      {MODULE_LABELS[suggestedTarget]} 임포트로 이동
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}

          {ambiguous.length > 0 && (
            <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium">
                <AlertTriangle className="h-4 w-4" /> 확인 필요 (
                {ambiguous.length})
              </div>
              <ul className="space-y-2 text-sm">
                {ambiguous.map((b, i) => (
                  <li key={i} className="space-y-1">
                    <div className="font-medium">{b.file.name}</div>
                    <div className="text-muted-foreground">
                      {b.evaluation.reason}
                    </div>
                  </li>
                ))}
              </ul>
              <label className="flex items-center gap-2 pt-1 text-sm cursor-pointer">
                <Checkbox
                  checked={confirmAmbiguous}
                  onCheckedChange={(v) => setConfirmAmbiguous(v === true)}
                />
                {MODULE_LABELS[target]} 파일이 확실합니다. 그대로 진행합니다.
              </label>
            </div>
          )}

          {ok.length > 0 && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-medium">
                <CheckCircle2 className="h-4 w-4" /> 통과 ({ok.length})
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5">
                {ok.map((b, i) => (
                  <li key={i}>{b.file.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            취소
          </Button>
          <Button onClick={handleConfirm} disabled={!canProceed}>
            {canProceed
              ? `${ok.length + (confirmAmbiguous ? ambiguous.length : 0)}개 파일 임포트 진행`
              : "진행 가능한 파일 없음"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}