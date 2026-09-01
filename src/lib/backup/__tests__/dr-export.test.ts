import { describe, it, expect } from "vitest";
import {
  DR_WORK_BUCKETS,
  checkRunUsable,
  collectManifestParts,
  findCaseCollisions,
  generateDrToken,
  hashDrToken,
  isBucketAllowed,
  maskDrSecret,
  normalizeObjectPath,
} from "../dr-export-contract";
import {
  DrExportError,
  authenticateDrToken,
  listWorkBucketObjects,
  resolveSnapshotPart,
  resolveWorkObject,
} from "../dr-export.server";
import { SNAPSHOT_SCHEMA_VERSION } from "../backup-core.server";

const FOLDER = "snapshots/11111111-1111-1111-1111-111111111111/";
const MANIFEST = {
  id: "11111111-1111-1111-1111-111111111111",
  schema_version: SNAPSHOT_SCHEMA_VERSION,
  schema_fingerprint: "fp",
  sha256: "a".repeat(64),
  total_rows: 3,
  tables: [
    { name: "profiles", rows: 3, sha256: "b".repeat(64), size_bytes: 10, parts: [{ path: "tables/profiles.0.jsonl", rows: 3, sha256: "c".repeat(64), size_bytes: 10 }] },
  ],
};

function fakeAdmin(over: Record<string, any> = {}) {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(MANIFEST));
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "database_snapshots"
              ? { data: { id: MANIFEST.id, name: "auto", created_at: "2026-09-01", storage_path: FOLDER, sha256_hash: MANIFEST.sha256, size_bytes: 10, metadata: {} }, error: null }
              : { data: over.run ?? null, error: null },
        }),
      }),
      update: () => ({ eq: () => ({ in: async () => ({ error: null }) }), in: async () => ({ error: null }) }),
    }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) =>
          path.endsWith("manifest.json")
            ? { data: new Blob([manifestBytes]), error: null }
            : { data: new Blob([new Uint8Array([1])]), error: null },
        list: async (dir: string, opts: any) => (over.list ? over.list(bucket, dir, opts) : { data: [], error: null }),
      }),
    },
  } as any;
}

describe("논리 DR 계약", () => {
  it("업무 버킷 7개 정본, db-backups 는 허용되지 않는다", () => {
    expect(DR_WORK_BUCKETS).toHaveLength(7);
    expect(isBucketAllowed("db-backups")).toBe(false);
    expect(isBucketAllowed("spl-documents")).toBe(true);
  });

  it("토큰 원문은 저장하지 않고 SHA-256 만 쓴다", async () => {
    const t = generateDrToken();
    const h = await hashDrToken(t);
    expect(h).toHaveLength(64);
    expect(h).not.toContain(t);
    expect(await hashDrToken(t)).toBe(h);
    expect(t).not.toBe(generateDrToken());
  });

  it("만료·취소·완료 토큰은 차단된다", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(checkRunUsable({ status: "issued", expires_at: future }).ok).toBe(true);
    expect(checkRunUsable({ status: "downloading", expires_at: future }).ok).toBe(true);
    expect(checkRunUsable({ status: "completed", expires_at: future }).ok).toBe(false);
    expect(checkRunUsable({ status: "revoked", expires_at: future }).ok).toBe(false);
    expect(checkRunUsable({ status: "issued", expires_at: new Date(Date.now() - 1000).toISOString() })).toMatchObject({
      ok: false,
      code: "TOKEN_EXPIRED",
    });
    expect(checkRunUsable(null).ok).toBe(false);
  });

  it("경로 이탈·절대경로·역슬래시·NUL 을 차단한다", () => {
    for (const bad of ["../x", "a/../../b", "/abs", "C:/x", "a\\b", "a\0b", "a//b", "./a", " a"]) {
      expect(normalizeObjectPath(bad).ok, bad).toBe(false);
    }
    expect(normalizeObjectPath("a/b/c.pdf")).toEqual({ ok: true, path: "a/b/c.pdf" });
  });

  it("대소문자 충돌을 찾아낸다", () => {
    expect(findCaseCollisions(["a/B.pdf", "a/b.pdf"])).toEqual(["a/b.pdf"]);
    expect(findCaseCollisions(["a.pdf", "b.pdf"])).toEqual([]);
  });

  it("secret·token 을 마스킹한다", () => {
    const t = "supersecrettoken123456";
    expect(maskDrSecret(`fail Bearer ${t}`, [t])).not.toContain(t);
    expect(maskDrSecret("service_role_key=abc123xyz")).toContain("[REDACTED]");
  });

  it("manifest part 목록을 평탄화한다", () => {
    expect(collectManifestParts(MANIFEST)).toEqual([
      { path: "tables/profiles.0.jsonl", sha256: "c".repeat(64), size_bytes: 10 },
    ]);
  });
});

