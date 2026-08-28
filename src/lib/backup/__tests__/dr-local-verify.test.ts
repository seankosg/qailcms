import { describe, it, expect } from "vitest";
import { verifyDrPackage, supportsStreamingSha256, DR_BUCKETS } from "../dr-local-verify";
import { Sha256Stream, sha256OfBlobStream } from "../sha256-stream";

const RUN = "QAIL_DR_20260828_010203";
const ZIP_SHA = "a".repeat(64);

function receipt(over: Record<string, any> = {}) {
  const buckets: Record<string, any> = {};
  for (const b of DR_BUCKETS) buckets[b] = { files: 1, bytes: 10 };
  return {
    run_id: RUN,
    status: "completed",
    started_at: "2026-08-28T01:02:03.000Z",
    finished_at: "2026-08-28T01:10:00.000Z",
    database_dump: { bytes: 1234, sha256: "b".repeat(64), toc_entries: 10 },
    storage: { buckets, files: 7, bytes: 70 },
    excluded_buckets: ["db-backups"],
    zip: { path: `/Users/x/QAIL-DR/${RUN}.zip`, bytes: 2048, sha256: ZIP_SHA },
    cleanup_warning: null,
    ...over,
  };
}
const zip = (over: Partial<{ name: string; bytes: number; sha256: string }> = {}) => ({
  name: `${RUN}.zip`,
  bytes: 2048,
  sha256: ZIP_SHA,
  ...over,
});

describe("verifyDrPackage", () => {
  it("정상 fixture 는 초록", () => {
    const r = verifyDrPackage(zip(), receipt());
    expect(r.verdict).toBe("ok");
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.summary.excludedBuckets).toContain("db-backups");
  });

  it("ZIP 1 byte 변경 시 불일치", () => {
    const r = verifyDrPackage(zip({ bytes: 2049, sha256: "c".repeat(64) }), receipt());
    expect(r.verdict).toBe("fail");
    expect(r.checks.find((c) => c.id === "zip-bytes")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "zip-sha")?.passed).toBe(false);
  });

  it("다른 run 영수증 선택 시 불일치", () => {
    const other = receipt({ run_id: "QAIL_DR_20260101_000000", zip: { path: "QAIL_DR_20260101_000000.zip", bytes: 2048, sha256: ZIP_SHA } });
    const r = verifyDrPackage(zip(), other);
    expect(r.verdict).toBe("fail");
    expect(r.checks.find((c) => c.id === "run-id")?.passed).toBe(false);
    expect(r.checks.find((c) => c.id === "zip-name")?.passed).toBe(false);
  });

  it("status != completed 차단", () => {
    expect(verifyDrPackage(zip(), receipt({ status: "failed" })).verdict).toBe("fail");
  });

  it("db-backups 제외 선언 누락 차단", () => {
    const r = verifyDrPackage(zip(), receipt({ excluded_buckets: [] }));
    expect(r.checks.find((c) => c.id === "excluded")?.passed).toBe(false);
  });

  it("Storage 7개 결과 누락 차단", () => {
    const buckets: Record<string, any> = {};
    for (const b of DR_BUCKETS.slice(0, 5)) buckets[b] = { files: 1, bytes: 10 };
    const r = verifyDrPackage(zip(), receipt({ storage: { buckets, files: 5, bytes: 50 } }));
    expect(r.checks.find((c) => c.id === "storage")?.passed).toBe(false);
    expect(r.verdict).toBe("fail");
  });

  it("DB dump 정보 누락 차단", () => {
    const r = verifyDrPackage(zip(), receipt({ database_dump: null }));
    expect(r.checks.find((c) => c.id === "dump")?.passed).toBe(false);
  });

  it("cleanup warning 은 주황(warn)", () => {
    const r = verifyDrPackage(zip(), receipt({ cleanup_warning: { path: "/tmp/work" } }));
    expect(r.verdict).toBe("warn");
    expect(r.summary.cleanupWarning).toBe("/tmp/work");
  });
});

describe("streaming sha256", () => {
  it("미지원 환경 감지", () => {
    expect(supportsStreamingSha256({})).toBe(false);
    expect(supportsStreamingSha256(globalThis)).toBe(true);
  });

  it("알려진 벡터와 일치", async () => {
    expect(new Sha256Stream().update(new TextEncoder().encode("abc")).digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const big = new Uint8Array(200_000).fill(7);
    const blob = new Blob([big]);
    const streamed = await sha256OfBlobStream(blob);
    const direct = new Sha256Stream().update(big).digestHex();
    expect(streamed).toBe(direct);
  });
});

describe("HP3 교정 — 파일 변경 시 검증 상태 초기화", () => {
  it("8/9. 초기화 상태는 결과·오류·진행률·저장 체크를 모두 비운다", () => {
    const cleared = clearedVerificationState();
    expect(cleared.result).toBeNull();
    expect(cleared.error).toBeNull();
    expect(cleared.progress).toBe(0);
    expect(cleared.saved).toBe(false);
  });

  it("8/9. ZIP·영수증 input 양쪽 모두 선택 변경 시 초기화를 호출한다", () => {
    const src = readFileSync(
      new URL("../../../components/admin/backup/LocalDrPackageCard.tsx", import.meta.url),
      "utf8",
    );
    const zipBlock = src.slice(src.indexOf('accept=".zip"'), src.indexOf("run_receipt.json</Label>"));
    const receiptBlock = src.slice(src.indexOf('accept=".json,application/json"'));
    expect(zipBlock).toContain("resetVerification();");
    expect(receiptBlock.slice(0, 400)).toContain("resetVerification();");
  });
});
