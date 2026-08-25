import { describe, expect, it } from "vitest";
import {
  APPLY_STATUS,
  applyRestoreAtomic,
  createAndBindSafetySnapshot,
  pinStagingDigest,
  readStagingDigest,
} from "../restore-apply.server";

const RUN_ID = "22222222-2222-2222-2222-222222222222";
const DIGEST = "a".repeat(64);

type RunRow = Record<string, unknown>;

/** restore_runs 1행 + RPC 를 흉내내는 최소 관리 클라이언트. */
function fakeAdmin(opts: {
  run: RunRow | null;
  rpc?: Record<string, { data?: unknown; error?: { message: string } }>;
  updateError?: { message: string } | null;
}) {
  const updates: RunRow[] = [];
  const inserts: RunRow[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.run, error: null }),
        }),
      }),
      insert: async (payload: RunRow) => {
        inserts.push({ table, ...payload });
        return { error: null };
      },
      update: (payload: RunRow) => {
        const conds: Record<string, unknown> = {};
        const chain: any = {
          eq: (col: string, val: unknown) => {
            conds[col] = val;
            return chain;
          },
          then: (resolve: (v: unknown) => unknown) => {
            const matches = Object.entries(conds).every(
              ([col, val]) => col === "id" || (opts.run as any)?.[col] === val,
            );
            if (matches) updates.push({ table, ...payload });
            return Promise.resolve({ error: opts.updateError ?? null }).then(resolve);
          },
        };
        return chain;
      },


    }),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      const hit = opts.rpc?.[fn];
      if (!hit) return { data: null, error: { message: `no fake for ${fn}` } };
      return { data: hit.data ?? null, error: hit.error ?? null };
    },
  } as never;
  return { admin, updates, inserts, rpcCalls };
}

const readyRun: RunRow = {
  id: RUN_ID,
  status: APPLY_STATUS.READY,
  safety_snapshot_id: "33333333-3333-3333-3333-333333333333",
  staging_overall_digest: DIGEST,
  staging_verify: { ok: true },
  final_restore_tables: ["dmr_entries"],
  snapshot_id: "11111111-1111-1111-1111-111111111111",
};

const okApply = {
  restore_apply_atomic: {
    data: {
      ok: true,
      run_id: RUN_ID,
      tables: [{ table: "dmr_entries", rows: 2, digest: "d" }],
      sequences: [],
      guard_tables: ["profiles", "user_roles"],
      overall_digest: DIGEST,
    },
  },
};

