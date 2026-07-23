import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_FIELDS = new Set(["team", "data_date"]);

const UpdateSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

function normalizeName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export const updateTaskOwnerField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!ALLOWED_FIELDS.has(data.field)) {
      throw new Error(`Field '${data.field}' 은 이 경로로 편집할 수 없습니다.`);
    }

    // 1) 역할 확인 (admin / superuser 통과)
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "superuser" }),
    ]);
    let allowed = !!isAdmin || !!isSuper;

    // 2) 그 외에는 Owner (hdec_pic_name 일치) 여부 확인
    if (!allowed) {
      const [{ data: profile }, { data: row }] = await Promise.all([
        context.supabase
          .from("profiles")
          .select("hdec_pic_name")
          .eq("id", context.userId)
          .maybeSingle(),
        context.supabase
          .from("task_management_raw")
          .select("hdec_pic_name")
          .eq("id", data.id)
          .maybeSingle(),
      ]);
      const mine = normalizeName((profile as any)?.hdec_pic_name);
      const owner = normalizeName((row as any)?.hdec_pic_name);
      allowed = !!mine && !!owner && mine === owner;
    }

    if (!allowed) {
      throw new Error("권한 없음: Superuser 또는 해당 항목의 HDEC PIC만 편집할 수 있습니다.");
    }

    // 3) 값 정규화
    let value: unknown = data.value;
    if (typeof value === "string" && value.trim() === "") value = null;
    if (data.field === "team" && value != null) value = String(value).toUpperCase().trim();

    const patch: Record<string, unknown> = {
      [data.field]: value,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("task_management_raw")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });