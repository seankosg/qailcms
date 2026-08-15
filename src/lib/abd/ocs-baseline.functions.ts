// ABD OCS Latest Baseline — 생성·재사용·서명 URL 발급 (strict admin 전용, 읽기 전용 추출).
// 정본 테이블은 변경하지 않는다. 산식은 ocs-baseline-shared.ts 하나에만 있다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAbdOcsAccess } from "@/lib/abd/ocs-access";
import {
  BASELINE_BUCKET,
  BASELINE_DATASETS,
  BASELINE_SCHEMA_VERSION,
  BASELINE_SIGNED_URL_SECONDS,
  BASELINE_ABD_INDEX_PATH,
  ABD_ITEMS_INDEX_SCHEMA,
  baselineFileName,
  baselineFolder,
  computeBaselineId,
  sha256Hex,
  type BaselineDataset,
} from "@/lib/abd/ocs-baseline-shared";
import { normalizeAbdNumber } from "@/lib/abd/ocs-number-normalize";

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  await assertAbdOcsAccess(supabase, userId);
}

async function rpc(supabase: unknown, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as Record<string, unknown>;
}

const CHUNK: Record<BaselineDataset, number> = {
  comments: 2000,
  comment_groups: 4000,
  comment_abd_links: 4000,
  attachments: 4000,
  attachment_comment_links: 4000,
  response_segments: 4000,
  response_comment_links: 4000,
  compliance: 4000,
  source_files: 4000,
  number_corrections: 4000,
};

