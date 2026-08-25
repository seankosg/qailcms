import { describe, expect, it } from "vitest";
import { combineHashes, normalizePartPath, sha256Hex } from "../manifest-hash";
import { runRestorePreflight, stageRestoreRun, createRestoreRun } from "../restore-preflight.server";
import { RESTORE_SCOPES, RESTORE_SCOPE_KEYS, resolveRestoreScope, BACKUP_TABLES } from "../backup-shared";
import { SNAPSHOT_SCHEMA_VERSION, type SnapshotManifest } from "../backup-core.server";

const SNAPSHOT_ID = "11111111-1111-1111-1111-111111111111";
const FOLDER = `snapshots/${SNAPSHOT_ID}/`;
const TABLE = "dmr_entries";
/** 복원 대상이 아닌 표(전체 무결성 검증에는 포함되어야 한다). */
const OTHER_TABLE = "team_master";

const enc = (s: string) => new TextEncoder().encode(s);

async function buildFixture(rows: unknown[] = [{ id: "a" }, { id: "b" }], otherRows: unknown[] = [{ id: "t1" }]) {
  const bytes = enc(JSON.stringify(rows));
  const partHash = await sha256Hex(bytes);
  const tableHash = await combineHashes([partHash]);

  const otherBytes = enc(JSON.stringify(otherRows));
  const otherPartHash = await sha256Hex(otherBytes);
  const otherTableHash = await combineHashes([otherPartHash]);

  const overall = await combineHashes([tableHash, otherTableHash]);
  const manifest: SnapshotManifest = {
    id: SNAPSHOT_ID,
    name: "fixture",
    created_at: "2026-08-25T00:00:00.000Z",
    triggered_by: "manual",
    trigger_metadata: null,
    tables: [
      {
        name: TABLE as never,
        rows: rows.length,
        sha256: tableHash,
        size_bytes: bytes.length,
        parts: [{ path: `${TABLE}.part-000.json`, rows: rows.length, sha256: partHash, size_bytes: bytes.length }],
      },
      {
        name: OTHER_TABLE as never,
        rows: otherRows.length,
        sha256: otherTableHash,
        size_bytes: otherBytes.length,
        parts: [
          {
            path: `${OTHER_TABLE}.part-000.json`,
            rows: otherRows.length,
            sha256: otherPartHash,
            size_bytes: otherBytes.length,
          },
        ],
      },
    ],
    total_rows: rows.length + otherRows.length,
    sha256: overall,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    schema_fingerprint: "fp-current",
    schema_contract: [
      { name: TABLE, schema_digest: "digest-current" },
      { name: OTHER_TABLE, schema_digest: "digest-other" },
    ],
  };
  return { manifest, bytes, otherBytes, partHash, tableHash, overall };
}

function filesOf(f: Awaited<ReturnType<typeof buildFixture>>): Record<string, Uint8Array> {
  return {
    [`${FOLDER}${TABLE}.part-000.json`]: f.bytes,
    [`${FOLDER}${OTHER_TABLE}.part-000.json`]: f.otherBytes,
  };
}

type FakeOpts = {
  manifest: SnapshotManifest | null;
  dbManifest?: SnapshotManifest | null;
  dbHash?: string | null;
  files: Record<string, Uint8Array>;
  currentDigest?: string | null;
};

