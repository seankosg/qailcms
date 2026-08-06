import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** OCS 첨부 이미지 보관함(비공개) */
export const OCS_BUCKET = "abd-ocs-attachments";

/**
 * Stage A1 은 **Storage 업로드·검증만** 수행한다.
 * DB 메타데이터 등록(abd_ocs_attachments insert)은 Stage B 에서 코멘트 임포트 뒤에 한다.
 * (고아 row 방지 — 지시문 §4)
 */
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertStrictAdmin(supabase: unknown, userId: string) {
  const client = supabase as RpcClient;
  const { data, error } = await client.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자(admin) 권한이 필요합니다.");
}

/** 업로드 화면 진입/실행 전 서버측 권한 관문 */
export const assertOcsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStrictAdmin(context.supabase, context.userId);
    return { ok: true as const };
  });

/** 표본 검증용 현황 집계 (Stage A1 기준: 코멘트/첨부 DB 는 아직 비어 있을 수 있음) */
export const getOcsImportStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStrictAdmin(context.supabase, context.userId);
    const [comments, links, attachments] = await Promise.all([
      context.supabase.from("abd_ocs_comments").select("id", { count: "exact", head: true }),
      context.supabase
        .from("abd_ocs_comment_abd_links")
        .select("id", { count: "exact", head: true }),
      context.supabase.from("abd_ocs_attachments").select("id", { count: "exact", head: true }),
    ]);

    // V3 정본: abd_ocs_comment_abd_links 의 distinct comment_id.
    // PostgREST 1,000행 상한 때문에 청크 루프로 전량 조회한다.
    const seen = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await context.supabase
        .from("abd_ocs_comment_abd_links")
        .select("comment_id")
        .order("comment_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { comment_id: string }[];
      for (const r of rows) seen.add(r.comment_id);
      if (rows.length < PAGE) break;
      if (from > 1_000_000) throw new Error("링크 조회 런어웨이");
    }
    return {
      comment_count: comments.count ?? 0,
      linked_comment_count: seen.size,
      abd_association_count: links.count ?? 0,
      attachment_count: attachments.count ?? 0,
    };
  });
