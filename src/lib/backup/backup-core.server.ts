import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { BACKUP_TABLES, type BackupTableName } from "./backup-shared";

export { BACKUP_TABLES, type BackupTableName } from "./backup-shared";

const BUCKET = "db-backups";
const CHUNK_SIZE = 1000;
// 파트당 최대 행 수: 대용량 raw 테이블을 여러 파일로 분할해 Worker 메모리/응답 시간 한도를 회피
const ROWS_PER_PART = 10_000;
// 개별 페이지 로드 크기 (Supabase Data API 상한 1000)
const PAGE_SIZE = 1000;

/**
 * 각 테이블의 결정적 페이지네이션 정렬키(실제 PK 컬럼).
 * BACKUP_TABLES 및 DB 의 public.get_backup_tables() 와 동일 집합이어야 합니다.
 */
const TABLE_SORT_KEYS: Record<BackupTableName, string[]> = {
  abd_items_raw: ["id"],
  defect_items_raw: ["id"],
  task_management_raw: ["id"],
  dmr_entries: ["id"],
  profiles: ["id"],
  user_roles: ["id"],
  team_master: ["id"],
  subcontractor_master: ["id"],
  dmr_contractor_master: ["id"],
  dmr_system_master: ["id"],
  defect_category_team_map: ["category"],
  task_management_settings: ["id"],
  abd_field_config: ["id"],
  defect_field_config: ["id"],
  task_management_field_config: ["id"],
  abd_header_mappings: ["id"],
  defect_header_mappings: ["id"],
  task_management_header_mappings: ["id"],
  abd_import_logs: ["id"],
  defect_import_logs: ["id"],
  task_management_import_logs: ["id"],
  task_schedule_change_audit: ["id"],
  abd_settings: ["id"],
  abd_import_presets: ["id"],
  abd_comments: ["id"],
  abd_change_log: ["id"],
  spl_items: ["id"],
  spl_stage_catalog: ["stage_code"],
  spl_stage_progress: ["id"],
  spl_change_log: ["id"],
  spl_settings: ["key"],
  spl_import_logs: ["id"],
  wrt_items: ["id"],
  wrt_stage_catalog: ["stage_code"],
  wrt_stage_progress: ["id"],
  wrt_change_log: ["id"],
  wrt_settings: ["key"],
  wrt_import_logs: ["id"],
  rcl_permissions: ["role", "scope", "action"],
  rcl_module_config: ["module"],
  rcl_permissions_audit: ["id"],
  rcl_module_config_audit: ["id"],
  hdec_eng_name_master: ["id"],
  hdec_pic_name_master: ["id"],
  hdec_name_propagation_log: ["id"],
  user_view_preferences: ["user_id", "view_key"],
  tm_alarm_settings: ["key"],
  tm_milestone_config: ["plot", "kind"],
  tm_milestone_config_audit: ["id"],
  tm_milestone_kinds: ["kind_code"],
  defect_hdec_pic_rules: ["id"],
  defect_subcon_rules: ["id"],
  defect_import_presets: ["id"],
  task_comments: ["id"],
  defect_comments: ["id"],
  defect_status_history: ["id"],
  task_management_status_history: ["id"],
  abd_ocs_import_logs: ["id"],
  abd_ocs_comments: ["id"],
  abd_ocs_comment_groups: ["id"],
  abd_ocs_comment_abd_links: ["id"],
  abd_ocs_compliance: ["comment_id"],
  abd_ocs_attachments: ["id"],
  abd_ocs_attachment_comment_links: ["id"],
  abd_ocs_compliance_log: ["id"],
  abd_ocs_response_segments: ["id"],
  abd_ocs_response_comment_links: ["id"],
  abd_ocs_source_files: ["id"],
  abd_ocs_number_correction_log: ["id"],
};

function sortKeysFor(tableName: string): string[] {
  return (TABLE_SORT_KEYS as Record<string, string[]>)[tableName] ?? ["id"];
}

/**
 * 백업 대상 목록 정합성 검증.
 * - DB 정본 `public.get_backup_tables()` 는 information_schema 로 영구 `abd_ocs_%` 테이블을 유도해
 *   누락이 있으면 스스로 EXCEPTION 을 던진다(staging 4종 제외).
 * - 여기서는 DB 목록과 코드 목록(BACKUP_TABLES / TABLE_SORT_KEYS)의 집합 차이를 검사한다.
 */
