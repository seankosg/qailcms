import { useCallback, useState } from "react";
import {
  evaluateAbdSourceFiles,
  type AbdSourceFileEval,
} from "@/lib/abd/source-fingerprint";

type Mode = "hdec" | "aconex";

interface Options {
  mode: Mode;
  /** 소스가 현재 모드와 일치할 때 호출. */
  onAccepted: (files: File[]) => void;
  /** 사용자가 다른 모드로 전환하기로 결정했을 때 호출. */
  onSwitchMode: (target: Mode, files: File[]) => void;
}

/**
 * ABD 임포트 페이지에서 파일 선택 직후 HDEC/Aconex 소스 지문 검사를 수행.
 * 모든 파일이 현재 모드와 일치하면 즉시 통과, 아니면 다이얼로그 노출.
 */
export function useAbdSourceGuard(opts: Options) {
  const [evaluations, setEvaluations] = useState<AbdSourceFileEval[]>([]);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const receive = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setChecking(true);
      try {
        const evals = await evaluateAbdSourceFiles(files);
        const allMatch = evals.every((e) => e.result.source === opts.mode);
        if (allMatch) {
          opts.onAccepted(files);
          return;
        }
        setEvaluations(evals);
        setOpen(true);
      } finally {
        setChecking(false);
      }
    },
    [opts],
  );

  const handleAcceptMatched = useCallback(
    (files: File[]) => {
      setOpen(false);
      setEvaluations([]);
      if (files.length > 0) opts.onAccepted(files);
    },
    [opts],
  );

  const handleSwitch = useCallback(
    (target: Mode, files: File[]) => {
      setOpen(false);
      setEvaluations([]);
      opts.onSwitchMode(target, files);
    },
    [opts],
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
      mode: opts.mode,
      evaluations,
      onAcceptMatched: handleAcceptMatched,
      onSwitchMode: handleSwitch,
      onCancel: handleCancel,
    },
  };
}