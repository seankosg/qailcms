import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getTaskHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        discipline: z.string().min(1),
        task_no: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_management_status_history")
      .select("id, field, old_value, new_value, source, changed_by, changed_at")
      .eq("discipline", data.discipline)
      .eq("task_no", data.task_no)
      .order("changed_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });