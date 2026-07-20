import { createFileRoute } from "@tanstack/react-router";
import { verifyBearerAndGetSupabase, assertRole } from "@/lib/backup/backup-auth.server";

export const Route = createFileRoute("/api/public/backup/archive-download")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { snapshot_id?: string } = {};
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
        }

        try {
          const { supabase, userId } = await verifyBearerAndGetSupabase(request);
          await assertRole(supabase, userId, ["admin", "superuser"]);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const core = await import("@/lib/backup/backup-core.server");

          let snapshotId = payload.snapshot_id;
          if (!snapshotId) {
            const { data, error } = await supabaseAdmin
              .from("database_snapshots")
              .select("id")
              .order("created_at", { ascending: false })
              .limit(1)
              .single();
            if (error || !data) {
              return new Response(JSON.stringify({ error: "No snapshot found" }), { status: 404 });
            }
            snapshotId = data.id;
          }

          const blob = await core.buildSnapshotZip(supabaseAdmin, snapshotId);
          const filename = `qail-backup-${snapshotId}.zip`;

          return new Response(blob, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        } catch (err) {
          const message = (err as Error).message;
          const status = message === "Unauthorized" || message.startsWith("Unauthorized") ? 401 : 403;
          return new Response(JSON.stringify({ error: message }), { status });
        }
      },
    },
  },
});
