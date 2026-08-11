import { describe, expect, it, vi } from "vitest";
import { resolveBackupClaim } from "../backup-claim";

describe("resolveBackupClaim", () => {
  it("최초 claim 요청만 백업을 실행한다", () => {
    expect(resolveBackupClaim({ claimed: true, status: "running" })).toEqual({ kind: "run" });
  });

  it("동일 run_id 네트워크 재전송은 PK 오류 없이 기존 실행에 합류한다", () => {
    expect(resolveBackupClaim({ claimed: false, status: "running" })).toEqual({
      kind: "join",
      status: "running",
    });
    expect(resolveBackupClaim({ claimed: false, status: "queued" })).toEqual({
      kind: "join",
      status: "queued",
    });
  });

  it("이미 성공한 run 은 같은 snapshot_id 를 재사용한다", () => {
    expect(resolveBackupClaim({ claimed: false, status: "success", snapshot_id: "snap-1" })).toEqual(
      { kind: "reuse", snapshotId: "snap-1" },
    );
  });

  it("실패한 run 은 덮어쓰지 않고 실패 증거를 유지한다", () => {
    const r = resolveBackupClaim({ claimed: false, status: "failed", error_message: "boom" });
    expect(r.kind).toBe("failed");
    expect(r.kind === "failed" && r.message).toContain("boom");
  });
});

/** 원자적 claim 시뮬레이션: 동일 run_id 동시 요청 2건 → 실행 1회 */
describe("atomic claim", () => {
  function makeClaimer() {
    const rows = new Map<string, { status: string; snapshot_id: string | null }>();
    return (runId: string) => {
      const existed = rows.has(runId);
      if (!existed) rows.set(runId, { status: "running", snapshot_id: null });
      const row = rows.get(runId)!;
      return { claimed: !existed, status: row.status, snapshot_id: row.snapshot_id };
    };
  }

  it("같은 run ID 동시 요청 2건에도 실행은 1회", async () => {
    const claim = makeClaimer();
    const run = vi.fn();
    const call = async (id: string) => {
      const a = resolveBackupClaim(claim(id));
      if (a.kind === "run") run();
      return a;
    };
    const [a, b] = await Promise.all([call("r1"), call("r1")]);
    expect(run).toHaveBeenCalledTimes(1);
    expect([a.kind, b.kind].sort()).toEqual(["join", "run"]);
  });

  it("명시적 Retry 는 새 run ID 를 사용하므로 다시 실행된다", async () => {
    const claim = makeClaimer();
    expect(resolveBackupClaim(claim("r1")).kind).toBe("run");
    expect(resolveBackupClaim(claim("r2")).kind).toBe("run");
  });
});

/** 클라이언트 동기 ref 잠금 시뮬레이션 */
describe("client double-click lock", () => {
  it("빠른 더블클릭에도 서버 호출 1회", async () => {
    const lock = { current: false };
    const server = vi.fn(async () => new Promise((r) => setTimeout(r, 5)));
    const onClick = async () => {
      if (lock.current) return;
      lock.current = true;
      try {
        await server();
      } finally {
        lock.current = false;
      }
    };
    await Promise.all([onClick(), onClick(), onClick()]);
    expect(server).toHaveBeenCalledTimes(1);
  });
});
