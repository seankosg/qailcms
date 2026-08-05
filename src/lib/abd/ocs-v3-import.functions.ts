import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function assertAdmin(supabase: unknown, userId: string) {
  const { data, error } = await (supabase as unknown as LooseClient).rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자(admin) 권한이 필요합니다.");
}

/** V3 dry-run — 읽기 전용. 부모 단위 배치로 호출한다. */
export const ocsV3DryRunParents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: unknown[] }) => {
    if (!Array.isArray(input?.rows)) throw new Error("rows 배열이 필요합니다.");
    if (input.rows.length > 200) throw new Error("배치가 너무 큽니다(최대 200).");
    return { rows: input.rows };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: out, error } = await (context.supabase as unknown as LooseClient).rpc(
      "abd_ocs_v3_dryrun_parents",
      { p_rows: data.rows },
    );
    if (error) throw new Error(error.message);
    return (out ?? {}) as Json;
  });