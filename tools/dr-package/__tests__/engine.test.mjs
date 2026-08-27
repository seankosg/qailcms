import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findPgTools, verifyDumpToc, runPgDump } from "../engine/pgtools.mjs";
import { collectStorage, listBucketFiles, validateStoragePaths } from "../engine/storage.mjs";
import { DR_BUCKETS, EXCLUDED_BUCKETS, assertBucketScope } from "../engine/buckets.mjs";
import { findPathCollisions, checkRelativePath } from "../engine/paths.mjs";
import { redact, redactDeep } from "../engine/redact.mjs";
import { createZip, reopenZip } from "../engine/zip.mjs";
import { buildDrPackage, STATUS } from "../engine/build.mjs";

let tmp;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "qail-dr-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------- 1) pg_dump 탐색 ----------
describe("PostgreSQL 17 탐색", () => {
  it("17.x 를 찾으면 성공한다", async () => {
    const res = await findPgTools({
      platform: "darwin",
      pathEnv: "/fake/bin",
      exists: () => true,
      readVersion: async () => ({ major: 17, version: "pg_dump (PostgreSQL) 17.5" }),
    });
    expect(res.ok).toBe(true);
    expect(res.pgDump).toBe("/fake/bin/pg_dump");
  });

  it("16.x 뿐이면 실패하고 설치 안내와 탐색 경로를 준다", async () => {
    const res = await findPgTools({
      platform: "win32",
      pathEnv: "C:\\pg\\bin",
      exists: () => true,
      readVersion: async () => ({ major: 16, version: "pg_dump (PostgreSQL) 16.3" }),
    });
    expect(res.ok).toBe(false);
    expect(res.hint).toContain("PostgreSQL 17");
    expect(res.searched.length).toBeGreaterThan(0);
    expect(res.searched[0]).toContain("pg_dump.exe");
  });

  it("실행파일이 없으면 실패한다", async () => {
    const res = await findPgTools({ platform: "darwin", pathEnv: "", exists: () => false });
    expect(res.ok).toBe(false);
  });
});

