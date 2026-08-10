// ABD OCS 증분 Import — 신규 Storage object 서버 실측 검증 배치 서버 함수.
// 단일 요청에 최대 VERIFY_BATCH_MAX 개, 내부 동시성 VERIFY_CONCURRENCY 로 제한한다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAbdOcsAccess } from "@/lib/abd/ocs-access";
import {
  VERIFY_BATCH_MAX,
  VERIFY_CONCURRENCY,
  runWithConcurrency,
  sha256Hex,
  verifyItemList,
  type VerifyOutcome,
} from "@/lib/abd/ocs-increment-verify";

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  await assertAbdOcsAccess(supabase, userId);
}

/** 신규 object 배치 검증 — 서버가 직접 다운로드하여 SHA-256/byte_size 를 실측하고 영수증을 저장한다. */
export const ocsIncVerifyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string; package_id: string; items?: unknown }) => {
    const run_id = String(input?.run_id ?? "").trim();
    const package_id = String(input?.package_id ?? "").trim();
    if (!run_id) throw new Error("run_id 가 필요합니다.");
    if (!package_id) throw new Error("package_id 가 필요합니다.");
    const items = verifyItemList(input?.items);
    if (items.length === 0) throw new Error("검증 대상이 비어 있습니다.");
    if (items.length > VERIFY_BATCH_MAX) {
      throw new Error(`한 배치는 최대 ${VERIFY_BATCH_MAX}건입니다 (요청 ${items.length}건).`);
    }
    return { run_id, package_id, items };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const outcomes = await runWithConcurrency<(typeof data.items)[number], VerifyOutcome>(
      data.items,
      VERIFY_CONCURRENCY,
      async (item) => {
        try {
          const { data: blob, error } = await supabaseAdmin.storage
            .from(item.bucket)
            .download(item.path);
          if (error || !blob) {
            return {
              bucket: item.bucket,
              path: item.path,
              ok: false,
              actual_sha256: null,
              actual_byte_size: null,
              error: error?.message ?? "download failed",
            };
          }
          const buf = await blob.arrayBuffer();
          const actual_sha256 = await sha256Hex(buf);
          const actual_byte_size = buf.byteLength;
          const ok =
            actual_sha256 === item.expected_sha256 && actual_byte_size === item.expected_byte_size;
          return {
            bucket: item.bucket,
            path: item.path,
            ok,
            actual_sha256,
            actual_byte_size,
            error: ok
              ? null
              : `mismatch (실측 ${actual_sha256.slice(0, 12)}/${actual_byte_size} ≠ 선언 ${item.expected_sha256.slice(0, 12)}/${item.expected_byte_size})`,
          };
        } catch (e) {
          return {
            bucket: item.bucket,
            path: item.path,
            ok: false,
            actual_sha256: null,
            actual_byte_size: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    );

    const rows = data.items.map((item, i) => ({
      run_id: data.run_id,
      package_id: data.package_id,
      bucket: item.bucket,
      path: item.path,
      expected_sha256: item.expected_sha256,
      expected_byte_size: item.expected_byte_size,
      actual_sha256: outcomes[i]?.actual_sha256 ?? null,
      actual_byte_size: outcomes[i]?.actual_byte_size ?? null,
      ok: outcomes[i]?.ok === true,
      error: outcomes[i]?.error ?? null,
      verified_by: context.userId,
      verified_at: new Date().toISOString(),
    }));
    const { error: upErr } = await supabaseAdmin
      .from("abd_ocs_inc_verify_receipts")
      .upsert(rows, { onConflict: "run_id,bucket,path" });
    if (upErr) throw new Error(`verify receipt 저장 실패: ${upErr.message}`);

    return {
      run_id: data.run_id,
      package_id: data.package_id,
      total: rows.length,
      ok_count: outcomes.filter((o) => o.ok).length,
      failed: outcomes.filter((o) => !o.ok),
    };
  });