/** Doha(Asia/Qatar, UTC+3) 달력 날짜 */
function dohaDate(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
function dohaStampCompact(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

export type BaselineFileInfo = {
  name: string;
  byte_size: number;
  sha256: string;
  row_count: number;
};

/** 브라우저 검증 sidecar 선언 (manifest.validation_files) */
export type BaselineValidationFileInfo = {
  relative_path: string;
  byte_size: number;
  sha256: string;
  row_count: number;
};

type AbdIndexRow = {
  abd_item_id: string;
  abd_number: string;
  normalized_abd_number: string;
  is_active: boolean;
};

/**
 * 로컬 검증용 ABD 번호 인덱스 (읽기 전용 최소 필드).
 * 이름·팀·PIC·날짜 등 검증에 불필요한 Raw Data 필드는 담지 않는다.
 * active 정규화 키가 복수 ABD 에 걸리면 Baseline 생성 자체를 차단한다.
 */
async function buildAbdItemsIndex(supabase: unknown): Promise<AbdIndexRow[]> {
  const client = supabase as {
    from: (t: string) => {
      select: (
        c: string,
      ) => {
        order: (
          c: string,
          o: { ascending: boolean },
        ) => {
          range: (
            a: number,
            b: number,
          ) => Promise<{
            data: { id: string; abd_number: string | null; is_active: boolean | null }[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  const PAGE = 1000;
  const rows: AbdIndexRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("abd_items_raw")
      .select("id, abd_number, is_active")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`abd_items_index: ${error.message}`);
    const page = data ?? [];
    for (const r of page) {
      const num = String(r.abd_number ?? "").trim();
      if (!num) continue;
      rows.push({
        abd_item_id: r.id,
        abd_number: num,
        normalized_abd_number: normalizeAbdNumber(num),
        is_active: r.is_active !== false,
      });
    }
    if (page.length < PAGE) break;
    if (offset > 500_000) throw new Error("ABD_INDEX_RUNAWAY");
  }

  const byNorm = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.is_active) continue;
    const set = byNorm.get(r.normalized_abd_number) ?? new Set<string>();
    set.add(r.abd_number);
    byNorm.set(r.normalized_abd_number, set);
  }
  const ambiguous = [...byNorm.entries()].filter(([, v]) => v.size > 1);
  if (ambiguous.length > 0) {
    throw new Error(
      `ABD_INDEX_AMBIGUOUS: 정규화 키가 복수 active ABD 에 해당합니다 — ${ambiguous
        .slice(0, 5)
        .map(([k, v]) => `${k} → ${[...v].join(" / ")}`)
        .join(" ; ")}`,
    );
  }
  return rows;
}

export type BaselineResult = {
  baseline_id: string;
  core_hash: string;
  core_table_hashes: Record<string, string>;
  schema_version: string;
  latest_success_import_run_id: string | null;
  latest_success_at: string | null;
  core_last_changed_at: string | null;
  generated_at: string;
  data_date: string;
  storage_path: string;
  zip_byte_size: number;
  total_rows: number;
  files: BaselineFileInfo[];
  validation_files: BaselineValidationFileInfo[];
  validation_row_count: number;
  reused: boolean;
  signed_url: string;
  signed_url_expires_in: number;
};

/** baseline_id 폴더의 ZIP 목록에서 sidecar 가 가리키는 최신 object 를 우선 반환 */
async function findExisting(admin: unknown, baselineId: string, preferName?: string | null) {
  const client = admin as {
    storage: {
      from: (b: string) => {
        list: (
          p: string,
          o?: Record<string, unknown>,
        ) => Promise<{
          data: { name: string; metadata?: { size?: number } | null }[] | null;
          error: unknown;
        }>;
      };
    };
  };
  const { data } = await client.storage.from(BASELINE_BUCKET).list(baselineFolder(baselineId), {
    limit: 100,
  });
  const zips = (data ?? []).filter((f) => f.name.endsWith(".zip"));
  if (preferName) {
    const hit = zips.find((f) => f.name === preferName);
    if (hit) return hit;
  }
  return zips[0] ?? null;
}

/** 재사용 시 원래 metadata 를 되살리기 위한 manifest sidecar 경로 */
const sidecarPath = (baselineId: string) => `${baselineFolder(baselineId)}/manifest.json`;

type StoredManifest = {
  generated_at?: string;
  data_date?: string;
  total_rows?: number;
  base_core_table_hashes?: Record<string, string>;
  latest_success_at?: string | null;
  core_last_changed_at?: string | null;
  files?: { relative_path: string; byte_size: number; sha256: string; row_count: number }[];
  validation_files?: BaselineValidationFileInfo[];
  zip_object_name?: string;
};

async function readSidecar(admin: unknown, baselineId: string): Promise<StoredManifest | null> {
  const client = admin as {
    storage: {
      from: (b: string) => {
        download: (p: string) => Promise<{ data: Blob | null; error: unknown }>;
      };
    };
  };
  const { data } = await client.storage.from(BASELINE_BUCKET).download(sidecarPath(baselineId));
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as StoredManifest;
  } catch {
    return null;
  }
}

/**
 * 기존 object 재사용 가능 여부 — sidecar 선언과 ZIP 내부 실제 파일을 독립 검증한다.
 * 하나라도 어긋나면 재사용하지 않고 새 object 를 생성한다(기존 object 는 보존).
 */
async function existingZipHasValidSidecar(
  admin: unknown,
  path: string,
  stored: StoredManifest | null,
): Promise<boolean> {
  const decl = stored?.validation_files?.find((f) => f.relative_path === BASELINE_ABD_INDEX_PATH);
  if (!decl || !decl.sha256 || !Number.isFinite(decl.byte_size)) return false;
  const client = admin as {
    storage: {
      from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null }> };
    };
  };
  const { data } = await client.storage.from(BASELINE_BUCKET).download(path);
  if (!data) return false;
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await data.arrayBuffer());
    const entry = zip.file(BASELINE_ABD_INDEX_PATH);
    if (!entry) return false;
    const text = await entry.async("string");
    if (new TextEncoder().encode(text).byteLength !== decl.byte_size) return false;
    if ((await sha256Hex(text)) !== decl.sha256.toLowerCase()) return false;
    const parsed = JSON.parse(text) as { schema_version?: string; row_count?: number; rows?: unknown[] };
    if (parsed.schema_version !== ABD_ITEMS_INDEX_SCHEMA) return false;
    const rows = Array.isArray(parsed.rows) ? parsed.rows.length : -1;
    return rows >= 0 && rows === parsed.row_count && rows === decl.row_count;
  } catch {
    return false;
  }
}

