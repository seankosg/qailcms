import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ViewPreferenceState = Record<string, unknown>;

export const getUserViewPreference = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { viewKey: string }) => {
    if (!data || typeof data.viewKey !== "string" || !data.viewKey) {
      throw new Error("viewKey is required");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("user_view_preferences")
      .select("state, updated_at")
      .eq("user_id", userId)
      .eq("view_key", data.viewKey)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    return {
      state: (row.state ?? null) as ViewPreferenceState | null,
      updated_at: row.updated_at as string,
    };
  });

export const upsertUserViewPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { viewKey: string; state: ViewPreferenceState }) => {
    if (!data || typeof data.viewKey !== "string" || !data.viewKey) {
      throw new Error("viewKey is required");
    }
    if (!data.state || typeof data.state !== "object") {
      throw new Error("state must be an object");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_view_preferences")
      .upsert(
        { user_id: userId, view_key: data.viewKey, state: data.state as never },
        { onConflict: "user_id,view_key" },
      );
    if (error) throw error;
    return { ok: true };
  });