// ABD OCS 증분 Import — 서버 최종 관문 (Baseline 정합 + Storage 충돌 재검증).
// 클라이언트 precheck 결과는 신뢰하지 않는다. 여기서 서버가 다시 계산·대조한다.
import {
  BASELINE_CORE_TABLES,
  BASELINE_SCHEMA_VERSION,
  computeBaselineId,
} from "@/lib/abd/ocs-baseline-shared";

export type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

export type BaselineClaim = {
  base_baseline_id: string;
  base_core_hash: string;
  base_core_table_hashes: Record<string, string>;
  base_import_run_id: string;
};

export type BaselineGateResult = {
  core_hash_current: string;
  core_table_hashes_current: Record<string, string>;
  baseline_id_expected: string;
};

/** 패키지 manifest 계약 — Core 8개 테이블 해시가 정확히 모두, 공백 없이 존재해야 한다. */
export function assertCoreTableHashContract(hashes: Record<string, string>): void {
  const keys = Object.keys(hashes ?? {});
  if (keys.length === 0) throw new Error("BASELINE_CONTRACT: base_core_table_hashes 가 없습니다.");
  const missing = BASELINE_CORE_TABLES.filter((t) => !keys.includes(t));
  const extra = keys.filter((k) => !(BASELINE_CORE_TABLES as readonly string[]).includes(k));
  const blank = BASELINE_CORE_TABLES.filter((t) => !String(hashes[t] ?? "").trim());
  if (missing.length || extra.length || blank.length) {
    throw new Error(
      `BASELINE_CONTRACT: core table hashes 계약 위반 (누락 ${missing.join(",") || "없음"} / 추가 ${
        extra.join(",") || "없음"
      } / 공백 ${blank.join(",") || "없음"})`,
    );
  }
}

/**
 * Import 직전 서버 정본 재계산 — core hash · 테이블별 hash · baseline_id · lineage.
 * 하나라도 불일치하면 Import RPC 호출 전에 예외로 차단한다.
 */
export async function assertBaselineGate(
  rpc: RpcFn,
  claim: BaselineClaim,
): Promise<BaselineGateResult> {
  assertCoreTableHashContract(claim.base_core_table_hashes);
  if (!claim.base_baseline_id) throw new Error("BASELINE_CONTRACT: base_baseline_id 가 없습니다.");
  if (!claim.base_core_hash) throw new Error("BASELINE_CONTRACT: base_core_hash 가 없습니다.");
  if (!claim.base_import_run_id)
    throw new Error("BASELINE_CONTRACT: base_import_run_id 가 없습니다.");

  const baseline = ((await rpc("abd_ocs_inc_baseline", {
    p_base_import_run_id: claim.base_import_run_id,
  })) ?? {}) as Record<string, unknown>;
  if (baseline["base_import_run_found"] !== true) {
    throw new Error("BASELINE_LINEAGE: base_import_run_id 를 운영 정본에서 찾을 수 없습니다.");
  }
  if (baseline["is_latest"] !== true) {
    throw new Error("BASELINE_LINEAGE: 패키지 Baseline 이 최신 정본 Import 가 아닙니다.");
  }

  const core = ((await rpc("abd_ocs_baseline_core_hash")) ?? {}) as Record<string, unknown>;
  const currentCoreHash = String(core["core_hash"] ?? "").toLowerCase();
  const currentTables = (core["core_table_hashes"] ?? {}) as Record<string, string>;
  if (!currentCoreHash) throw new Error("BASELINE_GATE: 서버 core hash 를 계산하지 못했습니다.");

  if (currentCoreHash !== claim.base_core_hash.toLowerCase()) {
    throw new Error(
      `BASELINE_STALE: 현재 core hash 가 패키지 base_core_hash 와 다릅니다 (${currentCoreHash.slice(
        0,
        16,
      )} ≠ ${claim.base_core_hash.slice(0, 16)}).`,
    );
  }

  const mismatched = BASELINE_CORE_TABLES.filter(
    (t) =>
      String(currentTables[t] ?? "").toLowerCase() !==
      String(claim.base_core_table_hashes[t] ?? "").toLowerCase(),
  );
  if (mismatched.length) {
    throw new Error(`BASELINE_STALE: core 테이블 해시 불일치 — ${mismatched.join(", ")}`);
  }

  const expected = await computeBaselineId(
    BASELINE_SCHEMA_VERSION,
    currentCoreHash,
    claim.base_import_run_id,
  );
  if (expected !== claim.base_baseline_id) {
    throw new Error(
      `BASELINE_ID_MISMATCH: 서버 재계산 baseline_id 가 패키지 값과 다릅니다 (${expected.slice(
        0,
        16,
      )} ≠ ${claim.base_baseline_id.slice(0, 16)}).`,
    );
  }

  return {
    core_hash_current: currentCoreHash,
    core_table_hashes_current: currentTables,
    baseline_id_expected: expected,
  };
}
