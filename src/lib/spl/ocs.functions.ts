import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL OCS · RSP 정본 경유 진입점.
 * 읽기: spl_ocs_comments_for_spl / spl_rsp_for_spl
 * 쓰기: spl_ocs_* / spl_rsp_* (모두 서버에서 권한 재검증)
 * 캐시(ocs_total 등)는 관계 정본에서만 파생되며 직접 편집 경로가 없다.
 */
export const SPL_OCS_ATTACHMENT_BUCKET = "spl-ocs-attachments";
export const SPL_OCS_SOURCE_BUCKET = "spl-ocs-source-files";

const Uuid = z.string().uuid();

export type SplOcsAttachment = {
  id: string;
  storage_path: string;
  format: string | null;
  byte_size: number | null;
};

export type SplOcsCategoryRef = {
  id: string;
  code: string;
  label: string;
  color: string | null;
  source: string | null;
};

export type SplOcsRspRef = {
  id: string;
  rsp_number: string;
  description: string | null;
  mapping_method: string | null;
};

export type SplOcsComment = {
  id: string;
  source_comment_id: string;
  ocs_number: string | null;
  revision: string | null;
  sn: string | null;
  doc_revision: string | null;
  atomic_item_no: number;
  atomic_item_count: number | null;
  comment_text: string | null;
  contractor_response: string | null;
  assessed_code: string | null;
  sign_off_status: string | null;
  is_resolved: boolean;
  resolved_reason: string | null;
  response_mapping_status: string | null;
  is_user_created: boolean;
  source_sheet: string | null;
  source_row: number | null;
  complied: boolean;
  complied_source: string | null;
  complied_by_name: string | null;
  complied_at: string | null;
  source_file: { id: string; file_name: string } | null;
  attachments: SplOcsAttachment[];
  categories: SplOcsCategoryRef[];
  rsp_links: SplOcsRspRef[];
};

export type SplOcsComments = {
  can_write: boolean;
  comments: SplOcsComment[];
  total: number;
  resolved: number;
  complied: number;
  pending: number;
  categories_all: Array<{ id: string; code: string; label: string; color: string | null; is_active: boolean }>;
};

export const listSplOcsComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ splItemId: Uuid }).parse(v))
  .handler(async ({ data, context }): Promise<SplOcsComments> => {
    const { data: res, error } = await (context.supabase as any).rpc("spl_ocs_comments_for_spl", {
      _spl_item_id: data.splItemId,
    });
    if (error) throw new Error(`SPL OCS 조회 실패: ${error.message}`);
    if (!res || Array.isArray(res) || typeof res !== "object") throw new Error("SPL OCS 응답 형식 오류");
    return res as SplOcsComments;
  });

export type SplRspItem = {
  id: string;
  rsp_number: string;
  sort_order: number | null;
  description: string | null;
  manufacturer: string | null;
  model_or_unique_id: string | null;
  unit: string | null;
  qty_required: number | null;
  qty_available: number | null;
  qty_short: number | null;
  source_sheet: string | null;
  source_row: number | null;
  is_user_created: boolean;
  ocs_links: Array<{
    comment_id: string;
    ocs_number: string | null;
    revision: string | null;
    sn: string | null;
    mapping_method: string | null;
  }>;
};

export const listSplRspItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ splItemId: Uuid }).parse(v))
  .handler(async ({ data, context }): Promise<{ can_write: boolean; rows: SplRspItem[]; total: number }> => {
    const { data: res, error } = await (context.supabase as any).rpc("spl_rsp_for_spl", {
      _spl_item_id: data.splItemId,
    });
    if (error) throw new Error(`SPL RSP 조회 실패: ${error.message}`);
    if (!res || Array.isArray(res) || typeof res !== "object") throw new Error("SPL RSP 응답 형식 오류");
    return res as { can_write: boolean; rows: SplRspItem[]; total: number };
  });

/** 첨부 이미지 signed URL (5분) — private bucket 유지 */
export const getSplOcsAttachmentUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ paths: z.array(z.string().min(1)).max(50) }).parse(v))
  .handler(async ({ data, context }): Promise<Record<string, string>> => {
    if (data.paths.length === 0) return {};
    const { data: signed, error } = await (context.supabase as any).storage
      .from(SPL_OCS_ATTACHMENT_BUCKET)
      .createSignedUrls(data.paths, 300);
    if (error) throw new Error(error.message);
    const out: Record<string, string> = {};
    for (const s of signed ?? []) if (s?.path && s?.signedUrl) out[s.path] = s.signedUrl;
    return out;
  });

