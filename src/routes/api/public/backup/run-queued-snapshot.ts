import { createFileRoute } from "@tanstack/react-router";
import type { BackupTableName, PreImportModule } from "@/lib/backup/backup-shared";

type QueuedMetadata = {
  kind?: "pre-import" | "manual" | "scheduled";
  module?: PreImportModule;
  import_log_id?: string | null;
  name?: string;
  triggered_by?: string;
  tables?: BackupTableName[];
};

export const Route = createFileRoute("/api/public/backup/run-queued-snapshot")({
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const core = await import("@/lib/backup/backup-core.server");

        // Claim one queued job atomically
        const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
          "claim_next_queued_backup_run" as any,
        );
        if (claimError) {
          return new Response(JSON.stringify({ error: claimError.message }), { status: 500 });
        }
        const claimedRows = (claimed ?? []) as Array<{ id: string; metadata: QueuedMetadata | null }>;
        if (claimedRows.length === 0) {
          return Response.json({ ok: true, drained: true });
        }

        const run = claimedRows[0];
        const meta: QueuedMetadata = run.metadata ?? {};
        const snapshotId = crypto.randomUUID();
        const name =
          meta.name ??
          (meta.kind === "pre-import" && meta.module
            ? `pre-import-${meta.module}-${new Date().toISOString()}`
            : `queued-${new Date().toISOString()}`);
        const triggeredBy = (meta.triggered_by as any) ?? (meta.kind === "pre-import" ? "pre-import" : "scheduled");

        const started = Date.now();
        try {
          const result = await core.createSnapshot(supabaseAdmin, {
            snapshotId,
            name,
            triggeredBy,
            triggerMetadata: {
              kind: meta.kind ?? "pre-import",
              module: meta.module ?? null,
              import_log_id: meta.import_log_id ?? null,
            },
            tables: meta.tables,
          });
          await supabaseAdmin
            .from("backup_run_log")
            .update({
              status: "success",
              snapshot_id: snapshotId,
              finished_at: new Date().toISOString(),
              duration_ms: Date.now() - started,
            })
            .eq("id", run.id);

          // Best-effort retention cleanup
          core.cleanupOldSnapshots(supabaseAdmin).catch((err) => {
            console.error("Background cleanup failed", err);
          });

          return Response.json({ ok: true, snapshot: result });
        } catch (err) {
          await supabaseAdmin
            .from("backup_run_log")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              duration_ms: Date.now() - started,
              error_message: (err as Error).message,
            })
            .eq("id", run.id);
          return new Response(
            JSON.stringify({ ok: false, error: (err as Error).message }),
            { status: 500 },
          );
        }
      },
    },
  },
});
