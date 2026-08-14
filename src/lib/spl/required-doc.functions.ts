import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL Required Document — 「필요」/「받았음」 두 토글.
 *
 * 저장은 DB 정본 RPC(`spl_reqdoc_set_required` / `spl_reqdoc_set_ready`)만 쓴다.
 * 그 안에서 band 검사 · `rcl_can(uid,'SPL',row,'write')` 권한 검사 ·
 * `spl.change_source='reqdoc_ready_toggle'` 감사 소스가 한 트랜잭션으로 처리된다.
 * flag 단계의 실적 칸은 `actual_start` 하나다(`actual_finish` 미사용).
 */
const Schema = z.object({
  item_id: z.string().uuid(),
  stage_code: z.string().min(1),
  required: z.boolean(),
});

export const setSplRequiredDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Schema.parse(v))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as any;
    // 「필요」를 끄면 RPC 안에서 actual_start 도 함께 지운다.
    const { error } = await supa.rpc("spl_reqdoc_set_required", {
      _item_id: data.item_id,
      _stage_code: data.stage_code,
      _required: data.required,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ReadySchema = z.object({
  item_id: z.string().uuid(),
  stage_code: z.string().min(1),
  ready: z.boolean(),
});

/**
 * 「받았음」 토글 — 날짜는 사람이 입력하지 않는다.
 * ready=true → actual_start = 오늘(Asia/Qatar), ready=false → null.
 */
export const setSplRequiredDocReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => ReadySchema.parse(v))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as any;
    const { error } = await supa.rpc("spl_reqdoc_set_ready", {
      _item_id: data.item_id,
      _stage_code: data.stage_code,
      _ready: data.ready,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
