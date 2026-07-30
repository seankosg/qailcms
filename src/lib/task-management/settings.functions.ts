import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SettingsSchema = z.object({
  caution_gap_buffer: z.number().min(0).max(1),
  worsen_gap: z.number().min(-1).max(0),
});

export const saveTaskThresholds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => SettingsSchema.parse(v))
  .handler(async ({ data, context }) => {
    // admin only
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("관리자 권한이 필요합니다");
    // 임계값 단일 소스 = tm_alarm_settings (tm_thresholds() 가 읽는 유일한 테이블).
    const { error } = await context.supabase.from("tm_alarm_settings").upsert(
      [
        {
          key: "caution_gap_buffer",
          value_num: data.caution_gap_buffer,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        {
          key: "worsen_gap",
          value_num: data.worsen_gap,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
    // 레거시 테이블은 참조 중단(정본 아님). 호환을 위해 값만 미러링.
    await context.supabase.from("task_management_settings").upsert({
      id: "default",
      caution_gap_buffer: data.caution_gap_buffer,
      worsen_gap: data.worsen_gap,
      updated_by: context.userId,
    });
    return { ok: true };
  });