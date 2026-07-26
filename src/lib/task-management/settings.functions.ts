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
    const { error } = await context.supabase
      .from("task_management_settings")
      .upsert({
        id: "default",
        caution_gap_buffer: data.caution_gap_buffer,
        worsen_gap: data.worsen_gap,
        updated_by: context.userId,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });