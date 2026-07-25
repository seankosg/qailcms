import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface AbdSettings {
  id: string;
  ur_aging_warn_days: number;
  ur_aging_late_days: number;
  rs_plan_gap_days: number;
  ds_gap_after_rs_days: number;
  stuck_ns_days: number;
  updated_at: string;
  updated_by: string | null;
}

export const getAbdSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("abd_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as AbdSettings | null;
  });

const UpdateSchema = z.object({
  id: z.string().uuid().optional(),
  ur_aging_warn_days: z.number().int().min(0).max(365),
  ur_aging_late_days: z.number().int().min(0).max(365),
  rs_plan_gap_days: z.number().int().min(0).max(365).optional(),
  ds_gap_after_rs_days: z.number().int().min(0).max(365).optional(),
  stuck_ns_days: z.number().int().min(0).max(365).optional(),
});

export const updateAbdSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => UpdateSchema.parse(v))
  .handler(async ({ data, context }) => {
    // 권한: admin / superuser / d_superuser 만 편집
    const { data: isAdmin } = await (context.supabase as any)
      .rpc("is_admin_or_super", { _user_id: context.userId });
    let allowed = !!isAdmin;
    if (!allowed) {
      const { data: isDSuper } = await (context.supabase as any)
        .rpc("has_role", { _user_id: context.userId, _role: "d_superuser" });
      allowed = !!isDSuper;
    }
    if (!allowed) throw new Error("Forbidden");
    if (data.ur_aging_warn_days > data.ur_aging_late_days) {
      throw new Error("Warn 값은 Late 값보다 작거나 같아야 합니다.");
    }
    const patch: any = {
      ur_aging_warn_days: data.ur_aging_warn_days,
      ur_aging_late_days: data.ur_aging_late_days,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    if (data.rs_plan_gap_days != null) patch.rs_plan_gap_days = data.rs_plan_gap_days;
    if (data.ds_gap_after_rs_days != null) patch.ds_gap_after_rs_days = data.ds_gap_after_rs_days;
    if (data.stuck_ns_days != null) patch.stuck_ns_days = data.stuck_ns_days;
    if (data.id) {
      const { data: row, error } = await (context.supabase as any)
        .from("abd_settings")
        .update(patch)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return row as AbdSettings;
    }
    const { data: row, error } = await (context.supabase as any)
      .from("abd_settings")
      .insert(patch)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row as AbdSettings;
  });