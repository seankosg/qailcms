import { describe, expect, it } from "vitest";
import {
  assertApplyAllowed,
  assertSystemAdmin,
  buildRestoreConfirmation,
} from "../safe-restore-guards";
import {
  canStartNewRun,
  classifyApplyResponse,
  classifyApplyThrow,
  deriveWizardState,
  isConfirmedRollback,
  type RestoreRunStatusView,
} from "../safe-restore-ui";
import { planPreImportCleanup, planRetentionCleanup } from "../retention";

const rpcOk = (value: unknown) => ({ rpc: async () => ({ data: value, error: null }) });

function view(partial: Partial<RestoreRunStatusView>): RestoreRunStatusView {
  return {
    run_id: "11111111-2222-3333-4444-555555555555",
    status: "preflight_clean",
    requested_scope: "abd",
    confirmation_phrase: "RESTORE abd 11111111",
    snapshot_id: "snap-1",
    safety_snapshot_id: null,
    staging_overall_digest: null,
    staging_verify: null,
    apply_result: null,
    apply_attempted: false,
    error_code: null,
    error_message: null,
    ...partial,
  };
}

describe("HP4 · 권한 및 확인 문자열 관문", () => {
  it("1. System Administrator 가 아니면 차단한다", async () => {
    await expect(assertSystemAdmin(rpcOk(false) as any, "u1")).rejects.toThrow(/System Administrator/);
    await expect(assertSystemAdmin(rpcOk(true) as any, "u1")).resolves.toBeUndefined();
  });

  it("2. 확인 문자열이 서버 계산과 다르면 차단한다", () => {
    const run = {
      id: "11111111-2222-3333-4444-555555555555",
      status: "staging_verified",
      requested_scope: "abd",
      staging_overall_digest: "d1",
      safety_snapshot_id: "s1",
    };
    expect(() =>
      assertApplyAllowed(run, { confirmation: "RESTORE abd 1111111", expected_overall_digest: "d1" }),
    ).toThrow("RESTORE_CONFIRMATION_MISMATCH");
    expect(() =>
      assertApplyAllowed(run, {
        confirmation: buildRestoreConfirmation("abd", run.id),
        expected_overall_digest: "d1",
      }),
    ).not.toThrow();
    // 지문·안전 스냅샷·상태도 서버 기록으로 재검증한다.
    expect(() =>
      assertApplyAllowed(run, {
        confirmation: buildRestoreConfirmation("abd", run.id),
        expected_overall_digest: "other",
      }),
    ).toThrow("RESTORE_STAGING_DIGEST_MISMATCH");
    expect(() =>
      assertApplyAllowed({ ...run, safety_snapshot_id: null }, {
        confirmation: buildRestoreConfirmation("abd", run.id),
        expected_overall_digest: "d1",
      }),
    ).toThrow("RESTORE_SAFETY_SNAPSHOT_MISSING");
    expect(() =>
      assertApplyAllowed({ ...run, status: "applying" }, {
        confirmation: buildRestoreConfirmation("abd", run.id),
        expected_overall_digest: "d1",
      }),
    ).toThrow(/RESTORE_APPLY_NOT_CLAIMABLE/);
  });
});

describe("HP4 · 반영 결과 판정", () => {
  it("3. applyFn throw 는 메시지와 무관하게 미확정이다", () => {
    for (const msg of ["Failed to fetch", "RESTORE_APPLY_FAILED: rolled back", "boom"]) {
      expect(classifyApplyThrow(new Error(msg)).kind).toBe("unknown");
    }
    expect(classifyApplyResponse({ ok: true }).kind).toBe("success");
    expect(classifyApplyResponse({ state: "unknown", code: "X" }).kind).toBe("unknown");
    expect(classifyApplyResponse({ ok: false }).kind).toBe("unknown");
  });

  it("4. confirmed rollback 은 서버 apply_failed + 오류 기록에서만 표시한다", () => {
    expect(isConfirmedRollback(view({ status: "apply_failed", error_code: "E1" }))).toBe(true);
    expect(isConfirmedRollback(view({ status: "apply_failed" }))).toBe(false);
    expect(isConfirmedRollback(view({ status: "applying", error_code: "E1" }))).toBe(false);
    expect(deriveWizardState(view({ status: "apply_failed", error_code: "E1" })).resultKind).toBe("rollback");
    expect(deriveWizardState(view({ status: "apply_failed" })).resultKind).toBe("unknown");
  });
});

