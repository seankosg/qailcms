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

describe("복원 대상이 아닌 표까지 실측한 overall hash", () => {
  it("non-target part 를 변조하면 전체 검증이 차단된다", async () => {
    const f = await buildFixture();
    const files = filesOf(f);
    files[`${FOLDER}${OTHER_TABLE}.part-000.json`] = enc(JSON.stringify([{ id: "tampered" }]));
    const admin = fakeAdmin({ manifest: f.manifest, files });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    expect(codes(r)).toContain("PART_HASH_MISMATCH");
    expect(codes(r)).toContain("SNAPSHOT_OVERALL_HASH_MISMATCH");
    expect(r.hashes.overall_matches).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("모든 파트를 실측한 뒤 overall hash 를 계산한다", async () => {
    const f = await buildFixture();
    const admin = fakeAdmin({ manifest: f.manifest, files: filesOf(f) });
    const r = await runRestorePreflight(admin, { snapshotId: SNAPSHOT_ID, scope: "dmr" });
    // 대상(dmr_entries) + 비대상(team_master) 모두 다운로드·검증되었다.
    expect(r.parts.map((p) => p.table).sort()).toEqual([OTHER_TABLE, TABLE].sort());
    expect(r.hashes.recomputed_overall).toBe(f.overall);
    expect(r.hashes.overall_matches).toBe(true);
    expect(r.manifest_sha256).toHaveLength(64);
    expect(r.part_contract).toHaveLength(1);
    expect(r.part_contract[0]).toMatchObject({ table: TABLE, part_index: 0 });
  });
});

type StageOpts = {
  manifestBytes: Uint8Array;
  files: Record<string, Uint8Array>;
  run: Record<string, unknown>;
  failRunUpdate?: boolean;
};

function fakeStageAdmin(o: StageOpts) {
  const updates: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from: (t: string) => {
      if (t === "restore_runs") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.run, error: null }) }) }),
          update: (v: Record<string, unknown>) => {
            updates.push(v);
            return {
              eq: async () => ({
                error:
                  o.failRunUpdate && v.status === "failed" ? { message: "audit update denied" } : null,
              }),
            };
          },
        };
      }
      if (t === "restore_staging_rows") {
        return {
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: async (rows: Record<string, unknown>[]) => {
            inserted.push(...rows);
            return { error: null };
          },
        };
      }
      // database_snapshots
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: SNAPSHOT_ID, name: "fixture", created_at: null, storage_path: FOLDER, sha256_hash: null, tables_included: [], metadata: null },
              error: null,
            }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          if (path === `${FOLDER}manifest.json`) return { data: new Blob([o.manifestBytes as unknown as BlobPart]), error: null };
          const fl = o.files[path];
          if (!fl) return { data: null, error: { message: "not found" } };
          return { data: new Blob([fl as unknown as BlobPart]), error: null };
        },
      }),
    },
    rpc: async () => ({ data: { ok: true, issues: [] }, error: null }),
  };
  return { admin: admin as never, updates, inserted };
}

async function stageFixture() {
  const f = await buildFixture();
  const manifestBytes = enc(JSON.stringify(f.manifest));
  const manifestSha = await sha256Hex(manifestBytes);
  const run = {
    id: "run-1",
    snapshot_id: SNAPSHOT_ID,
    final_restore_tables: [TABLE],
    expected_rows: { [TABLE]: 2 },
    status: "preflight_clean",
    manifest_sha256: manifestSha,
    preflight_result: {
      part_contract: [
        {
          table: TABLE,
          part_index: 0,
          path: `${TABLE}.part-000.json`,
          full_path: `${FOLDER}${TABLE}.part-000.json`,
          rows: 2,
          size_bytes: f.bytes.length,
          sha256: f.partHash,
        },
      ],
    },
  };
  return { f, manifestBytes, manifestSha, run };
}

describe("staging 은 preflight 계약에 고정된다", () => {
  it("동일 manifest/part 는 준비 영역 적재에 성공한다", async () => {
    const { f, manifestBytes, run } = await stageFixture();
    const { admin, inserted } = fakeStageAdmin({ manifestBytes, files: filesOf(f), run });
    const r = await stageRestoreRun(admin, "run-1");
    expect(r.status).toBe("staging_verified");
    expect(r.staged_rows[TABLE]).toBe(2);
    expect(inserted).toHaveLength(2);
  });

  it("preflight 이후 manifest bytes 가 1글자라도 바뀌면 차단한다", async () => {
    const { f, manifestBytes, run } = await stageFixture();
    const tampered = enc(`${new TextDecoder().decode(manifestBytes)} `);
    const { admin } = fakeStageAdmin({ manifestBytes: tampered, files: filesOf(f), run });
    await expect(stageRestoreRun(admin, "run-1")).rejects.toThrow(
      /RESTORE_MANIFEST_CHANGED_AFTER_PREFLIGHT/,
    );
  });

  it("part 와 manifest hash 를 함께 교체해도 차단한다", async () => {
    const { f, run } = await stageFixture();
    // 공격자가 part 를 바꾸고 manifest 의 hash 도 함께 맞춘 상황
    const evilBytes = enc(JSON.stringify([{ id: "evil" }, { id: "evil2" }]));
    const evilPartHash = await sha256Hex(evilBytes);
    const evilTableHash = await combineHashes([evilPartHash]);
    const evilManifest = JSON.parse(JSON.stringify(f.manifest)) as SnapshotManifest;
    evilManifest.tables[0].sha256 = evilTableHash;
    evilManifest.tables[0].parts![0].sha256 = evilPartHash;
    evilManifest.tables[0].parts![0].size_bytes = evilBytes.length;
    const files = filesOf(f);
    files[`${FOLDER}${TABLE}.part-000.json`] = evilBytes;
    const { admin } = fakeStageAdmin({
      manifestBytes: enc(JSON.stringify(evilManifest)),
      files,
      run,
    });
    await expect(stageRestoreRun(admin, "run-1")).rejects.toThrow(
      /RESTORE_MANIFEST_CHANGED_AFTER_PREFLIGHT/,
    );
  });

  it("manifest 는 그대로여도 part 파일만 바뀌면 차단한다", async () => {
    const { f, manifestBytes, run } = await stageFixture();
    const files = filesOf(f);
    files[`${FOLDER}${TABLE}.part-000.json`] = enc(JSON.stringify([{ id: "x" }, { id: "y" }]));
    const { admin } = fakeStageAdmin({ manifestBytes, files, run });
    await expect(stageRestoreRun(admin, "run-1")).rejects.toThrow(
      /RESTORE_PART_CHANGED_AFTER_PREFLIGHT/,
    );
  });

  it("고정된 manifest 검증값이 없으면 적재하지 않는다", async () => {
    const { f, manifestBytes, run } = await stageFixture();
    const { admin } = fakeStageAdmin({
      manifestBytes,
      files: filesOf(f),
      run: { ...run, manifest_sha256: null },
    });
    await expect(stageRestoreRun(admin, "run-1")).rejects.toThrow(/RESTORE_MANIFEST_PIN_MISSING/);
  });

  it("실패 기록 갱신 실패를 조용히 무시하지 않는다", async () => {
    const { f, manifestBytes, run } = await stageFixture();
    const files = filesOf(f);
    delete files[`${FOLDER}${TABLE}.part-000.json`];
    const { admin } = fakeStageAdmin({ manifestBytes, files, run, failRunUpdate: true });
    await expect(stageRestoreRun(admin, "run-1")).rejects.toThrow(
      /STAGING_FAILED_AND_AUDIT_UPDATE_FAILED[\s\S]*audit update denied/,
    );
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
