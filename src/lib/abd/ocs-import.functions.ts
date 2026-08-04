import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** OCS 첨부 이미지 보관함(비공개) */
export const OCS_BUCKET = "abd-ocs-attachments";
/** 허용 이미지 형식 — 버킷 설정이 아닌 앱 레벨에서 강제한다. */
export const OCS_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
/** 파일 1건 상한 8MB */
export const OCS_MAX_BYTES = 8 * 1024 * 1024;

async function assertAdminOrSuper(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["admin", "superuser"],
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자 또는 Super User 권한이 필요합니다.");
}

export type OcsManifestEntry = {
  source_comment_id: string;
  source_attachment_id: string;
  file_name: string;
  sha256?: string | null;
  byte_size?: number | null;
  sort_order?: number | null;
};

export type OcsManifestValidation = {
  total: number;
  duplicated_attachment_ids: string[];
  unknown_comment_ids: string[];
  known_comment_count: number;
  already_registered: string[];
  invalid_rows: { index: number; reason: string }[];
};

/** 매니페스트 자체 정합성 + DB 대조 검증(쓰기 없음) */
export const validateOcsManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { entries: OcsManifestEntry[] }) => input)
  .handler(async ({ data, context }): Promise<OcsManifestValidation> => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const entries = data.entries ?? [];

    const invalid_rows: { index: number; reason: string }[] = [];
    entries.forEach((e, i) => {
      if (!e?.source_comment_id) invalid_rows.push({ index: i, reason: "source_comment_id 누락" });
      else if (!e?.source_attachment_id) invalid_rows.push({ index: i, reason: "source_attachment_id 누락" });
      else if (!e?.file_name) invalid_rows.push({ index: i, reason: "file_name 누락" });
      else if (e.byte_size != null && e.byte_size > OCS_MAX_BYTES)
        invalid_rows.push({ index: i, reason: "8MB 초과" });
    });

    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const e of entries) {
      const k = e?.source_attachment_id;
      if (!k) continue;
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    }

    const commentIds = Array.from(new Set(entries.map((e) => e?.source_comment_id).filter(Boolean) as string[]));
    const knownIds = new Set<string>();
    for (let i = 0; i < commentIds.length; i += 500) {
      const chunk = commentIds.slice(i, i + 500);
      const { data: rows, error } = await context.supabase
        .from("abd_ocs_comments")
        .select("source_comment_id")
        .in("source_comment_id", chunk);
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) knownIds.add((r as any).source_comment_id as string);
    }

    const attachIds = Array.from(seen);
    const already = new Set<string>();
    for (let i = 0; i < attachIds.length; i += 500) {
      const chunk = attachIds.slice(i, i + 500);
      const { data: rows, error } = await context.supabase
        .from("abd_ocs_attachments")
        .select("source_attachment_id")
        .in("source_attachment_id", chunk);
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) already.add((r as any).source_attachment_id as string);
    }

    return {
      total: entries.length,
      duplicated_attachment_ids: Array.from(dup),
      unknown_comment_ids: commentIds.filter((id) => !knownIds.has(id)),
      known_comment_count: knownIds.size,
      already_registered: Array.from(already),
      invalid_rows,
    };
  });

/** 업로드가 끝난 이미지들을 DB 에 등록(업서트) */
export const registerOcsAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      items: {
        source_comment_id: string;
        source_attachment_id: string;
        storage_path: string;
        mime_type?: string | null;
        byte_size?: number | null;
        sha256?: string | null;
        sort_order?: number | null;
      }[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const items = data.items ?? [];
    if (items.length === 0) return { registered: 0, skipped_unknown_comment: [] as string[] };

    const commentIds = Array.from(new Set(items.map((i) => i.source_comment_id)));
    const idMap = new Map<string, string>();
    for (let i = 0; i < commentIds.length; i += 500) {
      const chunk = commentIds.slice(i, i + 500);
      const { data: rows, error } = await context.supabase
        .from("abd_ocs_comments")
        .select("id, source_comment_id")
        .in("source_comment_id", chunk);
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) idMap.set((r as any).source_comment_id as string, (r as any).id as string);
    }

    const skipped_unknown_comment: string[] = [];
    const payload = items
      .filter((i) => {
        if (idMap.has(i.source_comment_id)) return true;
        skipped_unknown_comment.push(i.source_comment_id);
        return false;
      })
      .map((i) => ({
        comment_id: idMap.get(i.source_comment_id)!,
        source_attachment_id: i.source_attachment_id,
        storage_path: i.storage_path,
        mime_type: i.mime_type ?? null,
        byte_size: i.byte_size ?? null,
        sha256: i.sha256 ?? null,
        sort_order: i.sort_order ?? 0,
      }));

    let registered = 0;
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await context.supabase
        .from("abd_ocs_attachments")
        .upsert(chunk as any, { onConflict: "source_attachment_id" });
      if (error) throw new Error(error.message);
      registered += chunk.length;
    }

    return { registered, skipped_unknown_comment: Array.from(new Set(skipped_unknown_comment)) };
  });

/** 표본 검증용 현황 집계 */
export const getOcsImportStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminOrSuper(context.supabase, context.userId);
    const [comments, linked, attachments] = await Promise.all([
      context.supabase.from("abd_ocs_comments").select("id", { count: "exact", head: true }),
      context.supabase
        .from("abd_ocs_comments")
        .select("id", { count: "exact", head: true })
        .not("abd_item_id", "is", null),
      context.supabase.from("abd_ocs_attachments").select("id", { count: "exact", head: true }),
    ]);
    return {
      comment_count: comments.count ?? 0,
      linked_count: linked.count ?? 0,
      attachment_count: attachments.count ?? 0,
    };
  });