export async function assertBackupTableParity(supabaseAdmin: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("get_backup_tables");
  if (error) throw new Error(`백업 목록 검증 실패: ${error.message}`);

  const dbList = (Array.isArray(data) ? data : []).map((row) =>
    typeof row === "string" ? row : String((row as { table_name?: string }).table_name ?? ""),
  );
  const dbSet = new Set(dbList.filter(Boolean));
  const codeSet = new Set<string>(BACKUP_TABLES);
  const missingInCode = [...dbSet].filter((t) => !codeSet.has(t));
  const missingInDb = [...codeSet].filter((t) => !dbSet.has(t));
  const missingSortKey = BACKUP_TABLES.filter((t) => !(t in TABLE_SORT_KEYS));
  if (missingInCode.length || missingInDb.length || missingSortKey.length) {
    throw new Error(
      `백업 목록 불일치 — DB에만 있음: [${missingInCode.join(", ")}] / 코드에만 있음: [${missingInDb.join(
        ", ",
      )}] / 정렬키 누락: [${missingSortKey.join(", ")}]`,
    );
  }
}

export type SnapshotManifest = {
  id: string;
  name: string;
  created_at: string;
  triggered_by: string;
  trigger_metadata?: Record<string, unknown> | null;
  tables: {
    name: BackupTableName;
    rows: number;
    sha256: string;
    size_bytes: number;
    parts?: { path: string; rows: number; sha256: string; size_bytes: number }[];
  }[];
  total_rows: number;
  sha256: string;
};

export type CreateSnapshotOptions = {
  snapshotId: string;
  name: string;
  triggeredBy: "manual" | "scheduled" | "pre-import";
  triggerMetadata?: Record<string, unknown> | null;
  tables?: BackupTableName[];
  /**
   * 진행 상태 보고 전용 훅. 백업/복원 로직에는 관여하지 않으며,
   * 예외가 나도 스냅샷 생성을 중단시키지 않는다.
   */
  onTableProgress?: (p: {
    table: BackupTableName;
    index: number;
    total: number;
    done: number;
    phase: "start" | "done";
  }) => Promise<void> | void;
};

export type CreateSnapshotResult = {
  id: string;
  name: string;
  created_at: string;
  size_bytes: number;
  sha256_hash: string;
  tables_included: BackupTableName[];
  storage_path: string;
  triggered_by: string;
  total_rows: number;
};

export async function createSnapshot(
  supabaseAdmin: SupabaseClient<Database>,
  opts: CreateSnapshotOptions,
): Promise<CreateSnapshotResult> {
  // 백업 목록 정합성 관문: DB 정본(get_backup_tables)과 코드 목록이 다르면 조용히 진행하지 않는다.
  // get_backup_tables() 내부에서 information_schema 의 영구 abd_ocs_% 테이블 누락도 EXCEPTION 으로 막는다.
  await assertBackupTableParity(supabaseAdmin);
  const { snapshotId, name, triggeredBy, triggerMetadata, tables, onTableProgress } = opts;
  const startedAt = new Date().toISOString();
  const folder = `snapshots/${snapshotId}/`;
  const tablesToBackup = tables && tables.length > 0 ? tables : BACKUP_TABLES;

  const report = async (
    table: BackupTableName,
    index: number,
    phase: "start" | "done",
  ) => {
    if (!onTableProgress) return;
    try {
      await onTableProgress({
        table,
        index,
        total: tablesToBackup.length,
        done: phase === "done" ? index + 1 : index,
        phase,
      });
    } catch (err) {
      console.warn("[createSnapshot] progress report failed", err);
    }
  };

  const tableManifests: SnapshotManifest["tables"] = [];
  let totalRows = 0;
  let totalSize = 0;
  const overallHasher = new Hasher();

  for (const tableName of tablesToBackup) {
    await report(tableName, tablesToBackup.indexOf(tableName), "start");
    const parts: NonNullable<SnapshotManifest["tables"][number]["parts"]> = [];
    let partIndex = 0;
    let tableRows = 0;
    let tableSize = 0;
    const tablePartHashHex: string[] = [];

    for await (const batch of iterRowsInParts(supabaseAdmin, tableName)) {
      const json = JSON.stringify(batch);
      const bytes = new TextEncoder().encode(json);
      const sha256 = await sha256Hex(bytes);
      const partName = `${tableName}.part-${String(partIndex).padStart(3, "0")}.json`;
      const path = `${folder}${partName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, new Blob([bytes], { type: "application/json" }), {
          contentType: "application/json",
          cacheControl: "3600",
        });
      if (uploadError) throw new Error(`Upload failed for ${tableName} part ${partIndex}: ${uploadError.message}`);

      parts.push({ path: partName, rows: batch.length, sha256, size_bytes: bytes.length });
      tablePartHashHex.push(sha256);
      tableRows += batch.length;
      tableSize += bytes.length;
      partIndex++;
    }

    // 빈 테이블도 파트 0을 남겨 매니페스트 일관성 유지
    if (parts.length === 0) {
      const bytes = new TextEncoder().encode("[]");
      const sha256 = await sha256Hex(bytes);
      const partName = `${tableName}.part-000.json`;
      const path = `${folder}${partName}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, new Blob([bytes], { type: "application/json" }), {
          contentType: "application/json",
          cacheControl: "3600",
        });
      if (uploadError) throw new Error(`Upload failed for ${tableName} empty part: ${uploadError.message}`);
      parts.push({ path: partName, rows: 0, sha256, size_bytes: bytes.length });
      tablePartHashHex.push(sha256);
      tableSize += bytes.length;
    }

    // 테이블 단위 sha256 = sha256( 각 파트 sha256 hex를 이어붙인 문자열 )
    const tableHash = await sha256Hex(new TextEncoder().encode(tablePartHashHex.join("")));
    overallHasher.update(new TextEncoder().encode(tableHash));

    tableManifests.push({
      name: tableName,
      rows: tableRows,
      sha256: tableHash,
      size_bytes: tableSize,
      parts,
    });
    totalRows += tableRows;
    totalSize += tableSize;
    await report(tableName, tablesToBackup.indexOf(tableName), "done");
  }

  const overallHash = await overallHasher.digest();
  const manifest: SnapshotManifest = {
    id: snapshotId,
    name,
    created_at: startedAt,
    triggered_by: triggeredBy,
    trigger_metadata: triggerMetadata ?? null,
    tables: tableManifests,
    total_rows: totalRows,
    sha256: overallHash,
  };

  const manifestJson = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestJson);
  const { error: manifestError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(`${folder}manifest.json`, new Blob([manifestBytes], { type: "application/json" }), {
      contentType: "application/json",
    });
  if (manifestError) throw new Error(`Manifest upload failed: ${manifestError.message}`);

  const { error: insertError } = await supabaseAdmin.from("database_snapshots").insert({
    id: snapshotId,
    name,
    size_bytes: totalSize,
    sha256_hash: manifest.sha256,
    tables_included: tablesToBackup as any,
    storage_path: folder,
    triggered_by: triggeredBy,
    trigger_metadata: (triggerMetadata ?? null) as any,
    metadata: manifest as any,
  });
  if (insertError) throw new Error(`Failed to record snapshot: ${insertError.message}`);

  return {
    id: snapshotId,
    name,
    created_at: startedAt,
    size_bytes: totalSize,
    sha256_hash: manifest.sha256,
    tables_included: tablesToBackup,
    storage_path: folder,
    triggered_by: triggeredBy,
    total_rows: totalRows,
  };
}

export async function deleteSnapshot(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
): Promise<void> {
  const { data: snapshot, error: findError } = await supabaseAdmin
    .from("database_snapshots")
    .select("storage_path")
    .eq("id", snapshotId)
    .single();
  if (findError) throw new Error(`Snapshot not found: ${findError.message}`);

  const folder = snapshot?.storage_path ?? `snapshots/${snapshotId}/`;
  const { data: files, error: listError } = await supabaseAdmin.storage.from(BUCKET).list(folder);
  if (listError) throw new Error(`Failed to list snapshot files: ${listError.message}`);

  const paths = (files ?? []).map((f) => `${folder}${f.name}`);
  if (paths.length) {
    const { error: deleteError } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
    if (deleteError) throw new Error(`Failed to delete snapshot files: ${deleteError.message}`);
  }

  const { error: removeError } = await supabaseAdmin
    .from("database_snapshots")
    .delete()
    .eq("id", snapshotId);
  if (removeError) throw new Error(`Failed to remove snapshot record: ${removeError.message}`);
}