/** 코멘트의 원본 Excel signed URL */
export const getSplOcsSourceFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ commentId: Uuid }).parse(v))
  .handler(async ({ data, context }): Promise<{ available: boolean; url?: string; file_name?: string }> => {
    const supa = context.supabase as any;
    // 원본 엑셀은 코멘트가 속한 그룹의 source_file_name 으로 찾는다.
    // (spl_ocs_source_files.ocs_number 는 미채움 컬럼이라 매칭 근거가 아니다)
    const { data: c, error: cErr } = await supa
      .from("spl_ocs_comments")
      .select("group_id")
      .eq("id", data.commentId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!c?.group_id) return { available: false };
    const { data: g, error: gErr } = await supa
      .from("spl_ocs_comment_groups")
      .select("source_file_name")
      .eq("id", c.group_id)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!g?.source_file_name) return { available: false };
    const { data: f, error: fErr } = await supa
      .from("spl_ocs_source_files")
      .select("storage_path, file_name")
      .eq("file_name", g.source_file_name)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (fErr) throw new Error(fErr.message);
    const row = (f ?? [])[0];
    if (!row?.storage_path) return { available: false };
    const signed = await supa.storage
      .from(SPL_OCS_SOURCE_BUCKET)
      .createSignedUrl(row.storage_path, 300, { download: row.file_name });
    if (signed.error || !signed.data?.signedUrl) return { available: false };
    return { available: true, url: signed.data.signedUrl, file_name: row.file_name };
  });

// ───────────────────────── 편집 (권한은 RPC 내부에서 재검증) ─────────────────────────

export type SplOcsMutationResult = { ok: boolean; id?: string | null; message?: string | null };

async function callRpc(
  supa: any,
  fn: string,
  args: Record<string, unknown>,
): Promise<SplOcsMutationResult> {
  const { data, error } = await supa.rpc(fn, args);
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as Record<string, unknown>;
  return {
    ok: res['ok'] !== false,
    id: (res['id'] as string | null | undefined) ?? null,
    message: (res['message'] as string | null | undefined) ?? null,
  };
}

export const setSplOcsComplied = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ commentId: Uuid, expected: z.boolean(), complied: z.boolean() }).parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_set_complied", {
      _comment_id: data.commentId,
      _expected: data.expected,
      _complied: data.complied,
    }),
  );

export const setSplOcsCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ commentId: Uuid, categoryId: Uuid, on: z.boolean() }).parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_set_category", {
      _comment_id: data.commentId,
      _category_id: data.categoryId,
      _on: data.on,
    }),
  );

export const upsertSplOcsCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        id: Uuid.nullable().default(null),
        code: z.string().default(""),
        label: z.string().min(1),
        isActive: z.boolean().default(true),
      })
      .parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_upsert_category", {
      _id: data.id,
      _code: data.code,
      _label: data.label,
      _is_active: data.isActive,
    }),
  );

export const upsertSplOcsComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        id: Uuid.nullable().default(null),
        splItemId: Uuid,
        ocsNumber: z.string().default(""),
        revision: z.string().default(""),
        commentText: z.string().min(1),
        contractorResponse: z.string().nullable().default(null),
        assessedCode: z.string().default(""),
        signOffStatus: z.string().default(""),
      })
      .parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_upsert_comment", {
      _id: data.id,
      _spl_item_id: data.splItemId,
      _ocs_number: data.ocsNumber,
      _revision: data.revision,
      _comment_text: data.commentText,
      _contractor_response: data.contractorResponse,
      _assessed_code: data.assessedCode,
      _sign_off_status: data.signOffStatus,
    }),
  );

export const deactivateSplOcsComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: Uuid, reason: z.string().default("") }).parse(v))
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_deactivate_comment", { _id: data.id, _reason: data.reason }),
  );

export const setSplOcsRspLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z.object({ commentId: Uuid, rspItemId: Uuid, on: z.boolean() }).parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_ocs_set_rsp_link", {
      _comment_id: data.commentId,
      _rsp_item_id: data.rspItemId,
      _on: data.on,
    }),
  );

export const upsertSplRspItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        id: Uuid.nullable().default(null),
        splItemId: Uuid,
        description: z.string().nullable().default(null),
        manufacturer: z.string().nullable().default(null),
        model: z.string().nullable().default(null),
        unit: z.string().nullable().default(null),
        qtyRequired: z.number().nullable().default(null),
        qtyAvailable: z.number().nullable().default(null),
        qtyShort: z.number().nullable().default(null),
      })
      .parse(v),
  )
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_rsp_upsert", {
      _id: data.id,
      _spl_item_id: data.splItemId,
      _description: data.description,
      _manufacturer: data.manufacturer,
      _model: data.model,
      _unit: data.unit,
      _qty_required: data.qtyRequired,
      _qty_available: data.qtyAvailable,
      _qty_short: data.qtyShort,
    }),
  );

export const deactivateSplRspItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: Uuid, reason: z.string().default("") }).parse(v))
  .handler(({ data, context }) =>
    callRpc(context.supabase, "spl_rsp_deactivate", { _id: data.id, _reason: data.reason }),
  );