function fakeAdmin(o: FakeOpts) {
  return {
    from: (_t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: SNAPSHOT_ID,
              name: "fixture",
              created_at: "2026-08-25T00:00:00.000Z",
              storage_path: FOLDER,
              sha256_hash: o.dbHash ?? o.manifest?.sha256 ?? null,
              tables_included: [TABLE, OTHER_TABLE],
              metadata: o.dbManifest === undefined ? o.manifest : o.dbManifest,
            },
            error: null,
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (path: string) => {
          if (path === `${FOLDER}manifest.json`) {
            if (!o.manifest) return { data: null, error: { message: "not found" } };
            return { data: new Blob([enc(JSON.stringify(o.manifest))]), error: null };
          }
          const f = o.files[path];
          if (!f) return { data: null, error: { message: "not found" } };
          return { data: new Blob([f as unknown as BlobPart]), error: null };
        },
      }),
    },
    rpc: async (fn: string) => {
      if (fn === "backup_dependency_closure") {
        return {
          data: {
            requested_tables: [TABLE],
            dependent_tables: [],
            required_parent_tables: [],
            auto_included_tables: [],
            keep_current_parent_tables: ["dmr_contractor_master", "dmr_system_master", "team_master"],
            final_restore_tables: [TABLE],
            insert_order: [TABLE],
            remove_order: [TABLE],
            missing_in_snapshot: [],
            self_reference_tables: [],
            cycle_groups: [],
            blockers: [],
          },
          error: null,
        };
      }
      if (fn === "backup_schema_fingerprint") return { data: "fp-current", error: null };
      if (fn === "backup_table_schema_contract") {
        return {
          data:
            o.currentDigest === null
              ? []
              : [{ name: TABLE, schema_digest: o.currentDigest ?? "digest-current" }],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  } as never;
}

const codes = (r: { blockers: { code: string }[] }) => r.blockers.map((b) => b.code);

describe("manifest 경로 검증", () => {
  it("정상 파트 경로를 통과시킨다", () => {
    const r = normalizePartPath(FOLDER, "dmr_entries.part-000.json");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fullPath).toBe(`${FOLDER}dmr_entries.part-000.json`);
  });
  it.each([
    ["/etc/passwd", "PART_PATH_ABSOLUTE"],
    ["C:\\x.json", "PART_PATH_INVALID"],
    ["//host/share/x.json", "PART_PATH_ABSOLUTE"],
    ["../other/x.json", "PART_PATH_TRAVERSAL"],
    ["a/../../x.json", "PART_PATH_TRAVERSAL"],
    // 최종 결과가 폴더 안이어도 `..` 는 무조건 차단한다.
    ["a/../b.json", "PART_PATH_TRAVERSAL"],
    ["./a.json", "PART_PATH_INVALID"],
    ["a//b.json", "PART_PATH_INVALID"],
    ["a/b.json/", "PART_PATH_INVALID"],
    ["", "PART_PATH_INVALID"],
  ])("%s 를 차단한다", (p, code) => {
    const r = normalizePartPath(FOLDER, p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it("percent-encoded traversal 을 디코드하지 않고 원문 그대로 둔다", () => {
    const r = normalizePartPath(FOLDER, "%2e%2e/x.json");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fullPath).toBe(`${FOLDER}%2e%2e/x.json`);
  });
});


describe("runRestorePreflight", () => {
  it("정상 v2 fixture 는 blocker 없이 통과한다", async () => {
    const f = await buildFixture();
    const admin = fakeAdmin({
      manifest: f.manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.snapshot.manifest_source).toBe("storage");
    expect(r.schema.matches).toBe(true);
    expect(r.hashes.overall_matches).toBe(true);
  });

  it("Storage manifest 가 없으면 차단한다", async () => {
    const f = await buildFixture();
    const admin = fakeAdmin({ manifest: null, dbManifest: f.manifest, dbHash: f.overall, files: {} });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("STORAGE_MANIFEST_MISSING");
    expect(r.ok).toBe(false);
  });

  it("DB metadata 와 Storage manifest 가 다르면 차단한다", async () => {
    const f = await buildFixture();
    const dbManifest = { ...f.manifest, total_rows: 999 } as SnapshotManifest;
    const admin = fakeAdmin({
      manifest: f.manifest,
      dbManifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("DB_STORAGE_MANIFEST_MISMATCH");
  });

  it("manifest id 가 다르면 차단한다", async () => {
    const f = await buildFixture();
    const manifest = { ...f.manifest, id: "99999999-9999-9999-9999-999999999999" } as SnapshotManifest;
    const admin = fakeAdmin({
      manifest,
      dbManifest: manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("SNAPSHOT_ID_MISMATCH");
  });

  it("파트 경로 이탈을 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.tables[0].parts![0].path = "../evil.json";
    const admin = fakeAdmin({ manifest, files: {} });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("PART_PATH_ESCAPES_FOLDER");
  });

  it("파트 크기 변조를 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.tables[0].parts![0].size_bytes = 1;
    const admin = fakeAdmin({
      manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("PART_SIZE_MISMATCH");
  });

  it("파트 해시 변조를 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.tables[0].parts![0].sha256 = "0".repeat(64);
    const admin = fakeAdmin({
      manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("PART_HASH_MISMATCH");
  });

  it("파트 행수 변조를 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.tables[0].parts![0].rows = 5;
    const admin = fakeAdmin({
      manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("PART_ROW_COUNT_MISMATCH");
  });

  it("테이블 해시 변조를 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.tables[0].sha256 = "1".repeat(64);
    const admin = fakeAdmin({
      manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("TABLE_HASH_MISMATCH");
  });

  it("전체 해시 변조를 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.sha256 = "2".repeat(64);
    const admin = fakeAdmin({
      manifest,
      dbManifest: manifest,
      dbHash: "2".repeat(64),
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("SNAPSHOT_OVERALL_HASH_MISMATCH");
  });

  it("스키마 계약 누락을 차단한다", async () => {
    const f = await buildFixture();
    const manifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    manifest.schema_contract = [];
    const admin = fakeAdmin({
      manifest,
      dbManifest: manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("SCHEMA_CONTRACT_MISSING");
    expect(r.schema.matches).toBe(false);
  });

  it("현재 DB 에 표가 없으면 차단한다", async () => {
    const f = await buildFixture();
    const admin = fakeAdmin({
      manifest: f.manifest,
      currentDigest: null,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("CURRENT_TABLE_SCHEMA_MISSING");
  });

  it("스키마 변경을 차단한다", async () => {
    const f = await buildFixture();
    const admin = fakeAdmin({
      manifest: f.manifest,
      currentDigest: "digest-changed",
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("SCHEMA_CHANGED_SINCE_SNAPSHOT");
  });

  it("v1 레거시 스냅샷을 차단한다", async () => {
    const f = await buildFixture();
    const manifest = { ...f.manifest, schema_version: "ocs-baseline-v1" } as SnapshotManifest;
    const admin = fakeAdmin({
      manifest,
      dbManifest: manifest,
      files: filesOf(f),
    });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("SNAPSHOT_SCHEMA_VERSION_UNSUPPORTED");
  });
});

describe("복원 범위 계약", () => {
  it("dmr 범위가 존재하고 dmr_entries 를 포함한다", () => {
    expect(RESTORE_SCOPE_KEYS).toContain("dmr");
    expect(resolveRestoreScope("dmr")).toEqual(["dmr_entries"]);
  });

  it("모든 범위의 테이블이 백업 정본 목록에 있다", () => {
    for (const [scope, tables] of Object.entries(RESTORE_SCOPES)) {
      for (const t of tables) {
        expect(BACKUP_TABLES, `${scope}.${t}`).toContain(t);
      }
    }
  });

  it("새로 포함한 영구 기록 표가 백업 정본에 있다", () => {
    for (const t of [
      "abd_audit_log",
      "abd_import_row_logs",
      "abd_mf_change_log",
      "task_management_import_row_logs",
      "tm_pic_delegations",
      "spl_import_row_logs",
      "wrt_import_row_logs",
    ]) {
      expect(BACKUP_TABLES).toContain(t);
    }
  });
});