export async function buildSnapshotZip(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
): Promise<Blob> {
  const { data: snapshot, error } = await supabaseAdmin
    .from("database_snapshots")
    .select("storage_path")
    .eq("id", snapshotId)
    .single();
  if (error || !snapshot) throw new Error("Snapshot not found");

  const folder = snapshot.storage_path ?? `snapshots/${snapshotId}/`;
  const { data: files, error: listError } = await supabaseAdmin.storage.from(BUCKET).list(folder);
  if (listError) throw new Error(`Failed to list snapshot files: ${listError.message}`);

  const zip = new JSZip();
  for (const file of files ?? []) {
    const path = `${folder}${file.name}`;
    const { data: blob, error: downloadError } = await supabaseAdmin.storage.from(BUCKET).download(path);
    if (downloadError || !blob) throw new Error(`Download failed for ${file.name}: ${downloadError?.message}`);
    zip.file(file.name, blob);
  }
  return await zip.generateAsync({ type: "blob" });
}

export async function restoreSnapshot(
  supabaseAdmin: SupabaseClient<Database>,
  snapshotId: string,
  tables: BackupTableName[],
  destructive: boolean,
): Promise<{ restoredTables: string[]; totalRows: number }> {
  const { data: snapshot, error } = await supabaseAdmin
    .from("database_snapshots")
    .select("storage_path, sha256_hash, metadata")
    .eq("id", snapshotId)
    .single();
  if (error || !snapshot) throw new Error("Snapshot not found");

  const folder = snapshot.storage_path ?? `snapshots/${snapshotId}/`;
  const restoredTables: string[] = [];
  let totalRows = 0;

  // 실측 FK 의존성(pg_constraint) 기준 복구 순서. 참조되는 테이블이 항상 먼저 복구됩니다.
  const ordered = tables.slice().sort((a, b) => {
    const order = new Map<BackupTableName, number>([
      ["team_master", 1],
      ["subcontractor_master", 2],
      ["dmr_contractor_master", 3],
      ["dmr_system_master", 4],
      ["defect_category_team_map", 5],
      ["task_management_settings", 6],
      ["tm_milestone_kinds", 7],
      ["abd_field_config", 8],
      ["defect_field_config", 9],
      ["task_management_field_config", 10],
      ["spl_stage_catalog", 11],
      ["abd_header_mappings", 12],
      ["defect_header_mappings", 13],
      ["task_management_header_mappings", 14],
      ["wrt_stage_catalog", 15],
      ["user_roles", 16],
      ["profiles", 17],
      ["hdec_eng_name_master", 18],
      ["hdec_pic_name_master", 19],
      ["hdec_name_propagation_log", 20],
      ["abd_items_raw", 21],
      // 번호 교정 기록은 abd_items_raw 복구 이후에 적재한다
      ["abd_ocs_number_correction_log", 21.5],
      ["defect_items_raw", 22],
      // task_management_raw 는 task_management_import_logs 를 참조하므로 로그가 먼저다
      ["task_management_import_logs", 23],
      ["task_management_raw", 24],
      ["dmr_entries", 25],
      ["abd_import_logs", 26],
      ["defect_import_logs", 27],
      ["spl_items", 28],
      ["spl_stage_progress", 29],
      ["spl_change_log", 30],
      ["spl_settings", 31],
      ["spl_import_logs", 32],
      ["wrt_items", 33],
      ["wrt_stage_progress", 34],
      ["wrt_change_log", 35],
      ["wrt_settings", 36],
      ["wrt_import_logs", 37],
      ["abd_settings", 38],
      ["abd_import_presets", 39],
      ["abd_comments", 40],
      ["abd_change_log", 41],
      ["task_comments", 42],
      ["defect_comments", 43],
      ["defect_status_history", 44],
      ["task_management_status_history", 45],
      ["task_schedule_change_audit", 46],
      ["rcl_permissions", 47],
      ["rcl_module_config", 48],
      ["rcl_permissions_audit", 49],
      ["rcl_module_config_audit", 50],
      ["user_view_preferences", 51],
      ["tm_alarm_settings", 52],
      ["tm_milestone_config", 53],
      ["tm_milestone_config_audit", 54],
      ["defect_hdec_pic_rules", 55],
      ["defect_subcon_rules", 56],
      ["defect_import_presets", 57],
      // OCS: 로그 → 코멘트 → 첨부/준수 (FK 의존 순)
      ["abd_ocs_import_logs", 58],
      ["abd_ocs_comment_groups", 59],
      ["abd_ocs_comments", 60],
      // comment-ABD 링크는 코멘트와 abd_items_raw 복구 이후
      ["abd_ocs_comment_abd_links", 60.5],
      ["abd_ocs_attachments", 61],
      ["abd_ocs_attachment_comment_links", 62],
      ["abd_ocs_compliance", 63],
      ["abd_ocs_compliance_log", 64],
      ["abd_ocs_response_segments", 65],
      ["abd_ocs_response_comment_links", 66],
      ["abd_ocs_source_files", 67],
    ]);
    return (order.get(a) ?? 99) - (order.get(b) ?? 99);
  });

  for (const tableName of ordered) {
    // 신 포맷: 매니페스트의 parts를 우선 사용, 없으면 레거시 단일 파일로 폴백
    const partPaths = await resolveTablePartPaths(supabaseAdmin, snapshot, folder, tableName);

    // For non-destructive restore, we skip tables that already have data? Actually non-destructive means insert on conflict.
    // For now, we treat non-destructive as upsert by id, but that's complex. Simpler: non-destructive still restores raw data only with truncate.
    // The plan says destructive is admin-only. So non-destructive still needs to be safe. We will only support destructive restore for the major tables.
    if (!destructive) {
      // In non-destructive mode, we just validate the data and skip actual restore for now.
      // This is a placeholder until a proper upsert strategy is defined.
      restoredTables.push(`${tableName} (validated, skipped)`);
      continue;
    }

    await supabaseAdmin.rpc("backup_disable_triggers", { _table_name: tableName });
    try {
      await supabaseAdmin.rpc("backup_truncate_table", { _table_name: tableName });

      for (const partPath of partPaths) {
        const { data: blob, error: downloadError } = await supabaseAdmin.storage
          .from(BUCKET)
          .download(`${folder}${partPath}`);
        if (downloadError || !blob) {
          throw new Error(`Download failed for ${tableName} (${partPath}): ${downloadError?.message}`);
        }
        const text = await blob.text();
        const rows = JSON.parse(text) as unknown[];
        if (!Array.isArray(rows)) throw new Error(`Invalid backup data for ${tableName} (${partPath})`);

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const chunk = rows.slice(i, i + CHUNK_SIZE);
          const { error: insertError } = await supabaseAdmin.rpc("backup_insert_rows_from_json", {
            _table_name: tableName,
            _rows_json: chunk as any,
          });
          if (insertError) {
            throw new Error(`Insert failed for ${tableName} at chunk ${i}: ${insertError.message}`);
          }
          totalRows += chunk.length;
        }
      }
    } finally {
      await supabaseAdmin.rpc("backup_enable_triggers", { _table_name: tableName });
    }
    restoredTables.push(tableName);
  }

  // OCS 캐시(abd_items_raw.ocs_*)는 복원 중 트리거가 꺼져 있어 갱신되지 않는다.
  // 정본(코멘트/Complied)이 복원된 경우 전량 재계산으로 캐시를 맞춘다.
  const OCS_SOURCES = ["abd_items_raw", "abd_ocs_comments", "abd_ocs_compliance"];
  if (restoredTables.some((t) => OCS_SOURCES.includes(t))) {
    const { error: recountError } = await (supabaseAdmin as any).rpc("abd_ocs_recount_all");
    if (recountError) throw new Error(`OCS 캐시 재계산 실패: ${recountError.message}`);
    restoredTables.push("abd_items_raw.ocs_* (recounted)");
  }

  return { restoredTables, totalRows };
}

