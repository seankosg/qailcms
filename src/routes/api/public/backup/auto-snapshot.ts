import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/backup/auto-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const BACKUP_TRIGGER_SECRET = process.env.BACKUP_TRIGGER_SECRET;
        if (!BACKUP_TRIGGER_SECRET) {
          return new Response(JSON.stringify({ error: "Server misconfiguration" }), { status: 500 });
        }
        const provided = request.headers.get("x-backup-secret") ?? "";
        // Constant-time compare
        const a = Buffer.from(provided);
        const b = Buffer.from(BACKUP_TRIGGER_SECRET);
        if (a.length !== b.length) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const { timingSafeEqual } = await import("crypto");
        if (!timingSafeEqual(a, b)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
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

          // 보관정책 정리는 반드시 완료를 기다린다(serverless 중단 방지).
          // 정리 실패는 별도로 기록하되 성공한 Snapshot 을 실패로 뒤집지 않는다.
          let cleanup_error: string | null = null;
          try {
            await core.cleanupOldSnapshots(supabaseAdmin);
          } catch (err) {
            cleanup_error = (err as Error).message;
            console.error("Retention cleanup failed", err);
            await supabaseAdmin
              .from("backup_run_log")
              .update({ error_message: `cleanup_failed: ${cleanup_error}` })
              .eq("id", runId);
          }

          return Response.json({ success: true, snapshot: result, cleanup_error });
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
