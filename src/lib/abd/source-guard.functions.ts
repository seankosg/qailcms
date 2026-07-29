import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * 소스 가드 강제 진행 기록 — admin/superuser 만 호출 가능.
 * abd_import_logs 에 한 줄 남겨 사후 추적을 가능하게 한다.
 */

const InputSchema = z.object({
  mode: z.enum(["hdec", "aconex"]),
  files: z
    .array(
      z.object({
        name: z.string().max(500),
        detected: z.enum(["hdec", "aconex", "unknown"]),
        reasons: z.array(z.string().max(200)).max(20),
      }),
    )
    .max(50),
});

export const recordAbdSourceOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "superuser" }),
    ]);
    if (!isAdmin && !isSuper) {
      throw new Error(
        "Forbidden — source guard 강제 진행은 admin/superuser 만 가능합니다",
      );
    }
    if (data.files.length === 0) return { logged: 0 };
    const rows = data.files.map((f) => ({
      file_name: f.name,
      status: "override" as const,
      source_kind: data.mode,
      imported_by: userId,
      note: `source guard override — detected=${f.detected}; reasons=${f.reasons
        .slice(0, 6)
        .join(" | ")}`,
    }));
    const { error } = await supabase.from("abd_import_logs").insert(rows);
    if (error) throw new Error(error.message);
    return { logged: rows.length };
  });