// ABD OCS Latest Baseline — 생성·재사용·서명 URL 발급 (strict admin 전용, 읽기 전용 추출).
// 정본 테이블은 변경하지 않는다. 산식은 ocs-baseline-shared.ts 하나에만 있다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BASELINE_BUCKET,
  BASELINE_DATASETS,
  BASELINE_SCHEMA_VERSION,
  BASELINE_SIGNED_URL_SECONDS,
  baselineFileName,
  baselineFolder,
  computeBaselineId,
  sha256Hex,
  type BaselineDataset,
} from "@/lib/abd/ocs-baseline-shared";

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자(admin) 권한이 필요합니다.");
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
  reused: boolean;
  signed_url: string;
  signed_url_expires_in: number;
};

/** 기존 baseline_id 폴더에 zip 이 있으면 재사용 (첫 객체) */
async function findExisting(admin: unknown, baselineId: string) {
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
  return (data ?? []).find((f) => f.name.endsWith(".zip")) ?? null;
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

export const createOcsBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaselineResult> => {
    await assertAdmin(context.supabase, context.userId);

    // 1) core hash before + 최신 성공 Import run
    const before = await rpc(context.supabase, "abd_ocs_baseline_core_hash");
    const baselineInfo = await rpc(context.supabase, "abd_ocs_inc_baseline", {
      p_base_import_run_id: null,
    });
    const coreHashBefore = String(before["core_hash"] ?? "");
    const latestRunId = (baselineInfo["latest_success_import_run_id"] ?? null) as string | null;
    const baselineId = await computeBaselineId(
      BASELINE_SCHEMA_VERSION,
      coreHashBefore,
      latestRunId ?? "",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2) 동일 baseline_id 재사용
    const existing = await findExisting(supabaseAdmin, baselineId);
    if (existing) {
      const path = `${baselineFolder(baselineId)}/${existing.name}`;
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BASELINE_BUCKET)
        .createSignedUrl(path, BASELINE_SIGNED_URL_SECONDS);
      if (signErr) throw new Error(signErr.message);
      const stored = await readSidecar(supabaseAdmin, baselineId);
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
      return {
        baseline_id: baselineId,
        core_hash: coreHashBefore,
        core_table_hashes: (stored.base_core_table_hashes ??
          before["core_table_hashes"] ??
          {}) as Record<string, string>,
        schema_version: BASELINE_SCHEMA_VERSION,
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

    const generatedAt = new Date();
    const manifest = {
      schema_version: BASELINE_SCHEMA_VERSION,
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
        new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
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
      schema_version: BASELINE_SCHEMA_VERSION,
      latest_success_import_run_id: latestRunId,
      latest_success_at: (baselineInfo["latest_success_at"] ?? null) as string | null,
      core_last_changed_at: (before["core_last_changed_at"] ?? null) as string | null,
      generated_at: generatedAt.toISOString(),
      data_date: dohaDate(generatedAt),
      storage_path: path,
      zip_byte_size: zipBytes.byteLength,
      total_rows: manifest.total_rows,
      files,
      reused: false,
      signed_url: signed?.signedUrl ?? "",
      signed_url_expires_in: BASELINE_SIGNED_URL_SECONDS,
    };
  });

/** 만료된 서명 URL 재발급 (strict admin 재검증 후에만) */
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
