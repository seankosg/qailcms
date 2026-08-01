import { toast } from "sonner";
import { enqueuePreImportSnapshot } from "./backup.functions";

export type PreImportModule = "abd" | "sm" | "tm" | "spl";

/**
 * 사전 스냅샷을 백그라운드 잡으로 큐잉합니다. 큐 등록 자체는 1-2초 내에 끝나며,
 * 실제 스냅샷 생성은 서버 크론/러너가 이어서 수행합니다.
 */
export async function takePreImportSnapshot(
  module: PreImportModule,
  importLogId?: string,
) {
  return await enqueuePreImportSnapshot({ data: { module, import_log_id: importLogId } });
}

/**
 * 사전 스냅샷을 큐에 등록하면서 토스트로 상태를 알려줍니다.
 * 반환값은 `"queued"`(정상 접수) 또는 `"failed"`(접수 실패, 임포트는 계속 진행) 입니다.
 * `"ok"`/`"timeout"`은 이전 API와의 호환을 위해 남겨둡니다.
 */
export async function takePreImportSnapshotWithFeedback(
  module: PreImportModule,
  opts?: { importLogId?: string; softTimeoutMs?: number },
): Promise<"ok" | "failed" | "timeout" | "queued"> {
  const { importLogId } = opts ?? {};
  const toastId = toast.loading("임포트 준비 중: 사전 스냅샷 요청…");

  try {
    await enqueuePreImportSnapshot({
      data: { module, import_log_id: importLogId },
    });
    toast.success("사전 스냅샷을 백그라운드에서 준비합니다", { id: toastId });
    return "queued";
  } catch (err) {
    toast.warning(
      `사전 스냅샷 접수 실패: ${(err as Error).message}. 임포트는 계속 진행합니다.`,
      { id: toastId },
    );
    return "failed";
  }
}