import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** OCS 첨부 이미지 보관함(비공개) */
export const OCS_ATTACHMENT_BUCKET = "abd-ocs-attachments";

export type AbdOcsAttachment = {
  id: string;
  source_attachment_id: string;
  storage_path: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  mapping_status?: string | null;
  mapping_method?: string | null;
};

export type AbdOcsComment = {
  id: string;
  source_comment_id: string;
  ocs_number: string | null;
  ocs_sn: string | null;
  file_revision: string | null;
  comment_revision: string | null;
  comment_part: string | null;
  ocs_comment: string | null;
  assessed_code: string | null;
  contractor_response: string | null;
  sign_off_status: string | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_row_index: number | null;
  atomic_item_no?: number | null;
  atomic_item_count?: number | null;
  split_status?: string | null;
  response_mapping_status?: string | null;
  source_parent_comment_id?: string | null;
  complied: boolean;
  compliance_source: string | null;
  complied_by_name: string | null;
  complied_at: string | null;
  attachments: AbdOcsAttachment[];
};

export type AbdOcsPanelData = {
  abd_item_id: string;
  total: number;
  complied: number;
  pending: number;
  can_write: boolean;
  comments: AbdOcsComment[];
};

export type AbdOcsSetCompliedResult = {
  comment_id: string;
  abd_item_id: string;
  complied: boolean;
  changed: boolean;
  complied_by_name: string | null;
  complied_at: string | null;
  total: number;
  complied_count: number;
  pending: number;
};

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: unknown, label: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`${label}: 잘못된 ID 형식입니다.`);
  return v;
}

function assertBool(v: unknown, label: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${label}: boolean 이어야 합니다.`);
  return v;
}

export const getAbdOcsComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemId: string }) => ({ itemId: assertUuid(input?.itemId, "itemId") }))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as LooseClient).rpc(
      "abd_ocs_comments_for_item",
      { p_abd_item_id: data.itemId },
    );
    if (error) throw new Error(error.message);
    return (res ?? null) as AbdOcsPanelData | null;
  });

export const setAbdOcsComplied = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { commentId: string; expected: boolean; complied: boolean }) => ({
    commentId: assertUuid(input?.commentId, "commentId"),
    expected: assertBool(input?.expected, "expected"),
    complied: assertBool(input?.complied, "complied"),
  }))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await (context.supabase as unknown as LooseClient).rpc(
      "abd_ocs_set_complied",
      {
        p_comment_id: data.commentId,
        p_expected: data.expected,
        p_complied: data.complied,
      },
    );
    if (error) throw new Error(error.message);
    return (res ?? null) as AbdOcsSetCompliedResult | null;
  });