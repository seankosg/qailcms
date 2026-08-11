import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** SPL 제출 문서(PDF) 비공개 보관함 */
export const SPL_DOCUMENT_BUCKET = "spl-documents";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SplDocumentRow {
  id: string;
  document_identity: string;
  document_number: string;
  revision: string | null;
  title: string | null;
  file_name: string;
  byte_size: number | null;
  page_count: number | null;
  content_hash: string | null;
  number_mismatch: boolean;
  mismatch_warning: string | null;
  review_note: string | null;
  filename_document_number: string | null;
  internal_document_number: string | null;
  mapping_method: string | null;
  link_note: string | null;
}

type LooseClient = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
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

/** SPL 항목에 연결된 제출 문서 목록 */
export const listSplDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { splItemId: string }) => {
    const id = input?.splItemId;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error("splItemId: invalid id");
    return { splItemId: id };
  })
  .handler(async ({ data, context }): Promise<SplDocumentRow[]> => {
    const client = context.supabase as unknown as LooseClient;
    const { data: rows, error } = await client
      .from("spl_document_item_links")
      .select(
        "mapping_method, note, spl_documents!inner(id, document_identity, document_number, revision, title, file_name, byte_size, page_count, content_hash, number_mismatch, mismatch_warning, review_note, filename_document_number, internal_document_number, is_active)",
      )
      .eq("spl_item_id", data.splItemId);
    if (error) throw new Error(error.message);

    return ((rows ?? []) as any[])
      .map((r) => ({ link: r, doc: r.spl_documents }))
      .filter((x) => x.doc && x.doc.is_active !== false)
      .map(({ link, doc }) => ({
        id: doc.id,
        document_identity: doc.document_identity,
        document_number: doc.document_number,
        revision: doc.revision ?? null,
        title: doc.title ?? null,
        file_name: doc.file_name,
        byte_size: doc.byte_size ?? null,
        page_count: doc.page_count ?? null,
        content_hash: doc.content_hash ?? null,
        number_mismatch: !!doc.number_mismatch,
        mismatch_warning: doc.mismatch_warning ?? null,
        review_note: doc.review_note ?? null,
        filename_document_number: doc.filename_document_number ?? null,
        internal_document_number: doc.internal_document_number ?? null,
        mapping_method: link.mapping_method ?? null,
        link_note: link.note ?? null,
      }))
      .sort((a, b) => a.document_identity.localeCompare(b.document_identity));
  });

/** 문서 PDF 열람용 signed URL (5분) */
export const getSplDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { documentId: string; download?: boolean }) => {
    const id = input?.documentId;
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error("documentId: invalid id");
    return { documentId: id, download: input?.download === true };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ available: boolean; url?: string; file_name?: string }> => {
      const client = context.supabase as unknown as LooseClient;
      const { data: doc, error } = await client
        .from("spl_documents")
        .select("storage_path, file_name")
        .eq("id", data.documentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!doc?.storage_path) return { available: false };

      const signed = await client.storage
        .from(SPL_DOCUMENT_BUCKET)
        .createSignedUrl(
          doc.storage_path as string,
          300,
          data.download ? { download: doc.file_name as string } : undefined,
        );
      if (signed.error || !signed.data?.signedUrl) return { available: false };
      return { available: true, url: signed.data.signedUrl, file_name: doc.file_name as string };
    },
  );

export interface SplDocumentPageHit {
  document_id: string;
  document_number: string;
  revision: string | null;
  title: string | null;
  page_number: number;
  hit_count: number;
  snippet: string;
}

/** SPL 제출 문서 PDF 본문(페이지 단위) 검색 */
export const searchSplDocumentPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string; splItemId?: string | null; documentId?: string | null }) => {
    const q = typeof input?.q === "string" ? input.q.trim() : "";
    const splItemId = input?.splItemId ?? null;
    const documentId = input?.documentId ?? null;
    if (splItemId != null && !UUID_RE.test(splItemId)) throw new Error("splItemId: invalid id");
    if (documentId != null && !UUID_RE.test(documentId)) throw new Error("documentId: invalid id");
    return { q, splItemId, documentId };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: SplDocumentPageHit[]; total_count: number; query: string }> => {
      if (data.q.length < 2) return { rows: [], total_count: 0, query: data.q };
      const client = context.supabase as unknown as LooseClient;
      const { data: res, error } = await client.rpc("spl_document_pages_search", {
        _q: data.q,
        _document_id: data.documentId,
        _spl_item_id: data.splItemId,
        _limit: 50,
      });
      if (error) throw new Error(error.message);
      if (!res || typeof res !== "object" || Array.isArray(res)) {
        throw new Error("spl_document_pages_search: unexpected response shape");
      }
      const rows = (res.rows ?? []) as SplDocumentPageHit[];
      return { rows, total_count: Number(res.total_count ?? 0), query: String(res.query ?? data.q) };
    },
  );
