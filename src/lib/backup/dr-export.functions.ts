/**
 * 논리 DR 내보내기 — 관리자용 서버 함수(토큰 발급·취소·조회).
 * 모두 System Administrator 단독 권한이다.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DR_TOKEN_TTL_HOURS, DR_WORK_BUCKETS } from "./dr-export-contract";

async function assertSystemAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_system_admin", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("이 기능은 System Administrator 계정만 사용할 수 있습니다.");
}

/** 논리 DR 대상 계약(고정값) — UI 안내용. */
export const getDrExportScope = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    return { buckets: [...DR_WORK_BUCKETS], excluded: ["db-backups"], token_ttl_hours: DR_TOKEN_TTL_HOURS };
  });

/** 선택 Snapshot 사전검증(읽기 전용). 토큰은 발급하지 않는다. */
export const verifyDrSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { snapshot_id: string }) => {
    if (!input?.snapshot_id) throw new Error("Snapshot 을 선택하십시오.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("./dr-export.server");
    try {
      const v = await mod.loadAndVerifySnapshot(supabaseAdmin as any, data.snapshot_id);
      return {
        ok: true as const,
        snapshot_id: v.row.id,
        name: v.row.name,
        created_at: v.row.created_at,
        manifest_sha256: v.manifestSha,
        overall_sha256: v.manifest.sha256 as string,
        part_count: v.parts.length,
        total_rows: Number(v.manifest.total_rows ?? 0),
        table_count: Array.isArray(v.manifest.tables) ? v.manifest.tables.length : 0,
      };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { ok: false as const, code: e.code ?? "VERIFY_FAILED", message: e.message ?? "검증에 실패했습니다." };
    }
  });

/** 일회용 DR 토큰 발급. 토큰 원문은 이 응답에서만 확인할 수 있다. */
export const issueDrExportToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { snapshot_id: string }) => {
    if (!input?.snapshot_id) throw new Error("Snapshot 을 선택하십시오.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("./dr-export.server");
    return await mod.issueDrExportRun(supabaseAdmin as any, data.snapshot_id, context.userId);
  });

/** 발급한 토큰 즉시 폐기. */
export const revokeDrExportRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { run_id: string }) => {
    if (!input?.run_id) throw new Error("취소할 내보내기를 선택하십시오.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("dr_export_runs")
      .update({ status: "revoked", cancelled_at: new Date().toISOString() })
      .eq("id", data.run_id)
      .in("status", ["issued", "downloading"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** 최근 내보내기 이력(토큰 원문 없음). */
export const listDrExportRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { data, error } = await (context.supabase as any)
      .from("dr_export_runs")
      .select(
        "id, snapshot_id, status, issued_at, expires_at, completed_at, cancelled_at, files_downloaded, bytes_downloaded, error_code, error_message, snapshot_overall_sha256",
      )
      .order("issued_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** 정기 Snapshot cron 실제 상태(이름·주기·활성만). 설정값과 다르면 화면에서 경고한다. */
export const getDrSnapshotCronStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("dr_snapshot_cron_status");
    if (error) {
      return {
        ok: false as const,
        message: String(error.message ?? ""),
        job: null,
        expected_schedule: "50 20 * * *",
        mismatch: true,
      };
    }
    const jobs = (data ?? []) as { jobname: string; schedule: string; active: boolean }[];
    const expected = "50 20 * * *";
    const job = jobs[0] ?? null;
    return {
      ok: true as const,
      job,
      expected_schedule: expected,
      mismatch: !job || job.schedule !== expected || !job.active,
    };
  });