export const createOcsBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaselineResult> => {
    await assertAdmin(context.supabase, context.userId);

    // 단일 호환 규격 — manifest 는 v1, 데이터셋 10종, 브라우저 검증 인덱스는 sidecar 로 항상 포함.
    const schemaVersion = BASELINE_SCHEMA_VERSION;

    // 1) core hash before + 최신 성공 Import run
    const before = await rpc(context.supabase, "abd_ocs_baseline_core_hash");
    const baselineInfo = await rpc(context.supabase, "abd_ocs_inc_baseline", {
      p_base_import_run_id: null,
    });
    const coreHashBefore = String(before["core_hash"] ?? "");
    const latestRunId = (baselineInfo["latest_success_import_run_id"] ?? null) as string | null;
    const baselineId = await computeBaselineId(
      schemaVersion,
      coreHashBefore,
      latestRunId ?? "",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2) 동일 baseline_id 재사용 — sidecar 무결성을 만족할 때만
    const storedForReuse = await readSidecar(supabaseAdmin, baselineId);
    const existing = await findExisting(
      supabaseAdmin,
      baselineId,
      storedForReuse?.zip_object_name ?? null,
    );
    const reusable =
      existing != null &&
      (await existingZipHasValidSidecar(
        supabaseAdmin,
        `${baselineFolder(baselineId)}/${existing.name}`,
        storedForReuse,
      ));
    if (existing && reusable) {
      const path = `${baselineFolder(baselineId)}/${existing.name}`;
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BASELINE_BUCKET)
        .createSignedUrl(path, BASELINE_SIGNED_URL_SECONDS);
      if (signErr) throw new Error(signErr.message);
      const stored = storedForReuse;
      if (!stored) {
        throw new Error(
          "BASELINE_SIDECAR_MISSING: 기존 ZIP 의 manifest sidecar 를 읽지 못했습니다. 해당 폴더를 정리한 뒤 다시 생성하십시오.",
        );
      }
      const storedFiles: BaselineFileInfo[] = (stored.files ?? []).map((f) => ({
        name: f.relative_path,
        byte_size: f.byte_size,
        sha256: f.sha256,
        row_count: f.row_count,
      }));
      const storedValidation = stored.validation_files ?? [];
      return {
        baseline_id: baselineId,
        core_hash: coreHashBefore,
        core_table_hashes: (stored.base_core_table_hashes ??
          before["core_table_hashes"] ??
          {}) as Record<string, string>,
        schema_version: schemaVersion,
        latest_success_import_run_id: latestRunId,
        latest_success_at: (stored.latest_success_at ??
          baselineInfo["latest_success_at"] ??
          null) as string | null,
        core_last_changed_at: (stored.core_last_changed_at ??
          before["core_last_changed_at"] ??
          null) as string | null,
        generated_at: stored.generated_at ?? "",
        data_date: stored.data_date ?? "",
        storage_path: path,
        zip_byte_size: existing.metadata?.size ?? 0,
        total_rows: stored.total_rows ?? storedFiles.reduce((s, f) => s + (f.row_count ?? 0), 0),
        files: storedFiles,
        validation_files: storedValidation,
        validation_row_count: storedValidation[0]?.row_count ?? 0,
        reused: true,
        signed_url: signed?.signedUrl ?? "",
        signed_url_expires_in: BASELINE_SIGNED_URL_SECONDS,
      };
    }

    // 3) 10개 데이터셋 추출 (청크 + silent truncation 감시)
    const datasets: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};
    for (const ds of BASELINE_DATASETS) {
      const limit = CHUNK[ds];
      let offset = 0;
      let total = 0;
      const rows: unknown[] = [];
      for (;;) {
        const page = await rpc(context.supabase, "abd_ocs_baseline_dump", {
          p_dataset: ds,
          p_offset: offset,
          p_limit: limit,
        });
        total = Number(page["row_count"] ?? 0);
        const pageRows = Array.isArray(page["rows"]) ? (page["rows"] as unknown[]) : [];
        rows.push(...pageRows);
        if (pageRows.length < limit) break;
        offset += limit;
        if (offset > 500_000) throw new Error(`BASELINE_DUMP_RUNAWAY: ${ds}`);
      }
      if (rows.length !== total) {
        throw new Error(
          `BASELINE_TRUNCATION_DETECTED: ${ds} rows=${rows.length} row_count=${total}`,
        );
      }
      datasets[ds] = rows;
      counts[ds] = total;
    }

    // 4) core hash after — 추출 중 정본 변경 감지
    const after = await rpc(context.supabase, "abd_ocs_baseline_core_hash");
    const coreHashAfter = String(after["core_hash"] ?? "");
    if (coreHashAfter !== coreHashBefore) {
      throw new Error("BASELINE_RACE_DETECTED: 추출 도중 OCS 정본이 변경되었습니다.");
    }

    // 5) ZIP 조립
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const files: BaselineFileInfo[] = [];
    for (const ds of BASELINE_DATASETS) {
      const name = `${ds}.json`;
      const text = JSON.stringify(
        { dataset: ds, row_count: counts[ds], rows: datasets[ds] },
        null,
        0,
      );
      files.push({
        name,
        byte_size: new TextEncoder().encode(text).byteLength,
        sha256: await sha256Hex(text),
        row_count: counts[ds] ?? 0,
      });
      zip.file(name, text);
    }

    // 5-1) 브라우저 검증 sidecar — 운영 files 배열·total_rows 에는 절대 넣지 않는다.
    //      core hash 의미는 바뀌지 않는다 (읽기 전용 인덱스).
    const indexRows = await buildAbdItemsIndex(context.supabase);
    const indexText = JSON.stringify(
      {
        schema_version: ABD_ITEMS_INDEX_SCHEMA,
        generated_at: new Date().toISOString(),
        row_count: indexRows.length,
        rows: indexRows,
      },
      null,
      0,
    );
    const validationFiles: BaselineValidationFileInfo[] = [
      {
        relative_path: BASELINE_ABD_INDEX_PATH,
        byte_size: new TextEncoder().encode(indexText).byteLength,
        sha256: await sha256Hex(indexText),
        row_count: indexRows.length,
      },
    ];
    zip.file(BASELINE_ABD_INDEX_PATH, indexText);

    const generatedAt = new Date();
    const manifest = {
      schema_version: schemaVersion,
      baseline_id: baselineId,
      base_baseline_id: baselineId,
      base_import_run_id: latestRunId,
      base_core_hash: coreHashBefore,
      base_core_table_hashes: before["core_table_hashes"] ?? {},
      base_generated_at: generatedAt.toISOString(),
      core_tables: before["core_tables"] ?? [],
      core_hash_before: coreHashBefore,
      core_hash_after: coreHashAfter,
      latest_success_import_run_id: latestRunId,
      latest_success_at: baselineInfo["latest_success_at"] ?? null,
      core_last_changed_at: before["core_last_changed_at"] ?? null,
      generated_at: generatedAt.toISOString(),
      data_date: dohaDate(generatedAt),
      excluded: [
        "abd_ocs_compliance_log",
        "abd_ocs_import_logs",
        "storage binaries (images, xlsx)",
      ],
      total_rows: files.reduce((s, f) => s + f.row_count, 0),
      files: files.map((f) => ({
        relative_path: f.name,
        byte_size: f.byte_size,
        sha256: f.sha256,
        row_count: f.row_count,
      })),
      // 기존 로컬 프로그램은 알 수 없는 필드를 무시한다 — files/total_rows 계약 불변.
      validation_files: validationFiles,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const zipBytes = (await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    })) as Uint8Array;

    const fileName = baselineFileName(dohaStampCompact(generatedAt), baselineId);
    const path = `${baselineFolder(baselineId)}/${fileName}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BASELINE_BUCKET)
      .upload(path, new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" }), {
        upsert: false,
        contentType: "application/zip",
      });
    if (upErr && !/exists/i.test(upErr.message)) throw new Error(upErr.message);

    // manifest sidecar — 재사용 응답에서 원래 metadata 를 그대로 되돌려주기 위해 저장
    const { error: sideErr } = await supabaseAdmin.storage
      .from(BASELINE_BUCKET)
      .upload(
        sidecarPath(baselineId),
        new Blob([JSON.stringify({ ...manifest, zip_object_name: fileName }, null, 2)], {
          type: "application/json",
        }),
        { upsert: true, contentType: "application/json" },
      );
    if (sideErr) throw new Error(`manifest sidecar 저장 실패: ${sideErr.message}`);

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BASELINE_BUCKET)
      .createSignedUrl(path, BASELINE_SIGNED_URL_SECONDS);
    if (signErr) throw new Error(signErr.message);

    return {
      baseline_id: baselineId,
      core_hash: coreHashBefore,
      core_table_hashes: (before["core_table_hashes"] ?? {}) as Record<string, string>,
      schema_version: schemaVersion,
      latest_success_import_run_id: latestRunId,
      latest_success_at: (baselineInfo["latest_success_at"] ?? null) as string | null,
      core_last_changed_at: (before["core_last_changed_at"] ?? null) as string | null,
      generated_at: generatedAt.toISOString(),
      data_date: dohaDate(generatedAt),
      storage_path: path,
      zip_byte_size: zipBytes.byteLength,
      total_rows: manifest.total_rows,
      files,
      validation_files: validationFiles,
      validation_row_count: indexRows.length,
      reused: false,
      signed_url: signed?.signedUrl ?? "",
      signed_url_expires_in: BASELINE_SIGNED_URL_SECONDS,
    };
  });

/** 만료된 서명 URL 재발급 (strict admin 재검증 후에만) */
export type LatestBaselineInfo = {
  exists: boolean;
  baseline_id: string;
  core_hash: string;
  schema_version: string;
  latest_success_import_run_id: string | null;
  generated_at: string | null;
  data_date: string | null;
  storage_path: string | null;
  zip_byte_size: number | null;
  total_rows: number | null;
  files: BaselineFileInfo[];
  is_latest: boolean;
};

/**
 * 최신 Baseline 조회 (읽기 전용). 생성·업로드·서명 URL 발급을 하지 않는다.
 * 판정식은 기존과 동일하게 abd_ocs_baseline_core_hash + abd_ocs_inc_baseline + computeBaselineId 만 사용한다.
 */
export const getLatestOcsBaselineInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LatestBaselineInfo> => {
    await assertAdmin(context.supabase, context.userId);

    const core = await rpc(context.supabase, "abd_ocs_baseline_core_hash");
    const baselineInfo = await rpc(context.supabase, "abd_ocs_inc_baseline", {
      p_base_import_run_id: null,
    });
    const coreHash = String(core["core_hash"] ?? "");
    const latestRunId = (baselineInfo["latest_success_import_run_id"] ?? null) as string | null;
    const baselineId = await computeBaselineId(
      BASELINE_SCHEMA_VERSION,
      coreHash,
      latestRunId ?? "",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const existing = await findExisting(supabaseAdmin, baselineId);
    if (!existing) {
      return {
        exists: false,
        baseline_id: baselineId,
        core_hash: coreHash,
        schema_version: BASELINE_SCHEMA_VERSION,
        latest_success_import_run_id: latestRunId,
        generated_at: null,
        data_date: null,
        storage_path: null,
        zip_byte_size: null,
        total_rows: null,
        files: [],
        is_latest: false,
      };
    }

    const stored = await readSidecar(supabaseAdmin, baselineId);
    const files: BaselineFileInfo[] = (stored?.files ?? []).map((f) => ({
      name: f.relative_path,
      byte_size: f.byte_size,
      sha256: f.sha256,
      row_count: f.row_count,
    }));
    return {
      exists: true,
      baseline_id: baselineId,
      core_hash: coreHash,
      schema_version: BASELINE_SCHEMA_VERSION,
      latest_success_import_run_id: latestRunId,
      generated_at: stored?.generated_at ?? null,
      data_date: stored?.data_date ?? null,
      storage_path: `${baselineFolder(baselineId)}/${existing.name}`,
      zip_byte_size: existing.metadata?.size ?? null,
      total_rows: stored?.total_rows ?? files.reduce((s, f) => s + (f.row_count ?? 0), 0),
      files,
      // 현재 core 로 산출한 baseline_id 폴더에 ZIP 이 존재하므로 정본과 일치한다.
      is_latest: true,
    };
  });

export const signOcsBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storage_path: string }) => {
    const p = String(input?.storage_path ?? "");
    if (!p.startsWith("ocs-baselines/")) throw new Error("허용되지 않은 경로입니다.");
    return { storage_path: p };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BASELINE_BUCKET)
      .createSignedUrl(data.storage_path, BASELINE_SIGNED_URL_SECONDS);
    if (error) throw new Error(error.message);
    return {
      signed_url: signed?.signedUrl ?? "",
      signed_url_expires_in: BASELINE_SIGNED_URL_SECONDS,
    };
  });
