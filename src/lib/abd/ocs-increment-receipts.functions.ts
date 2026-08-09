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
  package_id: string;
  bucket: string;
  path: string;
  expected_sha256: string;
  expected_byte_size: number | null;
  ok: boolean;
  error: string | null;
  verified_at: string;
};

import {
  dedupeLatestReceipts,
  isTruncated,
  RECEIPT_MAX_ROWS as MAX_ROWS,
  RECEIPT_PAGE as PAGE,
} from "@/lib/abd/ocs-increment-receipts";

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
    // 조용한 잘림 금지 — 페이지네이션으로 전량 조회하고, 상한 초과 시 truncated 로 표면화한다.
    const list: VerifyReceiptRow[] = [];
    let truncated = false;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data: rows, error } = await context.supabase
        .from("abd_ocs_inc_verify_receipts")
        .select(
          "run_id, package_id, bucket, path, expected_sha256, expected_byte_size, ok, error, verified_at",
        )
        .eq("package_id", data.package_id)
        .order("verified_at", { ascending: false })
        .order("path", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (rows ?? []) as unknown as VerifyReceiptRow[];
      list.push(...page);
      if (page.length < PAGE) break;
      if (from + PAGE >= MAX_ROWS) truncated = true;
    }

    // 최신 영수증 중복 제거 키는 bucket::path (동일 path 가 다른 bucket 에 있을 수 있다).
    const dedup = dedupeLatestReceipts(list);
    truncated = truncated || isTruncated(list.length);
    return {
      package_id: data.package_id,
      truncated,
      total: dedup.length,
      receipts: dedup.map((r) => ({
        package_id: r.package_id,
        bucket: r.bucket,
        path: r.path,
        expected_sha256: r.expected_sha256,
        expected_byte_size: r.expected_byte_size,
        ok: r.ok,
      })),
      ok_count: dedup.filter((r) => r.ok).length,
      failed: dedup
        .filter((r) => !r.ok)
        .map((r) => ({ bucket: r.bucket, path: r.path, error: r.error ?? "verify failed" })),
    };
  });
