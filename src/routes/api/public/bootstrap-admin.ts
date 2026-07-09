import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const email = "admin@qail.local";
        const password = "Sean71";

        const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr) return Response.json({ error: listErr.message }, { status: 500 });

        const existing = list.users.find((u) => u.email?.toLowerCase() === email);
        if (existing) {
          return Response.json({ status: "exists", userId: existing.id, email });
        }

        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: "Admin" },
        });
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ status: "created", userId: data.user?.id, email });
      },
    },
  },
});