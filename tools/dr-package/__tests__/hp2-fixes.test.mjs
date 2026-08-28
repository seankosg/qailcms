import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDrPackage, STATUS } from "../engine/build.mjs";
import { collectMigrations, defaultSystemInfo, findRepoRoot } from "../engine/repo.mjs";

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "qail-dr-hp2-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const FAKE_SERVICE_KEY = "sb_secret_TESTONLYplaceholder1234567890";

function fakeStorage(tree) {
  return {
    async list(bucket, prefix, { limit, offset }) {
      const entries = tree[bucket]?.[prefix ?? ""] ?? [];
      return entries.slice(offset, offset + limit);
    },
    async download(bucket, p) {
      const content = tree[`${bucket}::${p}`];
      if (content == null) throw new Error(`다운로드 실패 (${bucket}/${p}) key=${FAKE_SERVICE_KEY}`);
      return Buffer.from(content);
    },
  };
}

const TREE = {
  "dmr-uploads": { "": [{ name: "a.txt", id: "1", metadata: { size: 3 } }] },
  "dmr-uploads::a.txt": "abc",
};

function baseOpts(overrides = {}) {
  const work = path.join(tmp, "work");
  mkdirSync(work, { recursive: true });
  return {
    conn: { host: "h", port: 5432, user: "u", password: "s3cr3tPass", database: "postgres" },
    outDir: path.join(tmp, "out"),
    workDir: work,
    buckets: ["dmr-uploads"],
    storageClient: fakeStorage(TREE),
    serviceRoleKey: FAKE_SERVICE_KEY,
    pgTools: { ok: true, pgDump: "pg_dump", pgRestore: "pg_restore", version: "17.5", searched: [] },
    dumpFn: async ({ outFile, logFile }) => {
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, "PGDMP-fixture");
      writeFileSync(logFile, "dump ok");
      return { ok: true, code: 0, bytes: 13 };
    },
    tocFn: async () => ({ ok: true, entries: 2, hasPublic: true, hasAuth: true }),
    ...overrides,
  };
}

// 1) 런처 작업 폴더가 tools/dr-package 여도 실제 migration 이 기록된다
describe("migration 경로", () => {
  it("cwd 가 tools/dr-package 여도 저장소 migration 과 SHA-256 을 수집한다", async () => {
    const prev = process.cwd();
    process.chdir(path.join(prev, "tools", "dr-package"));
    try {
      const res = await collectMigrations();
      expect(res.count).toBeGreaterThan(0);
      expect(res.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.dir.endsWith(path.join("supabase", "migrations"))).toBe(true);
      const sys = await defaultSystemInfo();
      expect(typeof sys.release.git_commit).toBe("string");
      expect(sys.migrations.files.length).toBe(res.count);
    } finally {
      process.chdir(prev);
    }
  });

  it("저장소 루트를 import.meta.url 기준으로 찾는다", () => {
    expect(findRepoRoot().root).toBeTruthy();
  });

  // 2) migration 폴더 누락·0건이면 성공 금지
  it("migration 0건이면 completed 가 되지 않는다", async () => {
    const result = await buildDrPackage(
      baseOpts({ systemInfo: async () => ({ release: {}, migrations: { files: [] } }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("MIGRATIONS_NOT_FOUND");
  });
});

// 3) 8GB 초과
describe("패키지 크기 상한", () => {
  it("상한 초과 시 completed 금지 + 과대 ZIP 삭제", async () => {
    const opts = baseOpts({ maxPackageBytes: 10 });
    const result = await buildDrPackage(opts);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("PACKAGE_SIZE_LIMIT_EXCEEDED");
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.status).toBe(STATUS.FAILED);
    expect(receipt.size_limit.limit_bytes).toBe(10);
    expect(receipt.size_limit.zip_bytes).toBeGreaterThan(10);
    expect(existsSync(receipt.size_limit.zip_path)).toBe(false);
    expect(existsSync(path.join(opts.workDir, result.runId))).toBe(false);
  });
});

// 4) 성공 시 staging 삭제, 5) 실패 시 staging 보존
describe("중간 작업파일 정리", () => {
  it("성공하면 staging 을 지우고 ZIP·영수증만 남긴다", async () => {
    const opts = baseOpts();
    const result = await buildDrPackage(opts);
    expect(result.ok).toBe(true);
    expect(existsSync(path.join(opts.workDir, result.runId))).toBe(false);
    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(result.receiptPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.status).toBe(STATUS.COMPLETED);
    expect(receipt.staging_cleaned).toBe(true);
    expect(receipt.cleanup_warning).toBe(null);
    expect(readdirSync(opts.workDir)).toEqual(["run_receipt.json"]);
  });

  it("실패하면 staging 을 보존하고 영수증에 경로를 남긴다", async () => {
    const opts = baseOpts({ dumpFn: async () => ({ ok: false, code: 1, reason: "dump 실패" }) });
    const result = await buildDrPackage(opts);
    expect(result.ok).toBe(false);
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.staging_path).toBe(path.join(opts.workDir, result.runId));
    expect(existsSync(receipt.staging_path)).toBe(true);
    expect(receipt.staging_cleanup_hint).toContain(result.runId);
  });
});

// 6) service-role key 마스킹
describe("service-role key 마스킹", () => {
  it("오류·영수증·manifest 어디에도 원문이 남지 않는다", async () => {
    const opts = baseOpts({
      storageClient: fakeStorage({ "dmr-uploads": { "": [{ name: "b.txt", id: "1", metadata: { size: 3 } }] } }),
    });
    const result = await buildDrPackage(opts);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(FAKE_SERVICE_KEY);
    const receiptText = readFileSync(result.receiptPath, "utf8");
    expect(receiptText).not.toContain(FAKE_SERVICE_KEY);
    expect(receiptText).not.toContain("s3cr3tPass");

    // staging 에 남은 산출물에도 원문이 없어야 한다
    const stage = path.join(opts.workDir, result.runId);
    const walk = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    for (const f of existsSync(stage) ? walk(stage) : []) {
      expect(readFileSync(f, "utf8")).not.toContain(FAKE_SERVICE_KEY);
    }
  });
});