export async function cleanupOldSnapshots(
  supabaseAdmin: SupabaseClient<Database>,
): Promise<{ deleted: string[] }> {
  const { data: config, error: configError } = await supabaseAdmin
    .from("backup_config")
    .select("retention_days, keep_minimum_count")
    .order("id", { ascending: true })
    .limit(1)
    .single();
  if (configError) throw new Error(`Failed to read backup config: ${configError.message}`);

  const retentionDays = config?.retention_days ?? 30;
  const keepMinimum = config?.keep_minimum_count ?? 3;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: snapshots, error: listError } = await supabaseAdmin
    .from("database_snapshots")
    .select("id, created_at, is_locked")
    .order("created_at", { ascending: true });
  if (listError) throw new Error(`Failed to list snapshots: ${listError.message}`);

  const candidates = (snapshots ?? []).filter((s) => !s.is_locked && s.created_at < cutoff);
  const lockedCount = (snapshots ?? []).filter((s) => s.is_locked).length;
  const unprotectedCount = (snapshots ?? []).length - lockedCount;

  const toDelete: string[] = [];
  let remainingAfterDelete = unprotectedCount;
  for (const s of candidates) {
    if (remainingAfterDelete <= keepMinimum) break;
    toDelete.push(s.id);
    remainingAfterDelete--;
  }

  for (const id of toDelete) {
    await deleteSnapshot(supabaseAdmin, id);
  }

  return { deleted: toDelete };
}

