import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DISCIPLINE_VALUES = ["ARCH", "ELEC", "MECH", "DESN", "PRJC"] as const;
const DisciplineSchema = z.object({
  discipline: z.enum(DISCIPLINE_VALUES),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자 권한이 필요합니다");
}

/** 전체 parent 롤업 (특정 공종) */
export const runRollupAllParents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => DisciplineSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: n, error } = await supabaseAdmin.rpc(
      "rollup_task_all_parents",
      { _discipline: data.discipline },
    );
    if (error) throw new Error(error.message);
    return { rolledUp: Number(n ?? 0) };
  });

/** 특정 parent 하나만 롤업 */
export const runRollupSingle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
      z
        .object({
          discipline: z.enum(DISCIPLINE_VALUES),
          parent_task_no: z.string().min(1),
        })
        .parse(v),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("update_task_summary", {
      _discipline: data.discipline,
      _parent_task_no: data.parent_task_no,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** auto_judgment 전체 재계산 */
export const runRecalcAutoJudgment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
      z
        .object({
          discipline: z.enum(DISCIPLINE_VALUES).nullable().optional(),
        })
        .parse(v ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: n, error } = await supabaseAdmin.rpc(
      "recalc_task_auto_judgment",
      data.discipline
        ? { _discipline: data.discipline }
        : ({} as { _discipline?: string }),
    );
    if (error) throw new Error(error.message);
    return { updated: Number(n ?? 0) };
  });