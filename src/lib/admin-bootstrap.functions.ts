import { createServerFn } from "@tanstack/react-start";

/**
 * TEMPORARY one-shot bootstrap to create the initial admin account.
 * DELETE this file immediately after use.
 */
export const bootstrapAdmin = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = "admin@qail.local";
  const password = "Sean71";

  // Check if already exists
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) {
    return { status: "exists", userId: existing.id, email };
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Admin" },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return { status: "created", userId: data.user?.id, email };
});