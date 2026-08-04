import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WRT Raw Data 최소 편집 (team · pic · eng).
 *
 * 판정은 서버 정본 하나뿐이다:
 *  - 행 단위 허용 여부 = `rcl_can(uid, 'WRT', id, 'write')` (RLS 정책이 동일 함수를 사용)
 *  - 화면 판정(`useRclCan`)은 표시용 사본이며 최종 관문이 아니다.
 * 계획일·실적일 등 단계 값은 여기서 편집하지 않는다(임포트 정본 경유).
 */
const EDITABLE = new Set(["team", "pic", "eng"]);

const Schema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.string().nullable(),
});

export const updateWrtField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Schema.parse(v))
  .handler(async ({ data, context }) => {
    if (!EDITABLE.has(data.field)) throw new Error(`Field '${data.field}' 은 편집 대상이 아닙니다.`);
    const { data: ok, error: permErr } = await (context.supabase as any).rpc("rcl_can", {
      _user_id: context.userId,
      _module: "WRT",
      _row_id: data.id,
      _action: "write",
    });
    if (permErr) throw new Error(permErr.message);
    if (!ok) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");

    const value = data.value === null || data.value.trim() === "" ? null : data.value.trim();
    const { error } = await (context.supabase as any)
      .from("wrt_items")
      .update({ [data.field]: value, updated_at: new Date().toISOString(), updated_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });