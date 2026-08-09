// ABD OCS 증분 Import — 서버 영수증 읽기 전용 조회.
// 저장 정본은 기존 abd_ocs_inc_verify_receipts 하나뿐이며, 여기서는 조회만 한다.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type VerifyReceiptRow = {
  run_id: string;
  bucket: string;
  path: string;
  expected_sha256: string;
  ok: boolean;
  error: string | null;
  verified_at: string;
};

/**
 * 현재 패키지의 서버 실측 검증 영수증을 조회한다 (읽기 전용).
 * 새로고침 후 Step 5 상태 복원의 서버 정본이다.
 */
export const ocsIncListVerifyReceipts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { package_id: string }) => {
    const package_id = String(input?.package_id ?? "").trim();
    if (!package_id) throw new Error("package_id 가 필요합니다.");
    return { package_id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("abd_ocs_inc_verify_receipts")
      .select("run_id, bucket, path, expected_sha256, ok, error, verified_at")
      .eq("package_id", data.package_id)
      .order("verified_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as unknown as VerifyReceiptRow[];
    // 동일 path 는 최신 영수증만 남긴다.
    const latest = new Map<string, VerifyReceiptRow>();
    for (const r of list) if (!latest.has(r.path)) latest.set(r.path, r);
    const dedup = [...latest.values()];
    return {
      package_id: data.package_id,
      total: dedup.length,
      ok_paths: dedup.filter((r) => r.ok).map((r) => r.path),
      failed: dedup
        .filter((r) => !r.ok)
        .map((r) => ({ path: r.path, error: r.error ?? "verify failed" })),
    };
  });