describe("HP4 · 새로고침 후 단계 복원", () => {
  it("5. staging_verified 단계를 복원한다", () => {
    const noSafety = deriveWizardState(view({ status: "staging_verified", staging_overall_digest: "d1" }));
    expect(noSafety.phase).toBe("safety");
    expect(noSafety.allowSafety).toBe(true);

    const withSafety = view({
      status: "staging_verified",
      staging_overall_digest: "d1",
      safety_snapshot_id: "s1",
    });
    expect(deriveWizardState(withSafety).phase).toBe("review");
    // 이전 apply 요청 여부 미확정 → 상태 재확인만 허용
    expect(deriveWizardState(withSafety).allowApply).toBe(false);
    expect(deriveWizardState(withSafety, { recheckedInSession: true }).allowApply).toBe(true);
  });

  it("6. success 결과를 복원한다", () => {
    const st = deriveWizardState(view({ status: "success", apply_attempted: true }));
    expect(st.phase).toBe("result");
    expect(st.resultKind).toBe("success");
  });

  it("추가: preflight_clean / staging 단계 복원", () => {
    expect(deriveWizardState(view({ status: "preflight_clean" })).allowStage).toBe(true);
    const staging = deriveWizardState(view({ status: "staging" }));
    expect(staging.phase).toBe("staging_running");
    expect(staging.allowStage).toBe(false);
  });
});

describe("HP4 · 새 작업 시작 허용/금지", () => {
  it("7. applying·미확정에서는 새 작업과 재실행을 차단한다", () => {
    const applying = view({ status: "applying", apply_attempted: true });
    expect(deriveWizardState(applying).unresolved).toBe(true);
    expect(deriveWizardState(applying).allowApply).toBe(false);
    expect(canStartNewRun(applying)).toBe(false);
    expect(canStartNewRun(view({ status: "success" }), true)).toBe(false);
    // 안전 스냅샷 결속 후 결과 미확정 상태도 금지
    expect(
      canStartNewRun(view({ status: "staging_verified", staging_overall_digest: "d", safety_snapshot_id: "s" })),
    ).toBe(false);
  });

  it("8. preflight_blocked / success / apply_failed 에서는 새 작업을 허용한다", () => {
    expect(canStartNewRun(view({ status: "preflight_blocked" }))).toBe(true);
    expect(canStartNewRun(view({ status: "success", apply_attempted: true }))).toBe(true);
    expect(canStartNewRun(view({ status: "apply_failed", error_code: "E1", apply_attempted: true }))).toBe(true);
    // 반영을 시도한 기록이 있는 failed 는 금지
    expect(canStartNewRun(view({ status: "failed", apply_attempted: true }))).toBe(false);
    expect(canStartNewRun(view({ status: "failed" }))).toBe(true);
  });
});

describe("HP4 · 선행 스냅샷 정책(9083c2bd)", () => {
  const base = (over: Partial<any>) => ({
    id: "x",
    created_at: new Date().toISOString(),
    size_bytes: 10,
    ...over,
  });

  it("9. 신규 Snapshot 은 기본 잠금해제로 기록된다", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/backup/backup-core.server.ts", "utf8"),
    );
    expect(src).toMatch(/is_locked: false/);
  });

  it("10. 잠금해제 pre-import 는 24시간 후 정리되고 잠금된 항목은 보존된다", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    const old = new Date(now - 25 * 3600 * 1000).toISOString();
    const fresh = new Date(now - 2 * 3600 * 1000).toISOString();
    const plan = planPreImportCleanup(
      [
        base({ id: "a", triggered_by: "pre-import", created_at: old, is_locked: false }),
        base({ id: "b", triggered_by: "pre-import", created_at: old, is_locked: true }),
        base({ id: "c", triggered_by: "pre-import", created_at: fresh }),
        base({ id: "d", triggered_by: "manual", created_at: old }),
        base({ id: "e", triggered_by: "scheduled", created_at: old }),
      ],
      { now },
    );
    expect(plan.candidates.map((s) => s.id)).toEqual(["a"]);
    expect(plan.locked_excluded_count).toBe(1);
  });

  it("일반·정기 보관정책은 변경되지 않는다", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    const oldDate = (d: number) => new Date(now - d * 86400000).toISOString();
    const plan = planRetentionCleanup(
      [
        base({ id: "1", created_at: oldDate(40) }),
        base({ id: "2", created_at: oldDate(39) }),
        base({ id: "3", created_at: oldDate(38) }),
        base({ id: "4", created_at: oldDate(1) }),
      ],
      { retentionDays: 30, keepMinimum: 3, now },
    );
    expect(plan.candidates.map((s) => s.id)).toEqual(["1"]);
  });
});

