import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** OCS 원본 Excel 보관함(비공개) */
export const OCS_SOURCE_FILE_BUCKET = "abd-ocs-source-files";

export type AbdOcsSourceFileLink =
  | { available: true; file_name: string; url: string; byte_size: number | null }
  | { available: false };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from: (b: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        opts?: { download?: string | boolean },
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getAbdOcsSourceFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { commentId: string }) => {
    const id = input?.commentId;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error("commentId: invalid id");
    return { commentId: id };
  })
  .handler(async ({ data, context }): Promise<AbdOcsSourceFileLink> => {
    const client = context.supabase as unknown as LooseClient;
    const { data: meta, error } = await client.rpc("abd_ocs_source_file_for_comment", {
      _comment_id: data.commentId,
    });
    if (error) throw new Error("OCS_SOURCE_FILE_DENIED");

    const row = (meta ?? {}) as {
      available?: boolean;
      file_name?: string;
      storage_path?: string;
      byte_size?: number | null;
    };
    if (!row.available || !row.storage_path || !row.file_name) return { available: false };

    const signed = await client.storage
      .from(OCS_SOURCE_FILE_BUCKET)
      .createSignedUrl(row.storage_path, 300, { download: row.file_name });
    if (signed.error || !signed.data?.signedUrl) return { available: false };

    return {
      available: true,
      file_name: row.file_name,
      url: signed.data.signedUrl,
      byte_size: row.byte_size ?? null,
    };
  });