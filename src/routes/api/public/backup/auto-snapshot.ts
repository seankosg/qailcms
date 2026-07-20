import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/backup/auto-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500 });
        }

        const apiKey = request.headers.get("apikey") ?? "";
        if (apiKey !== SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Invalid apikey" }), { status: 401 });
        }

        let body: { trigger?: string; metadata?: Record<string, unknown> } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          // ignore empty body
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const core = await import("@/lib/backup/backup-core.server");

        const snapshotId = crypto.randomUUID();
        const runId = crypto.randomUUID();
        const name = `auto-${body.trigger ?? "scheduled"}-${new Date().toISOString()}`;

        const { error: logError } = await supabaseAdmin.from("backup_run_log").insert({
          id: runId,
          status: "running",
          snapshot_id: null,
        });
        if (logError) {
          return new Response(JSON.stringify({ error: logError.message }), { status: 500 });
        }

        const started = Date.now();
        try {
          const result = await core.createSnapshot(supabaseAdmin, {
            snapshotId,
            name,
            triggeredBy: (body.trigger as any) ?? "scheduled",
            triggerMetadata: body.metadata ?? null,
          });

          await supabaseAdmin
            .from("backup_run_log")
            .update({
              status: "success",
              snapshot_id: snapshotId,
              finished_at: new Date().toISOString(),
              duration_ms: Date.now() - started,
            })
            .eq("id", runId);

          // Run retention cleanup in the background (no await for response)
          core.cleanupOldSnapshots(supabaseAdmin).catch((err) => {
            console.error("Background cleanup failed", err);
          });

          return Response.json({ success: true, snapshot: result });
        } catch (err) {
          await supabaseAdmin
            .from("backup_run_log")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              duration_ms: Date.now() - started,
              error_message: (err as Error).message,
            })
            .eq("id", runId);
          return new Response(
            JSON.stringify({ success: false, error: (err as Error).message }),
            { status: 500 },
          );
        }
      },
    },
  },
});
