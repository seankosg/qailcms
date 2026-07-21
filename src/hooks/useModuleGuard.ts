import { useCallback, useState } from "react";
import {
  evaluateFilesForModule,
  type FileEvaluation,
  type ModuleId,
} from "@/lib/import/module-fingerprint";

/**
 * 임포트 페이지에서 파일 선택 직후 헤더 지문 검사를 수행하고,
 * 필요 시 확인 다이얼로그를 노출한다.
 *
 * 사용:
 *   const guard = useModuleGuard("tm", (files) => addFiles(files));
 *   ... onDrop → guard.receive(files)
 *   ... <ModuleGuardDialog {...guard.dialogProps} />
 */
export function useModuleGuard(
  moduleId: ModuleId,
  onAccepted: (files: File[]) => void,
) {
  const [evaluations, setEvaluations] = useState<FileEvaluation[]>([]);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const receive = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setChecking(true);
      try {
        const results = await evaluateFilesForModule(moduleId, files);
        const hasIssue = results.some(
          (r) =>
            r.evaluation.verdict === "block" ||
            r.evaluation.verdict === "ambiguous",
        );
        if (!hasIssue) {
          onAccepted(files);
          return;
        }
        setEvaluations(results);
        setOpen(true);
      } finally {
        setChecking(false);
      }
    },
    [moduleId, onAccepted],
  );

  const handleConfirm = useCallback(
    (accepted: File[]) => {
      setOpen(false);
      setEvaluations([]);
      if (accepted.length > 0) onAccepted(accepted);
    },
    [onAccepted],
  );

  const handleCancel = useCallback(() => {
    setOpen(false);
    setEvaluations([]);
  }, []);

  return {
    receive,
    checking,
    dialogProps: {
      open,
      target: moduleId,
      evaluations,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}