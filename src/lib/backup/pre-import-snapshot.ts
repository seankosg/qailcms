import { toast } from "sonner";
import { createPreImportSnapshot } from "./backup.functions";

export type PreImportModule = "abd" | "sm" | "tm" | "spare-part";

const DEFAULT_SOFT_TIMEOUT_MS = 15000;

export async function takePreImportSnapshot(
  module: PreImportModule,
  importLogId?: string,
) {
  return await createPreImportSnapshot({ data: { module, import_log_id: importLogId } });
}

/**
 * 사전 스냅샷을 생성하면서 진행 상태를 toast로 알려줍니다.
 * softTimeoutMs(기본 15초) 안에 스냅샷이 완료되지 않으면 "timeout"을 반환하고
 * 임포트를 먼저 진행할 수 있도록 합니다. 스냅샷은 백그라운드에서 계속 완료됩니다.
 */
export async function takePreImportSnapshotWithFeedback(
  module: PreImportModule,
  opts?: { importLogId?: string; softTimeoutMs?: number },
): Promise<"ok" | "failed" | "timeout"> {
  const { importLogId, softTimeoutMs = DEFAULT_SOFT_TIMEOUT_MS } = opts ?? {};

  const toastId = toast.loading("임포트 준비 중: 사전 스냅샷 생성…");

  const snapPromise = createPreImportSnapshot({
    data: { module, import_log_id: importLogId },
  })
    .then(() => "ok" as const)
    .catch((err) => ({ error: err as Error }));

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), softTimeoutMs);
  });

  const raceResult = await Promise.race([snapPromise, timeoutPromise]);

  if (raceResult === "timeout") {
    toast.warning("스냅샷 생성이 지연되어 임포트를 먼저 시작합니다", { id: toastId });
    // 스냅샷이 완료되면 백그라운드에서 결과만 조용히 알려줍니다.
    void snapPromise.then((result) => {
      if (result === "ok") {
        toast.success("사전 스냅샷 생성 완료 (백그라운드)");
      } else if (typeof result === "object" && "error" in result) {
        toast.warning(`사전 스냅샷 생성 실패: ${result.error.message}`);
      }
    });
    return "timeout";
  }

  if (typeof raceResult === "object" && "error" in raceResult) {
    toast.warning(
      `사전 스냅샷 생성 실패: ${raceResult.error.message}. 임포트는 계속 진행합니다.`,
      { id: toastId },
    );
    return "failed";
  }

  toast.success("사전 스냅샷 생성 완료", { id: toastId });
  return "ok";
}