describe("논리 DR 서버 접근 통제", () => {
  it("토큰 없는 요청은 401", async () => {
    await expect(authenticateDrToken(fakeAdmin(), new Request("https://x/api"))).rejects.toMatchObject({ status: 401 });
  });

  it("알 수 없는 토큰은 차단", async () => {
    const req = new Request("https://x/api", { headers: { authorization: "Bearer nope-nope-nope" } });
    await expect(authenticateDrToken(fakeAdmin({ run: null }), req)).rejects.toBeInstanceOf(DrExportError);
  });

  it("manifest 에 없는 Snapshot part 는 차단", async () => {
    const run = { id: "r1", snapshot_id: MANIFEST.id, snapshot_manifest_sha256: null };
    await expect(resolveSnapshotPart(fakeAdmin(), run, "tables/other.0.jsonl")).rejects.toMatchObject({
      code: "PART_NOT_DECLARED",
    });
    await expect(resolveSnapshotPart(fakeAdmin(), run, "../../db-backups/x")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    });
    const ok = await resolveSnapshotPart(fakeAdmin(), run, "tables/profiles.0.jsonl");
    expect(ok.fullPath).toBe(`${FOLDER}tables/profiles.0.jsonl`.replace(/\/+/g, "/"));
  });

  it("db-backups 등 허용 외 버킷은 목록·다운로드 모두 차단", async () => {
    await expect(listWorkBucketObjects(fakeAdmin(), "db-backups", { limit: 10, offset: 0 })).rejects.toMatchObject({
      code: "BUCKET_NOT_ALLOWED",
    });
    await expect(resolveWorkObject(fakeAdmin(), "db-backups", "snapshots/x/manifest.json")).rejects.toMatchObject({
      code: "BUCKET_NOT_ALLOWED",
    });
  });

  it("하위 폴더까지 재귀 탐색하고 페이지네이션 누락이 없다", async () => {
    const tree: Record<string, { name: string; id: string | null; metadata: any }[]> = {
      "": [
        { name: "sub", id: null, metadata: null },
        { name: "root.pdf", id: "1", metadata: { size: 5 } },
      ],
      sub: [
        { name: "a.pdf", id: "2", metadata: { size: 7 } },
        { name: "b.pdf", id: "3", metadata: { size: 9 } },
      ],
    };
    const admin = fakeAdmin({
      list: (_b: string, dir: string, opts: any) => ({
        data: (tree[dir] ?? []).slice(opts.offset, opts.offset + opts.limit),
        error: null,
      }),
    });
    const page1 = await listWorkBucketObjects(admin, "spl-documents", { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.total_bytes).toBe(21);
    expect(page1.files.map((f) => f.path)).toEqual(["root.pdf", "sub/a.pdf"]);
    expect(page1.next_offset).toBe(2);
    const page2 = await listWorkBucketObjects(admin, "spl-documents", { limit: 2, offset: 2 });
    expect(page2.files.map((f) => f.path)).toEqual(["sub/b.pdf"]);
    expect(page2.next_offset).toBeNull();
  });

  it("목록에 없는 업무 파일은 다운로드 차단", async () => {
    const admin = fakeAdmin({ list: () => ({ data: [], error: null }) });
    await expect(resolveWorkObject(admin, "spl-documents", "ghost.pdf")).rejects.toMatchObject({
      code: "OBJECT_NOT_LISTED",
    });
  });
});