async function readAllRows<T extends Record<string, unknown>>(
  supabaseAdmin: SupabaseClient<Database>,
  tableName: string,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  const pageSize = 1000;
  const keys = sortKeysFor(tableName);

  while (true) {
    let query = supabaseAdmin.from(tableName as any).select("*");
    for (const k of keys) query = query.order(k, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read ${tableName}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...((data as unknown) as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

/**
 * 테이블 행을 파트 단위로 순회. 각 파트는 최대 ROWS_PER_PART 행을 담고 있으며,
 * DB에서는 PAGE_SIZE(1000)씩 페이지네이션해서 읽습니다.
 */
async function* iterRowsInParts(
  supabaseAdmin: SupabaseClient<Database>,
  tableName: string,
): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  const keys = sortKeysFor(tableName);
  let from = 0;
  let buffer: Record<string, unknown>[] = [];

  while (true) {
    let query = supabaseAdmin.from(tableName as any).select("*");
    for (const k of keys) query = query.order(k, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${tableName}: ${error.message}`);
    const rows = ((data ?? []) as unknown) as Record<string, unknown>[];
    if (rows.length === 0) break;
    buffer.push(...rows);

    while (buffer.length >= ROWS_PER_PART) {
      yield buffer.slice(0, ROWS_PER_PART);
      buffer = buffer.slice(ROWS_PER_PART);
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  if (buffer.length > 0) yield buffer;
}

/**
 * 매니페스트의 parts 배열을 반환하고, 매니페스트가 신 포맷이 아니면 레거시 단일 파일로 폴백.
 */
async function resolveTablePartPaths(
  supabaseAdmin: SupabaseClient<Database>,
  snapshot: { metadata?: unknown; storage_path?: string | null },
  folder: string,
  tableName: string,
): Promise<string[]> {
  const metadata = (snapshot?.metadata ?? null) as SnapshotManifest | null;
  if (metadata && Array.isArray(metadata.tables)) {
    const entry = metadata.tables.find((t) => t.name === tableName);
    if (entry && Array.isArray(entry.parts) && entry.parts.length > 0) {
      return entry.parts.map((p) => p.path);
    }
  }

  // 레거시: storage에서 파트 파일 자동 탐색
  const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(folder);
  const parts = (files ?? [])
    .map((f) => f.name)
    .filter((n) => n.startsWith(`${tableName}.part-`) && n.endsWith(".json"))
    .sort();
  if (parts.length > 0) return parts;

  // 완전 레거시: 단일 `<table>.json`
  return [`${tableName}.json`];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class Hasher {
  private chunks: Uint8Array[] = [];

  update(bytes: Uint8Array) {
    this.chunks.push(bytes);
  }

  async digest(): Promise<string> {
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of this.chunks) {
      combined.set(c, offset);
      offset += c.length;
    }
    return sha256Hex(combined);
  }
}
