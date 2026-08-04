import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL Raw Data 최소 편집 (team · pic · eng · pic_po · eng_po).
 *
 * 판정 정본 = `rcl_can(uid, 'SPL', id, 'write')` (RLS 정책과 동일 함수).
 * 단계 값(계획/실적)은 임포트 정본 경유이므로 여기서 편집하지 않는다.
 */
const EDITABLE = new Set(["team", "pic", "eng", "pic_po", "eng_po"]);

const Schema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.string().nullable(),
});

export const updateSplField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Schema.parse(v))
  .handler(async ({ data, context }) => {
    if (!EDITABLE.has(data.field)) throw new Error(`Field '${data.field}' 은 편집 대상이 아닙니다.`);
    const { data: ok, error: permErr } = await (context.supabase as any).rpc("rcl_can", {
      _user_id: context.userId,
      _module: "SPL",
      _row_id: data.id,
      _action: "write",
    });
    if (permErr) throw new Error(permErr.message);
    if (!ok) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");

    const value = data.value === null || data.value.trim() === "" ? null : data.value.trim();
    const { error } = await (context.supabase as any)
      .from("spl_items")
      .update({ [data.field]: value, updated_at: new Date().toISOString(), updated_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });