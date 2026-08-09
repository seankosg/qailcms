import { describe, expect, it } from "vitest";
import {
  classifyImportFailure,
  evaluateGates,
  evaluateImportSuccess,
  type GateInput,
} from "./ocs-wizard-gates";

const baseInput: GateInput = {
  baselineVerificationImplemented: true,
  hasPackage: true,
  packageFileBlockers: [],
  collisionDone: true,
  collisionBlockers: [],
  collisionCounts: { hash_mismatch: 0, unresolved: 0 },
  duplicatePackage: false,
  duplicateRecovered: false,
  precheck: {
    baseline: { base_import_run_found: true, is_latest: true, core_changed_since_base: false },
    base_core_hash_match: true,
    baseline_id_match: true,
    mismatched_core_tables: [],
  },
  baselineIdentityOk: true,
  dry: { comments_to_update: 5, comments_unchanged: 3, comments_modified: 2 },
  dryIdentityOk: true,
  attachmentsUnresolved: 0,
  massRetire: false,
  allowRetire: false,
  retireCount: 0,
  uploadFailedCount: 0,
  verifyRan: true,
  verifyOkCount: 698,
  verifyFailureCount: 0,
  newAssetTotal: 698,
  snapshotId: "snap-1",
  approved: true,
};

describe("wizard gates", () => {
  it("1. dry-run blocker → Step 4 미완료 · Step 5 잠김", () => {
    const g = evaluateGates({ ...baseInput, dryIdentityOk: false });
    expect(g.groups.dryRunBlockers).toContain("Dry-run 항등식 불일치");
    expect(g.step4Complete).toBe(false);
    expect(g.step5Unlocked).toBe(false);
    expect(g.packageStatus).toBe("fail");
  });

  it("2. 업로드 실패 1건 → Step 6 잠김", () => {
    const g = evaluateGates({ ...baseInput, uploadFailedCount: 1 });
    expect(g.step5Complete).toBe(false);
    expect(g.step6Unlocked).toBe(false);
  });

  it("3. 서버 검증 697/698 → Step 6 잠김", () => {
    const g = evaluateGates({ ...baseInput, verifyOkCount: 697 });
    expect(g.step5Complete).toBe(false);
    expect(g.step6Unlocked).toBe(false);
    expect(g.step7Unlocked).toBe(false);
  });

  it("모두 통과하면 Step 7 활성화", () => {
    const g = evaluateGates(baseInput);
    expect(g.blockers).toEqual([]);
    expect(g.step7Unlocked).toBe(true);
    expect(g.packageStatus).toBe("pass");
  });

  it("중복·복구 패키지는 Step 4 미완료", () => {
    const g = evaluateGates({ ...baseInput, duplicatePackage: true, duplicateRecovered: true });
    expect(g.step4Complete).toBe(false);
  });

  it("4. Import RPC 성공 + post-verify 실패 → 재시도 금지", () => {
    const f = classifyImportFailure(new Error("OCS_IMPORT_STAGE[post_import_verify]: verify boom"));
    expect(f.kind).toBe("partial_or_post_verify_failure");
    expect(f.retryAllowed).toBe(false);
    expect(f.nextStep).toContain("Do not retry");
  });

  it("5. timeout/네트워크 단절 → unknown · 재시도 금지", () => {
    const f = classifyImportFailure(new Error("Failed to fetch"));
    expect(f.kind).toBe("unknown");
    expect(f.retryAllowed).toBe(false);
  });

  it("트랜잭션 롤백 확인 시에만 재시도 허용", () => {
    const f = classifyImportFailure(
      new Error("OCS_IMPORT_STAGE[transactional_import]: abd_ocs_inc_import: boom"),
    );
    expect(f.kind).toBe("confirmed_rollback");
    expect(f.retryAllowed).toBe(true);
  });

  it("6. 서버 로그 success + 항등식 통과 → Step 8 완료", () => {
    const ev = evaluateImportSuccess({
      import_log_id: "log-1",
      import_log_status: "success",
      verify: {
        cache_mismatch_items: 0,
        attachment_dup_pairs: 0,
        attachments_unresolved: 0,
        compliance_user_lost: 0,
      },
      result: {
        outside_scope_comment_hash_before: "a",
        outside_scope_comment_hash_after: "a",
        outside_scope_link_hash_before: "b",
        outside_scope_link_hash_after: "b",
        v3: { identities: { comments_balance: true, links_balance: true } },
      },
    });
    expect(ev).toEqual({ complete: true, reasons: [] });
  });

  it("result 존재만으로 완료 처리하지 않는다", () => {
    const ev = evaluateImportSuccess({ import_log_id: "log-1", result: {} });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.length).toBeGreaterThan(0);
  });

  it("항등식 실패 · 보호 해시 변경 · cache mismatch 를 각각 잡는다", () => {
    const ev = evaluateImportSuccess({
      import_log_status: "success",
      verify: { cache_mismatch_items: 2, attachment_dup_pairs: 0, attachments_unresolved: 0 },
      result: {
        outside_scope_comment_hash_before: "a",
        outside_scope_comment_hash_after: "z",
        outside_scope_link_hash_before: "b",
        outside_scope_link_hash_after: "b",
        v3: { identities: { comments_balance: false } },
      },
    });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.some((r) => r.includes("cache mismatch"))).toBe(true);
    expect(ev.reasons.some((r) => r.includes("보호 해시가 변경"))).toBe(true);
    expect(ev.reasons.some((r) => r.includes("항등식 실패"))).toBe(true);
  });
});

import { dedupeLatestReceipts, isTruncated } from "./ocs-increment-receipts";

describe("verify receipts", () => {
  it("7. 같은 path 가 서로 다른 bucket 에 있으면 2건으로 유지한다", () => {
    const out = dedupeLatestReceipts([
      { bucket: "ocs", path: "a/b.png" },
      { bucket: "ocs-source", path: "a/b.png" },
      { bucket: "ocs", path: "a/b.png" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("8. 상한 도달 시 truncated 로 표면화한다", () => {
    expect(isTruncated(20000)).toBe(true);
    expect(isTruncated(4999)).toBe(false);
  });
});
