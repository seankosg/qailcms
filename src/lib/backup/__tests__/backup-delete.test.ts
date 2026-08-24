import { describe, it, expect } from "vitest";
import { planRetentionCleanup } from "../retention";
import {
  deleteSnapshotCanonical,
  listAllStorageFiles,
  SnapshotDeleteError,
  STORAGE_LIST_PAGE,
  type MinimalSnapshotClient,
} from "../storage-purge";

const BUCKET = "db-backups";

function makeBucket(initial: string[], opts: { failRemove?: boolean; keepAll?: boolean } = {}) {
  let files = new Set(initial);
  const listCalls: { folder: string; offset: number }[] = [];
  return {
    listCalls,
    remaining: () => [...files],
    bucket: {
      list: async (folder: string, o: { limit: number; offset: number }) => {
        listCalls.push({ folder, offset: o.offset });
        const prefix = `${folder}/`;
        const names = [...files].filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
        const page = names.slice(o.offset, o.offset + o.limit);
        return { data: page.map((n) => ({ name: n, id: "obj" })), error: null };
      },
      remove: async (paths: string[]) => {
        if (opts.failRemove) return { error: { message: "boom" } };
        if (!opts.keepAll) paths.forEach((p) => files.delete(p));
        return { error: null };
      },
    },
  };
}

function makeClient(row: any, storage: any): { client: MinimalSnapshotClient; deletedRows: string[] } {
  const deletedRows: string[] = [];
  const client = {
    storage: { from: () => storage },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
      delete: () => ({
        eq: async (_c: string, v: string) => {
          deletedRows.push(v);
          return { error: null };
        },
      }),
    }),
  } as unknown as MinimalSnapshotClient;
  return { client, deletedRows };
}

const rows = [
  { id: "a", name: "a", created_at: "2026-01-01T00:00:00Z", size_bytes: 10, is_locked: false },
  { id: "b", name: "b", created_at: "2026-01-02T00:00:00Z", size_bytes: 20, is_locked: true },
  { id: "c", name: "c", created_at: "2026-01-03T00:00:00Z", size_bytes: 30, is_locked: false },
  { id: "d", name: "d", created_at: "2026-06-01T00:00:00Z", size_bytes: 40, is_locked: false },
];
const NOW = Date.parse("2026-06-10T00:00:00Z");

describe("planRetentionCleanup", () => {
  it("보관기간·최소보관·잠금 조건으로 후보를 계산한다", () => {
    const plan = planRetentionCleanup(rows, { retentionDays: 30, keepMinimum: 2, now: NOW });
    expect(plan.candidates.map((c) => c.id)).toEqual(["a"]);
    expect(plan.locked_excluded_count).toBe(1);
    expect(plan.estimated_bytes).toBe(10);
    expect(plan.remaining_unlocked_after).toBe(2);
  });

  it("최소 보관 개수가 크면 후보가 0건이다", () => {
    const plan = planRetentionCleanup(rows, { retentionDays: 30, keepMinimum: 5, now: NOW });
    expect(plan.candidate_count).toBe(0);
  });

  it("잠금 스냅샷은 후보에 포함되지 않는다", () => {
    const plan = planRetentionCleanup(rows, { retentionDays: 1, keepMinimum: 0, now: NOW });
    expect(plan.candidates.map((c) => c.id)).toEqual(["a", "c", "d"]);
  });
});

describe("listAllStorageFiles", () => {
  it("조회 한도를 초과해도 전수 페이지네이션한다", async () => {
    const many = Array.from({ length: STORAGE_LIST_PAGE * 2 + 7 }, (_, i) => `snapshots/x/f${i}.json`);
    const s = makeBucket(many);
    const paths = await listAllStorageFiles(s.bucket as any, "snapshots/x/");
    expect(paths.length).toBe(many.length);
    expect(s.listCalls.length).toBe(3);
  });
});

describe("deleteSnapshotCanonical", () => {
  it("잠금 스냅샷은 Storage 접근 전에 SNAPSHOT_LOCKED 로 차단한다", async () => {
    const s = makeBucket(["snapshots/l/f.json"]);
    const { client, deletedRows } = makeClient(
      { id: "l", storage_path: "snapshots/l/", is_locked: true, size_bytes: 1, name: "l" },
      s.bucket,
    );
    await expect(deleteSnapshotCanonical(client, "l", BUCKET)).rejects.toBeInstanceOf(SnapshotDeleteError);
    expect(s.listCalls.length).toBe(0);
    expect(deletedRows).toEqual([]);
  });

  it("잔존 파일이 있으면 DB 행을 삭제하지 않는다", async () => {
    const s = makeBucket(["snapshots/k/f.json"], { keepAll: true });
    const { client, deletedRows } = makeClient(
      { id: "k", storage_path: "snapshots/k/", is_locked: false, size_bytes: 5, name: "k" },
      s.bucket,
    );
    await expect(deleteSnapshotCanonical(client, "k", BUCKET)).rejects.toMatchObject({
      code: "SNAPSHOT_STORAGE_NOT_EMPTY",
    });
    expect(deletedRows).toEqual([]);
  });

  it("잠금되지 않은 스냅샷은 파일 전수 삭제 후 행을 삭제한다", async () => {
    const s = makeBucket(["snapshots/o/1.json", "snapshots/o/2.json"]);
    const { client, deletedRows } = makeClient(
      { id: "o", storage_path: "snapshots/o/", is_locked: false, size_bytes: 99, name: "o" },
      s.bucket,
    );
    const res = await deleteSnapshotCanonical(client, "o", BUCKET);
    expect(res).toMatchObject({ id: "o", deleted_files: 2, freed_bytes: 99 });
    expect(s.remaining()).toEqual([]);
    expect(deletedRows).toEqual(["o"]);
  });

  it("행이 없으면 SNAPSHOT_NOT_FOUND", async () => {
    const s = makeBucket([]);
    const { client } = makeClient(null, s.bucket);
    await expect(deleteSnapshotCanonical(client, "zz", BUCKET)).rejects.toMatchObject({
      code: "SNAPSHOT_NOT_FOUND",
    });
  });

  it("일괄삭제는 한 건 실패 후에도 계속 진행하고 성공/실패를 분리한다", async () => {
    const results: { ok: string[]; failed: { id: string; code: string }[] } = { ok: [], failed: [] };
    for (const id of ["ok1", "locked", "ok2"]) {
      const s = makeBucket([`snapshots/${id}/f.json`]);
      const { client } = makeClient(
        { id, storage_path: `snapshots/${id}/`, is_locked: id === "locked", size_bytes: 1, name: id },
        s.bucket,
      );
      try {
        const r = await deleteSnapshotCanonical(client, id, BUCKET);
        results.ok.push(r.id);
      } catch (err) {
        results.failed.push({ id, code: (err as SnapshotDeleteError).code });
      }
    }
    expect(results.ok).toEqual(["ok1", "ok2"]);
    expect(results.failed).toEqual([{ id: "locked", code: "SNAPSHOT_LOCKED" }]);
  });
});