// ---------- 2~4) dump 실패·0byte·목차 ----------
describe("DB dump 계약", () => {
  const conn = { host: "h", port: 5432, user: "u", password: "s3cr3t", database: "postgres" };

  function fakeSpawn(code, out = "") {
    return () => {
      const handlers = {};
      const child = {
        stdout: { on: (e, cb) => (e === "data" && out ? cb(Buffer.from(out)) : null) },
        stderr: { on: () => {} },
        on: (e, cb) => {
          handlers[e] = cb;
          if (e === "close") setTimeout(() => cb(code), 0);
          return child;
        },
      };
      return child;
    };
  }

  it("종료 코드가 0이 아니면 실패한다", async () => {
    const res = await runPgDump({
      pgDump: "pg_dump",
      conn,
      outFile: path.join(tmp, "a.dump"),
      logFile: path.join(tmp, "a.log"),
      spawnFn: fakeSpawn(1),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("종료 코드");
  });

  it("0 byte dump 는 차단한다", async () => {
    const out = path.join(tmp, "b.dump");
    const res = await runPgDump({
      pgDump: "pg_dump",
      conn,
      outFile: out,
      logFile: path.join(tmp, "b.log"),
      spawnFn: () => {
        writeFileSync(out, "");
        return fakeSpawn(0)();
      },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("0 byte");
  });

  it("pg_restore --list 실패 시 차단한다", async () => {
    const res = await verifyDumpToc({
      pgRestore: "pg_restore",
      dumpFile: "x",
      runner: async () => ({ code: 1, stdout: "", stderr: "corrupt archive" }),
    });
    expect(res.ok).toBe(false);
  });

  it("목차에 auth 가 없으면 차단한다", async () => {
    const res = await verifyDumpToc({
      pgRestore: "pg_restore",
      dumpFile: "x",
      runner: async () => ({ code: 0, stdout: "; 1; TABLE public profiles\n", stderr: "" }),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("auth=false");
  });

  it("public + auth 가 있으면 통과한다", async () => {
    const res = await verifyDumpToc({
      pgRestore: "pg_restore",
      dumpFile: "x",
      runner: async () => ({ code: 0, stdout: "; 1; TABLE public profiles\n; 2; TABLE auth users\n", stderr: "" }),
    });
    expect(res.ok).toBe(true);
  });
});

// ---------- 5~8) Storage ----------
function fakeStorage(tree) {
  return {
    async list(bucket, prefix, { limit, offset }) {
      const entries = tree[bucket]?.[prefix ?? ""] ?? [];
      return entries.slice(offset, offset + limit);
    },
    async download(bucket, p) {
      const content = tree[`${bucket}::${p}`];
      if (content == null) throw new Error("not found");
      return Buffer.from(content);
    },
  };
}

describe("Storage 수집", () => {
  it("페이지네이션과 하위 폴더 재귀 탐색을 한다", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `f${i}.pdf`, id: String(i), metadata: { size: 3 } }));
    const client = fakeStorage({
      "spl-documents": {
        "": [...many, { name: "sub", id: null, metadata: null }],
        sub: [{ name: "deep.pdf", id: "x", metadata: { size: 3 } }],
      },
    });
    const files = await listBucketFiles(client, "spl-documents");
    expect(files.length).toBe(151);
    expect(files.some((f) => f.path === "sub/deep.pdf")).toBe(true);
  });

  it("파일 누락·크기 불일치·hash 대상 검증에서 실패로 처리한다", async () => {
    const tree = {
      "dmr-uploads": { "": [{ name: "a.txt", id: "1", metadata: { size: 99 } }] },
      "dmr-uploads::a.txt": "abc",
    };
    await expect(collectStorage(fakeStorage(tree), ["dmr-uploads"], tmp)).rejects.toThrow(/크기 불일치/);

    const missing = { "dmr-uploads": { "": [{ name: "b.txt", id: "1", metadata: { size: 3 } }] } };
    await expect(collectStorage(fakeStorage(missing), ["dmr-uploads"], tmp)).rejects.toThrow(/다운로드 실패/);
  });

  it("정상 수집 시 파일별 bytes/sha256 을 기록한다", async () => {
    const tree = {
      "dmr-uploads": { "": [{ name: "a.txt", id: "1", metadata: { size: 3 } }] },
      "dmr-uploads::a.txt": "abc",
    };
    const res = await collectStorage(fakeStorage(tree), ["dmr-uploads"], tmp);
    expect(res.files[0].sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(res.totalBytes).toBe(3);
  });

  it("경로 이탈·역슬래시·절대경로를 차단한다", () => {
    const bad = validateStoragePaths([
      { bucket: "b", path: "../etc/passwd" },
      { bucket: "b", path: "C:\\win" },
      { bucket: "b", path: "/abs" },
      { bucket: "b", path: "a//b" },
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.code)).toContain("PATH_TRAVERSAL");
    expect(checkRelativePath("ok/path.pdf").ok).toBe(true);
  });

  it("대소문자 충돌을 차단한다", () => {
    const res = findPathCollisions(["a/File.pdf", "a/file.pdf"]);
    expect(res.ok).toBe(false);
    expect(res.caseCollisions.length).toBe(1);
  });

  it("db-backups 는 대상에서 제외된다", () => {
    expect(DR_BUCKETS).toHaveLength(7);
    expect(DR_BUCKETS).not.toContain("db-backups");
    expect(EXCLUDED_BUCKETS).toContain("db-backups");
    expect(() => assertBucketScope(["db-backups"])).toThrow();
  });
});

// ---------- 9) 마스킹 ----------
describe("비밀값 마스킹", () => {
  it("접속 문자열·토큰·비밀번호를 가린다", () => {
    const s = redact("postgres://postgres:Hunter2@db.host:5432/postgres PGPASSWORD=Hunter2 token=abc123");
    expect(s).not.toContain("Hunter2");
    expect(s).not.toContain("abc123");
  });
  it("객체 전체를 재귀 마스킹한다", () => {
    const out = redactDeep({ a: { b: "err: Hunter2 실패" } }, ["Hunter2"]);
    expect(out.a.b).not.toContain("Hunter2");
  });
});

// ---------- 10) 소형 ZIP 및 전체 파이프라인 ----------
describe("소형 패키지 end-to-end", () => {
  it("ZIP 생성 후 재개봉 검증에 성공한다", async () => {
    const f = path.join(tmp, "x.bin");
    writeFileSync(f, "hello");
    const zipPath = path.join(tmp, "t.zip");
    const res = await createZip([{ zipPath: "r/x.bin", localPath: f }, { zipPath: "r/n.txt", content: "n" }], zipPath);
    expect(res.bytes).toBeGreaterThan(0);
    expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
    const open = await reopenZip(zipPath);
    expect(open.entryCount).toBe(2);
  });

  it("정상 fixture 로 completed 패키지를 만든다", async () => {
    const work = path.join(tmp, "work");
    const out = path.join(tmp, "out");
    mkdirSync(work, { recursive: true });
    const tree = {
      "dmr-uploads": { "": [{ name: "a.txt", id: "1", metadata: { size: 3 } }] },
      "dmr-uploads::a.txt": "abc",
    };
    const result = await buildDrPackage({
      conn: { host: "h", port: 5432, user: "u", password: "s3cr3t", database: "postgres" },
      outDir: out,
      workDir: work,
      buckets: ["dmr-uploads"],
      storageClient: fakeStorage(tree),
      pgTools: { ok: true, pgDump: "pg_dump", pgRestore: "pg_restore", version: "17.5", searched: [] },
      dumpFn: async ({ outFile, logFile }) => {
        mkdirSync(path.dirname(outFile), { recursive: true });
        writeFileSync(outFile, "PGDMP-fixture");
        writeFileSync(logFile, "dump ok");
        return { ok: true, code: 0, bytes: 13 };
      },
      tocFn: async () => ({ ok: true, entries: 2, hasPublic: true, hasAuth: true }),
    });
    expect(result.ok).toBe(true);
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.status).toBe(STATUS.COMPLETED);
    expect(receipt.excluded_buckets).toContain("db-backups");
    expect(receipt.zip.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(result.path)).toBe(true);

    const open = await reopenZip(result.path);
    expect(open.names).toContain(`${result.runId}/backup-manifest.json`);
    expect(open.names).toContain(`${result.runId}/checksums.sha256`);
    expect(open.names).toContain(`${result.runId}/database/qail-full-database.dump`);
    expect(open.names).toContain(`${result.runId}/storage/dmr-uploads/a.txt`);
    expect(open.entryCount).toBe(result.manifest.file_count);
  });

  it("dump 실패 시 completed 로 표시하지 않는다", async () => {
    const work = path.join(tmp, "work2");
    mkdirSync(work, { recursive: true });
    const result = await buildDrPackage({
      conn: { host: "h", port: 5432, user: "u", password: "Hunter2", database: "postgres" },
      outDir: path.join(tmp, "out2"),
      workDir: work,
      buckets: ["dmr-uploads"],
      storageClient: fakeStorage({}),
      pgTools: { ok: true, pgDump: "pg_dump", pgRestore: "pg_restore", version: "17.5", searched: [] },
      dumpFn: async () => ({ ok: false, code: 1, reason: "pg_dump 종료 코드 1 (postgres://u:Hunter2@h/postgres)" }),
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(STATUS.FAILED);
    expect(result.error).not.toContain("Hunter2");
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.status).toBe(STATUS.FAILED);
  });
});

// ---------- 11) 런처 동일 엔진 호출 ----------
describe("OS 런처", () => {
  it("Windows/macOS 런처가 같은 run.mjs 를 호출한다", () => {
    const dir = path.join(process.cwd(), "tools", "dr-package");
    const cmd = readFileSync(path.join(dir, "QAIL-재해복구-패키지-생성.cmd"), "utf8");
    const command = readFileSync(path.join(dir, "QAIL-재해복구-패키지-생성.command"), "utf8");
    expect(cmd).toContain("run.mjs");
    expect(command).toContain("run.mjs");
    expect(existsSync(path.join(dir, "run.mjs"))).toBe(true);
  });
});
