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
  localValidationClean: true,
  localValidationBlockerCount: 0,
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
    for (const m of [
      "Failed to fetch",
      "network error",
      "request timeout",
      "connection reset by peer",
      "OCS_IMPORT_STAGE[import_unconfirmed]: Failed to fetch",
    ]) {
      const f = classifyImportFailure(new Error(m));
      expect(f.kind).toBe("unknown");
      expect(f.retryAllowed).toBe(false);
    }
  });

  it("트랜잭션 롤백 확인 시에만 재시도 허용", () => {
    const f = classifyImportFailure(
      new Error("OCS_IMPORT_STAGE[transactional_import]: abd_ocs_inc_import: boom"),
    );
    expect(f.kind).toBe("confirmed_rollback");
    expect(f.retryAllowed).toBe(true);
  });

  it("timeout 후 commit 흔적 0건이어도 unknown 유지 (자동 강등 금지)", () => {
    // 서버는 커밋 흔적 조회 결과와 무관하게 import_unconfirmed 단계를 유지한다.
    const f = classifyImportFailure(
      new Error("OCS_IMPORT_STAGE[import_unconfirmed]: request timeout (comment_groups count 0)"),
    );
    expect(f.kind).toBe("unknown");
    expect(f.stage).toBe("import_unconfirmed");
    expect(f.kind).not.toBe("confirmed_rollback");
  });

  it("unknown 은 재시도 금지 안내", () => {
    const f = classifyImportFailure(new Error("OCS_IMPORT_STAGE[import_unconfirmed]: socket hang up"));
    expect(f.retryAllowed).toBe(false);
    expect(f.nextStep).toContain("Do not retry");
  });

  it("명시적 DB 오류 응답 → confirmed_rollback · 재시도 허용", () => {
    const f = classifyImportFailure(
      new Error('OCS_IMPORT_STAGE[transactional_import]: abd_ocs_inc_import: 42P01 relation does not exist'),
    );
    expect(f.kind).toBe("confirmed_rollback");
    expect(f.retryAllowed).toBe(true);
  });

  it("6. 서버 로그 success + 숫자 항등식 정상 → Step 8 완료", () => {
    const ev = evaluateImportSuccess({
      import_log_id: "log-1",
      import_log_status: "success",
      verify: {
        cache_mismatch_items: 0,
        attachment_dup_pairs: 0,
        attachments_unresolved: 0,
        compliance_user_lost: 0,
      },
      result: okResult(),
    });
    expect(ev).toEqual({ complete: true, reasons: [] });
  });

  it("숫자 항등식 한 쌍 불일치 → 미완료", () => {
    const bad = okResult();
    (bad["v3"] as Record<string, unknown>)["abd_links_upserted"] = 664;
    const ev = evaluateImportSuccess({
      import_log_status: "success",
      verify: { cache_mismatch_items: 0, attachment_dup_pairs: 0, attachments_unresolved: 0 },
      result: bad,
    });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.some((r) => r.includes("staged_abd_associations"))).toBe(true);
  });

  it("0 이어야 하는 identities 가 0 이 아니면 미완료", () => {
    const bad = okResult();
    ((bad["v3"] as Record<string, unknown>)["identities"] as Record<string, unknown>)[
      "duplicate_attachment_comment_pairs"
    ] = 3;
    const ev = evaluateImportSuccess({
      import_log_status: "success",
      verify: { cache_mismatch_items: 0, attachment_dup_pairs: 0, attachments_unresolved: 0 },
      result: bad,
    });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.some((r) => r.includes("duplicate_attachment_comment_pairs"))).toBe(true);
  });

  it("result 존재만으로 완료 처리하지 않는다", () => {
    const ev = evaluateImportSuccess({ import_log_id: "log-1", result: {} });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.length).toBeGreaterThan(0);
  });

  it("항등식 값 누락 · 보호 해시 변경 · cache mismatch 를 각각 잡는다", () => {
    const ev = evaluateImportSuccess({
      import_log_status: "success",
      verify: { cache_mismatch_items: 2, attachment_dup_pairs: 0, attachments_unresolved: 0 },
      result: {
        outside_scope_comment_hash_before: "a",
        outside_scope_comment_hash_after: "z",
        outside_scope_link_hash_before: "b",
        outside_scope_link_hash_after: "b",
        v3: { identities: {} },
      },
    });
    expect(ev.complete).toBe(false);
    expect(ev.reasons.some((r) => r.includes("cache mismatch"))).toBe(true);
    expect(ev.reasons.some((r) => r.includes("보호 해시가 변경"))).toBe(true);
    expect(ev.reasons.some((r) => r.includes("항등식 값 누락"))).toBe(true);
  });
});

/** 2026-08-09 복구 성공 run 과 동일한 형태의 실제 숫자 identities */
function okResult(): Record<string, unknown> {
  return {
    outside_scope_comment_hash_before: "a",
    outside_scope_comment_hash_after: "a",
    outside_scope_link_hash_before: "b",
    outside_scope_link_hash_after: "b",
    v3: {
      groups_upserted: 185,
      comments_inserted: 333,
      comments_updated: 0,
      abd_links_upserted: 666,
      attachment_links: 667,
      response_segments: 26,
      identities: {
        staged_groups: 185,
        staged_active_comments: 333,
        active_comments_in_db: 333,
        staged_abd_associations: 666,
        staged_response_segments: 26,
        expected_attachment_links: 667,
        present_attachment_links: 667,
        unresolved_abd_numbers: 0,
        duplicate_active_source_comment_id: 0,
        duplicate_attachment_comment_pairs: 0,
      },
    },
  };
}

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