describe("안전 복원 반영 엔진 — 관문", () => {
  it("정상 관문 통과 시 원자적 반영 RPC 를 호출한다", async () => {
    const f = fakeAdmin({ run: readyRun, rpc: okApply });
    const res = await applyRestoreAtomic(f.admin, {
      runId: RUN_ID,
      expectedOverallDigest: DIGEST,
      actorId: "u1",
    });
    expect(res.ok).toBe(true);
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0]?.fn).toBe("restore_apply_atomic");
    expect(f.rpcCalls[0]?.args).toMatchObject({
      _run_id: RUN_ID,
      _expected_overall_digest: DIGEST,
      _actor: "u1",
    });
  });

  it("지문을 제시하지 않으면 RPC 를 호출하지 않는다", async () => {
    const f = fakeAdmin({ run: readyRun, rpc: okApply });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: "" }),
    ).rejects.toThrow("RESTORE_STAGING_DIGEST_REQUIRED");
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("고정 지문과 다르면 차단한다", async () => {
    const f = fakeAdmin({ run: readyRun, rpc: okApply });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: "b".repeat(64) }),
    ).rejects.toThrow("RESTORE_STAGING_DIGEST_MISMATCH");
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("안전 스냅샷이 없으면 반영을 시도하지 않는다", async () => {
    const f = fakeAdmin({ run: { ...readyRun, safety_snapshot_id: null }, rpc: okApply });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_SAFETY_SNAPSHOT_MISSING");
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("준비 영역 검산이 통과되지 않았으면 차단한다", async () => {
    const f = fakeAdmin({ run: { ...readyRun, staging_verify: { ok: false } }, rpc: okApply });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_STAGING_VERIFY_NOT_CLEAN");
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("이미 반영된(또는 진행 중인) 작업은 중복 실행할 수 없다", async () => {
    for (const status of [APPLY_STATUS.APPLYING, APPLY_STATUS.SUCCESS, "preflight_clean"]) {
      const f = fakeAdmin({ run: { ...readyRun, status }, rpc: okApply });
      await expect(
        applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
      ).rejects.toThrow("RESTORE_APPLY_NOT_CLAIMABLE");
      expect(f.rpcCalls).toHaveLength(0);
    }
  });

  it("작업 기록이 없으면 차단한다", async () => {
    const f = fakeAdmin({ run: null, rpc: okApply });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_RUN_NOT_FOUND");
  });
});

describe("안전 복원 반영 엔진 — 실패 감사기록", () => {
  it("RPC 실패 시 별도 문장으로 apply_failed 를 남기고 오류를 표면화한다", async () => {
    const f = fakeAdmin({
      run: readyRun,
      rpc: { restore_apply_atomic: { error: { message: "RESTORE_APPLY_DIGEST_MISMATCH: table=x" } } },
    });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_APPLY_FAILED");
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({
      table: "restore_runs",
      status: APPLY_STATUS.FAILED,
      error_code: "RESTORE_APPLY_DIGEST_MISMATCH",
    });
  });

  it("실패 기록 갱신까지 실패하면 두 오류를 함께 표면화한다", async () => {
    const f = fakeAdmin({
      run: readyRun,
      rpc: { restore_apply_atomic: { error: { message: "RESTORE_APPLY_ROW_COUNT_MISMATCH" } } },
      updateError: { message: "db down" },
    });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_APPLY_FAILED_AND_AUDIT_UPDATE_FAILED");
  });

  it("ok 가 아닌 응답은 성공으로 처리하지 않는다", async () => {
    const f = fakeAdmin({ run: readyRun, rpc: { restore_apply_atomic: { data: { ok: false } } } });
    await expect(
      applyRestoreAtomic(f.admin, { runId: RUN_ID, expectedOverallDigest: DIGEST }),
    ).rejects.toThrow("RESTORE_APPLY_RESULT_INVALID");
  });
});

describe("준비 영역 지문 고정", () => {
  it("고정 결과의 overall 지문을 반환한다", async () => {
    const f = fakeAdmin({
      run: readyRun,
      rpc: { restore_pin_staging_digest: { data: { run_id: RUN_ID, tables: [], overall: DIGEST } } },
    });
    await expect(pinStagingDigest(f.admin, RUN_ID)).resolves.toMatchObject({ overall: DIGEST });
  });

  it("overall 지문이 비면 실패한다", async () => {
    const f = fakeAdmin({
      run: readyRun,
      rpc: { restore_pin_staging_digest: { data: { run_id: RUN_ID, tables: [], overall: "" } } },
    });
    await expect(pinStagingDigest(f.admin, RUN_ID)).rejects.toThrow("RESTORE_STAGING_DIGEST_EMPTY");
  });

  it("재계산 지문 조회 실패는 감춰지지 않는다", async () => {
    const f = fakeAdmin({
      run: readyRun,
      rpc: { restore_staging_digest: { error: { message: "boom" } } },
    });
    await expect(readStagingDigest(f.admin, RUN_ID)).rejects.toThrow(
      "RESTORE_STAGING_DIGEST_FAILED: boom",
    );
  });
});

describe("안전 스냅샷 결속", () => {
  it("staging_verified 가 아니면 스냅샷을 만들지 않는다", async () => {
    const f = fakeAdmin({ run: { ...readyRun, status: "preflight_clean" } });
    await expect(createAndBindSafetySnapshot(f.admin, { runId: RUN_ID })).rejects.toThrow(
      "RESTORE_STAGING_NOT_VERIFIED",
    );
    expect(f.inserts).toHaveLength(0);
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("작업 기록이 없으면 스냅샷을 만들지 않는다", async () => {
    const f = fakeAdmin({ run: null });
    await expect(createAndBindSafetySnapshot(f.admin, { runId: RUN_ID })).rejects.toThrow(
      "RESTORE_RUN_NOT_FOUND",
    );
    expect(f.inserts).toHaveLength(0);
  });
});