describe("HP4 최종 · apply 시도 영구 기록", () => {
  const stagingVerified = {
    id: "11111111-2222-3333-4444-555555555555",
    status: "staging_verified",
    requested_scope: "abd",
    staging_overall_digest: "d1",
    safety_snapshot_id: "s1",
  };
  const input = {
    confirmation: buildRestoreConfirmation("abd", stagingVerified.id),
    expected_overall_digest: "d1",
  };

  it("11. apply claim 은 1회만 성공한다", () => {
    // 1회차: 요청 기록 없음 → 허용
    expect(() => assertApplyAllowed(stagingVerified, input)).not.toThrow();
    // 2회차: 통신 오류 후에도 apply_requested_at 이 남아 재시도 차단
    expect(() =>
      assertApplyAllowed({ ...stagingVerified, apply_requested_at: "2026-08-25T00:00:00Z" }, input),
    ).toThrow("RESTORE_APPLY_ALREADY_REQUESTED");
  });

  it("12. staging_verified + apply_requested_at 은 미확정으로 판정한다", () => {
    const v = view({
      status: "staging_verified",
      staging_overall_digest: "d1",
      safety_snapshot_id: "s1",
      apply_requested_at: "2026-08-25T00:00:00Z",
      apply_attempted: true,
    });
    const st = deriveWizardState(v, { recheckedInSession: true });
    expect(st.resultKind).toBe("unknown");
    expect(st.unresolved).toBe(true);
    expect(st.allowApply).toBe(false);
    expect(canStartNewRun(v)).toBe(false);
  });

  it("13. success / apply_failed 만 최종 상태로 표시한다", () => {
    expect(
      deriveWizardState(view({ status: "success", apply_attempted: true, apply_requested_at: "t" })).resultKind,
    ).toBe("success");
    expect(
      deriveWizardState(
        view({ status: "apply_failed", error_code: "E1", apply_attempted: true, apply_requested_at: "t" }),
      ).resultKind,
    ).toBe("rollback");
  });
});

describe("HP4 최종 · 보관정책 분리", () => {
  it("14. 다수의 최신 pre-import Snapshot 이 일반 최소보관 계산을 바꾸지 않는다", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    const at = (d: number) => new Date(now - d * 86400000).toISOString();
    const regular = [
      { id: "r1", created_at: at(40), size_bytes: 1 },
      { id: "r2", created_at: at(39), size_bytes: 1 },
      { id: "r3", created_at: at(38), size_bytes: 1 },
      { id: "r4", created_at: at(1), size_bytes: 1 },
    ];
    const preImports = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      created_at: at(0),
      size_bytes: 1,
      triggered_by: "pre-import",
    }));
    const mixed = [...regular, ...preImports];
    const opts = { retentionDays: 30, keepMinimum: 3, now };
    // 정본 계약: 일반·정기 계산에는 pre-import 를 넣지 않는다.
    const onlyRegular = planRetentionCleanup(
      mixed.filter((s: any) => s.triggered_by !== "pre-import"),
      opts,
    );
    expect(onlyRegular.candidates.map((s) => s.id)).toEqual(["r1"]);
    expect(planPreImportCleanup(mixed, { now }).candidates).toEqual([]);
  });

  it("15. 자동·큐 Snapshot 경로에서 cleanup 을 await 하고 실패해도 성공을 뒤집지 않는다", async () => {
    const fs = await import("node:fs/promises");
    for (const f of [
      "src/routes/api/public/backup/auto-snapshot.ts",
      "src/routes/api/public/backup/run-queued-snapshot.ts",
    ]) {
      const src = await fs.readFile(f, "utf8");
      expect(src).toMatch(/await core\.cleanupOldSnapshots\(supabaseAdmin\)/);
      expect(src).not.toMatch(/core\.cleanupOldSnapshots\(supabaseAdmin\)\.catch/);
      expect(src).toMatch(/cleanup_failed/);
    }
  });
});

describe("HP4 최종 · 새로고침 dependency 복원", () => {
  it("16. 새로고침 전후 대상 표·자동 포함 표·예상 행수가 동일하다", async () => {
    const { hydrateWizardPreflight } = await import("../safe-restore-ui");
    const before = {
      preflight: {
        dependency: {
          final_restore_tables: ["abd_items_raw", "abd_comments"],
          auto_included_tables: ["abd_comments"],
          keep_current_parent_tables: ["profiles"],
          required_parent_tables: ["profiles"],
        },
        expected_rows: { abd_items_raw: 12 },
      },
    };
    const serverStatus = {
      run_id: "r",
      final_restore_tables: before.preflight.dependency.final_restore_tables,
      auto_included_tables: before.preflight.dependency.auto_included_tables,
      keep_current_parent_tables: before.preflight.dependency.keep_current_parent_tables,
      required_parent_tables: before.preflight.dependency.required_parent_tables,
      expected_rows: before.preflight.expected_rows,
      preflight_summary: { blockers: [], warnings: [] },
    };
    const after = hydrateWizardPreflight(serverStatus);
    expect(after.preflight.dependency).toEqual(before.preflight.dependency);
    expect(after.preflight.expected_rows).toEqual(before.preflight.expected_rows);
  });
});
