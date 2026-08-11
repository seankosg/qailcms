import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL Raw Data 편집.
 *
 * 판정 정본 = `rcl_can(uid, 'SPL', id, 'write')` (RLS 정책과 동일 함수).
 * 파생값(판정·진도율·집계)은 서버 정본 산출이라 편집 대상이 아니다.
 */
const EDITABLE = new Set([
  "team",
  "pic",
  "eng",
  "pic_po",
  "eng_po",
  "plot",
  "dis",
  "service",
  "title",
  "supplier",
  "latest_status",
  "data_date",
]);

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

/** 스테이지 필드 코드 → spl_stage_progress 컬럼 */
const STAGE_COLUMN: Record<string, string> = {
  ps: "plan_start",
  as: "actual_start",
  pf: "plan_finish",
  af: "actual_finish",
  fv: "flag_value",
};

const StageSchema = z.object({
  item_id: z.string().uuid(),
  stage_code: z.string().min(1),
  field: z.enum(["ps", "as", "pf", "af", "fv"]),
  value: z.string().nullable(),
});

/**
 * SPL 스테이지 값(계획/실적일·플래그) 편집.
 * 행이 없으면 (item_id, stage_code) 로 생성한다. 변경 이력은 `trg_spl_progress_audit` 가 남긴다.
 */
export const updateSplStageField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => StageSchema.parse(v))
  .handler(async ({ data, context }) => {
    const column = STAGE_COLUMN[data.field];
    if (!column) throw new Error(`Stage field '${data.field}' 은 편집 대상이 아닙니다.`);
    const { data: ok, error: permErr } = await (context.supabase as any).rpc("rcl_can", {
      _user_id: context.userId,
      _module: "SPL",
      _row_id: data.item_id,
      _action: "write",
    });
    if (permErr) throw new Error(permErr.message);
    if (!ok) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");

    const raw = data.value === null || data.value.trim() === "" ? null : data.value.trim();
    if (raw !== null && data.field !== "fv" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
    }

    const { data: existing, error: selErr } = await (context.supabase as any)
      .from("spl_stage_progress")
      .select("id")
      .eq("item_id", data.item_id)
      .eq("stage_code", data.stage_code)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    if (existing?.id) {
      const { error } = await (context.supabase as any)
        .from("spl_stage_progress")
        .update({ [column]: raw, updated_by: context.userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (context.supabase as any).from("spl_stage_progress").insert({
        item_id: data.item_id,
        stage_code: data.stage_code,
        [column]: raw,
        created_by: context.userId,
        updated_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });