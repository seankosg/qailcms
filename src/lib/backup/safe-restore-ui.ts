/**
 * 안전 복원 Wizard 단계 복원 정본 (클라이언트 안전, 순수 함수).
 *
 * 브라우저 state 는 정본이 아니다. 항상 getRestoreRunStatus() 반환값으로
 * 단계·허용 동작·결과 표시를 재구성한다.
 */
export type RestoreRunStatusView = {
  run_id: string;
  status: string;
  requested_scope: string;
  confirmation_phrase: string;
  snapshot_id: string | null;
  safety_snapshot_id: string | null;
  staging_overall_digest: string | null;
  staging_verify: { ok?: boolean } | null;
  apply_result: any | null;
  apply_attempted: boolean;
  error_code: string | null;
  error_message: string | null;
};

export type WizardPhase =
  | "select"
  | "stage"
  | "staging_running"
  | "safety"
  | "review"
  | "result"
  | "blocked";

export type WizardState = {
  phase: WizardPhase;
  /** 결과가 확정되지 않은 상태(재실행 금지). */
  unresolved: boolean;
  allowStage: boolean;
  allowSafety: boolean;
  allowApply: boolean;
  allowRecheck: boolean;
  canStartNew: boolean;
  resultKind: "success" | "rollback" | "unknown" | null;
  notice: string | null;
};

/** 반영 결과가 「롤백 확정」이라고 표시해도 되는 유일한 근거. */
export function isConfirmedRollback(view: Pick<RestoreRunStatusView, "status" | "error_code" | "error_message">) {
  return view.status === "apply_failed" && !!(view.error_code || view.error_message);
}

/**
 * 브라우저 예외는 DB 트랜잭션 결과를 증명하지 못한다.
 * 정상 응답 {ok:true} 만 성공, 정상 응답 {state:'unknown'} 은 미확정,
 * 그 외 모든 예외/응답은 메시지와 무관하게 미확정으로 판정한다.
 */
export function classifyApplyResponse(res: any): { kind: "success" | "unknown"; code?: string; message?: string } {
  if (res && res.ok === true) return { kind: "success" };
  if (res && res.state === "unknown") {
    return { kind: "unknown", code: res.code ?? "RESTORE_APPLY_UNKNOWN", message: res.message ?? "" };
  }
  return {
    kind: "unknown",
    code: res?.code ?? "RESTORE_APPLY_RESULT_INDETERMINATE",
    message: res?.message ?? "반영 결과를 확정할 수 없습니다.",
  };
}

export function classifyApplyThrow(err: unknown): { kind: "unknown"; code: string; message: string } {
  return {
    kind: "unknown",
    code: "RESTORE_APPLY_RESULT_INDETERMINATE",
    message: (err as Error)?.message ?? "요청 중 오류가 발생했습니다.",
  };
}

export function deriveWizardState(
  view: RestoreRunStatusView | null,
  opts?: { recheckedInSession?: boolean },
): WizardState {
  const base: WizardState = {
    phase: "select",
    unresolved: false,
    allowStage: false,
    allowSafety: false,
    allowApply: false,
    allowRecheck: false,
    canStartNew: false,
    resultKind: null,
    notice: null,
  };
  if (!view) return base;

  const recheck = { ...base, allowRecheck: true };

  switch (view.status) {
    case "preflight_clean":
      return { ...recheck, phase: "stage", allowStage: true };

    case "staging":
      return {
        ...recheck,
        phase: "staging_running",
        notice: "준비 영역 적재가 진행 중입니다. 중복 적재는 금지되며 상태 조회만 가능합니다.",
      };

    case "staging_verified": {
      if (!view.staging_overall_digest) {
        return { ...recheck, phase: "stage", allowStage: true };
      }
      if (!view.safety_snapshot_id) return { ...recheck, phase: "safety", allowSafety: true };
      return {
        ...recheck,
        phase: "review",
        // 이전 apply 요청 여부를 확정할 수 없으면 상태 재확인만 허용한다.
        allowApply: opts?.recheckedInSession === true,
        notice:
          opts?.recheckedInSession === true
            ? null
            : "이전 반영 요청 여부를 확정할 수 없습니다. 먼저 현재 상태를 다시 확인하십시오.",
      };
    }

    case "applying":
      return {
        ...recheck,
        phase: "result",
        unresolved: true,
        resultKind: "unknown",
        notice: "복원 결과가 확정되지 않았습니다. 재실행하지 마십시오.",
      };

    case "success":
      return { ...recheck, phase: "result", resultKind: "success", canStartNew: true };

    case "apply_failed":
      return {
        ...recheck,
        phase: "result",
        resultKind: isConfirmedRollback(view) ? "rollback" : "unknown",
        unresolved: !isConfirmedRollback(view),
        canStartNew: isConfirmedRollback(view),
      };

    case "preflight_blocked":
      return { ...recheck, phase: "blocked", canStartNew: true };

    case "failed":
      // 반영을 한 번도 시도하지 않은 것이 서버 기록으로 확인될 때만 새 작업을 허용한다.
      return { ...recheck, phase: "blocked", canStartNew: view.apply_attempted !== true };

    default:
      return recheck;
  }
}

/** 새 안전 복원 시작 허용 여부. 미확정 결과에서는 항상 금지한다. */
export function canStartNewRun(
  view: RestoreRunStatusView | null,
  localUnresolved?: boolean,
): boolean {
  if (localUnresolved) return false;
  if (!view) return true;
  return deriveWizardState(view).canStartNew;
}
