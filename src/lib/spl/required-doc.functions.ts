import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL Required Document — mark a checklist entry as required / not required.
 *
 * `flag_value` is canonical. `na_flag` is NOT used here.
 * Write permission is decided by `rcl_can(uid, 'SPL', row, 'write')`, the same
 * function the RLS policies use.
 */
const Schema = z.object({
  item_id: z.string().uuid(),
  stage_code: z.string().min(1),
  required: z.boolean(),
});

export const setSplRequiredDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Schema.parse(v))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as any;

    const { data: cat, error: catErr } = await supa
      .from("spl_stage_catalog")
      .select("stage_code, band")
      .eq("stage_code", data.stage_code)
      .maybeSingle();
    if (catErr) throw new Error(catErr.message);
    if (!cat || cat.band !== "REQUIRED_DOC") {
      throw new Error(`Stage '${data.stage_code}' is not a Required Document entry.`);
    }

    const { data: ok, error: permErr } = await supa.rpc("rcl_can", {
      _user_id: context.userId,
      _module: "SPL",
      _row_id: data.item_id,
      _action: "write",
    });
    if (permErr) throw new Error(permErr.message);
    if (!ok) throw new Error("Permission denied: you cannot edit this row.");

    const value = data.required ? "Yes" : null;
    const now = new Date().toISOString();

    const { data: existing, error: selErr } = await supa
      .from("spl_stage_progress")
      .select("id")
      .eq("item_id", data.item_id)
      .eq("stage_code", data.stage_code)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);

    if (existing?.id) {
      const { error } = await supa
        .from("spl_stage_progress")
        .update({ flag_value: value, updated_at: now, updated_by: context.userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supa.from("spl_stage_progress").insert({
        item_id: data.item_id,
        stage_code: data.stage_code,
        flag_value: value,
        created_by: context.userId,
        updated_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
