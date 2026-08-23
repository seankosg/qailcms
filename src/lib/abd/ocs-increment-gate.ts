// ABD OCS 증분 Import — 서버 최종 관문 (Baseline 정합 + Storage 충돌 재검증).
// 클라이언트 precheck 결과는 신뢰하지 않는다. 여기서 서버가 다시 계산·대조한다.
import { computeBaselineIdCandidates } from "@/lib/abd/ocs-baseline-shared";

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

// manifest 정적 계약(core 8개 테이블 해시 전수)은 브라우저 로컬 검증으로 이관했다.
// (ocs-local-validation.ts · MANIFEST_CORE_TABLE_CONTRACT)

/**
 * Import 직전 서버 정본 재계산 — core hash · 테이블별 hash · baseline_id · lineage.
 * 하나라도 불일치하면 Import RPC 호출 전에 예외로 차단한다.
 */
export async function assertBaselineGate(
  rpc: RpcFn,
  claim: BaselineClaim,
): Promise<BaselineGateResult> {
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

  // 테이블별 해시 전수 대조는 브라우저(BASELINE_TABLE_HASH_MISMATCH)로 이관.
  // 서버는 core_hash 단일 대조(위)로 운영 정본 변경 여부만 판정한다.
  // v1/v2 Baseline 계약 모두 읽기 호환 — 산식은 동일하고 schema_version 만 다르다.
  const cand = await computeBaselineIdCandidates(currentCoreHash, claim.base_import_run_id);
  // 신규 정본은 v1 — 표시용 expected 는 항상 v1 산식 값 (v2 는 읽기 호환 후보로만 인정).
  const expected = cand.v1;
  if (!cand.all.includes(claim.base_baseline_id)) {
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
