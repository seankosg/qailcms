import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SettingsSchema = z.object({
  behind_warn_gap: z.number().min(-1).max(0),
  behind_late_gap: z.number().min(-1).max(0),
  slip_warn_days: z.number().int().min(0).max(365),
  slip_late_days: z.number().int().min(0).max(365),
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
        behind_warn_gap: data.behind_warn_gap,
        behind_late_gap: data.behind_late_gap,
        slip_warn_days: data.slip_warn_days,
        slip_late_days: data.slip_late_days,
        updated_by: context.userId,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });