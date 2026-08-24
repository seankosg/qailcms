/**
 * 스냅샷 삭제 정본(single source of truth).
 * 개별삭제 / 선택 일괄삭제 / 보관기간 정리 모두 이 함수를 호출한다.
 *
 * 순서:
 *  1) 스냅샷 행 조회 → 없으면 SNAPSHOT_NOT_FOUND
 *  2) is_locked → Storage 접근 전에 SNAPSHOT_LOCKED 로 거부
 *  3) Storage 폴더 전수 조회(페이지네이션 + 하위 폴더 재귀)
 *  4) 청크 삭제
 *  5) 재조회하여 잔존 0건 확인 → 아니면 SNAPSHOT_STORAGE_NOT_EMPTY (DB 행 유지)
 *  6) database_snapshots 행 삭제
 */

export const STORAGE_LIST_PAGE = 100;
export const STORAGE_REMOVE_CHUNK = 100;
/** 허용 재귀 탐색 깊이. 초과 시 조용히 빈 목록을 반환하지 않고 명시적으로 차단한다. */
export const STORAGE_MAX_DEPTH = 8;

export type MinimalStorageObject = { name: string; id?: string | null };

export type MinimalStorageBucket = {
  list: (
    folder: string,
    opts: { limit: number; offset: number },
  ) => Promise<{ data: MinimalStorageObject[] | null; error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ data?: unknown; error: { message: string } | null }>;
};

export type MinimalSnapshotClient = {
  storage: { from: (bucket: string) => MinimalStorageBucket };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: any; error: { message: string } | null }>;
      };
    };
    delete: () => { eq: (col: string, val: string) => Promise<{ error: { message: string } | null }> };
  };
};

export class SnapshotDeleteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  SNAPSHOT_NOT_FOUND: "백업을 찾을 수 없습니다.",
  SNAPSHOT_LOCKED: "잠금된 백업은 삭제할 수 없습니다. 먼저 잠금을 해제하십시오.",
  SNAPSHOT_STORAGE_NOT_EMPTY: "Storage 파일이 남아 있어 백업 목록을 삭제하지 않았습니다.",
  SNAPSHOT_STORAGE_LIST_FAILED: "Storage 파일 목록 조회에 실패했습니다.",
  SNAPSHOT_STORAGE_DELETE_FAILED: "Storage 파일 삭제에 실패했습니다.",
  SNAPSHOT_ROW_DELETE_FAILED: "백업 목록 행 삭제에 실패했습니다.",
};

function fail(code: string, detail?: string): never {
  throw new SnapshotDeleteError(code, detail ? `${MESSAGES[code] ?? code} (${detail})` : (MESSAGES[code] ?? code));
}

function normalizeFolder(folder: string): string {
  return folder.endsWith("/") ? folder.slice(0, -1) : folder;
}

/** 폴더의 모든 파일 경로를 페이지네이션 + 하위 폴더 재귀로 전수 조회한다. */
export async function listAllStorageFiles(
  bucket: MinimalStorageBucket,
  folder: string,
  depth = 0,
): Promise<string[]> {
  if (depth > STORAGE_MAX_DEPTH) {
    fail(
      "SNAPSHOT_STORAGE_DEPTH_EXCEEDED",
      `경로=${folder}, 허용 최대 깊이=${STORAGE_MAX_DEPTH}`,
    );
  }
  const base = normalizeFolder(folder);
  const paths: string[] = [];
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await bucket.list(base, { limit: STORAGE_LIST_PAGE, offset });
    if (error) fail("SNAPSHOT_STORAGE_LIST_FAILED", error.message);
    const rows = data ?? [];
    for (const row of rows) {
      if (!row?.name) continue;
      const full = `${base}/${row.name}`;
      // id 가 null 이면 하위 폴더(placeholder) — 재귀 조회
      if (row.id === null || row.id === undefined) {
        const nested = await listAllStorageFiles(bucket, full, depth + 1);
        if (nested.length) paths.push(...nested);
        else if (row.id !== null) paths.push(full);
      } else {
        paths.push(full);
      }
    }
    if (rows.length < STORAGE_LIST_PAGE) break;
    offset += STORAGE_LIST_PAGE;
  }
  return paths;
}

export type SnapshotDeleteResult = {
  id: string;
  name: string | null;
  deleted_files: number;
  freed_bytes: number;
};

export async function deleteSnapshotCanonical(
  client: MinimalSnapshotClient,
  snapshotId: string,
  bucketName: string,
): Promise<SnapshotDeleteResult> {
  const { data: snapshot, error: findError } = await client
    .from("database_snapshots")
    .select("id, storage_path, is_locked, size_bytes, name, created_at")
    .eq("id", snapshotId)
    .maybeSingle();
  if (findError) fail("SNAPSHOT_NOT_FOUND", findError.message);
  if (!snapshot) fail("SNAPSHOT_NOT_FOUND");

  // 잠금 검사는 Storage 접근 전에 수행한다.
  if (snapshot.is_locked) fail("SNAPSHOT_LOCKED");

  const bucket = client.storage.from(bucketName);
  const folder = snapshot.storage_path ?? `snapshots/${snapshotId}/`;

  const paths = await listAllStorageFiles(bucket, folder);
  for (let i = 0; i < paths.length; i += STORAGE_REMOVE_CHUNK) {
    const chunk = paths.slice(i, i + STORAGE_REMOVE_CHUNK);
    const { error } = await bucket.remove(chunk);
    if (error) fail("SNAPSHOT_STORAGE_DELETE_FAILED", error.message);
  }

  // 삭제 후 잔존 확인 — 남아 있으면 DB 행을 삭제하지 않는다.
  const remaining = await listAllStorageFiles(bucket, folder);
  if (remaining.length > 0) fail("SNAPSHOT_STORAGE_NOT_EMPTY", `잔존 ${remaining.length}건`);

  const { error: removeError } = await client.from("database_snapshots").delete().eq("id", snapshotId);
  if (removeError) fail("SNAPSHOT_ROW_DELETE_FAILED", removeError.message);

  return {
    id: snapshotId,
    name: snapshot.name ?? null,
    deleted_files: paths.length,
    freed_bytes: snapshot.size_bytes ?? 0,
  };
}

export function toFailure(id: string, err: unknown): { id: string; code: string; message: string } {
  if (err instanceof SnapshotDeleteError) return { id, code: err.code, message: err.message };
  return { id, code: "SNAPSHOT_DELETE_FAILED", message: (err as Error)?.message ?? String(err) };
}
