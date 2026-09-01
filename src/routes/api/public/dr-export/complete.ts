/**
 * 논리 DR — 진행상태·완료 영수증 기록.
 * 실패 파일이 하나라도 있으면 completed 로 확정하지 않는다.
 */
import { createFileRoute } from "@tanstack/react-router";
import { drJsonError, withDrToken } from "./_shared";
import { maskDrSecret } from "@/lib/backup/dr-export-contract";

export const Route = createFileRoute("/api/public/dr-export/complete")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        withDrToken(request, async ({ admin, run, token }) => {
          let body: {
            phase?: "progress" | "completed" | "failed";
            files?: number;
            bytes?: number;
            failed_files?: number;
            error_code?: string;
            error_message?: string;
            receipt?: Record<string, unknown>;
          } = {};
          try {
            body = (await request.json()) as typeof body;
          } catch {
            return drJsonError("BODY_INVALID", "요청 본문을 읽을 수 없습니다.", 400);
          }

          const files = Math.max(Number(body.files ?? 0), 0);
          const bytes = Math.max(Number(body.bytes ?? 0), 0);
          const failed = Math.max(Number(body.failed_files ?? 0), 0);

          const patch: Record<string, unknown> = { files_downloaded: files, bytes_downloaded: bytes };
          if (body.phase === "completed") {
            if (failed > 0) {
              patch.status = "failed";
              patch.error_code = "DOWNLOAD_INCOMPLETE";
              patch.error_message = `실패한 파일 ${failed}건이 있어 완료로 확정하지 않았습니다.`;
            } else {
              patch.status = "completed";
              patch.completed_at = new Date().toISOString();
            }
          } else if (body.phase === "failed") {
            patch.status = "failed";
            patch.error_code = String(body.error_code ?? "GENERATOR_FAILED");
            patch.error_message = maskDrSecret(body.error_message ?? "", [token]).slice(0, 2000);
          }
          if (body.receipt && typeof body.receipt === "object") {
            patch.receipt = JSON.parse(maskDrSecret(JSON.stringify(body.receipt), [token]));
          }

          const { error } = await (admin as any)
            .from("dr_export_runs")
            .update(patch)
            .eq("id", run.id)
            .in("status", ["issued", "downloading"]);
          if (error) return drJsonError("RUN_UPDATE_FAILED", "진행 상태를 기록하지 못했습니다.", 500);
          return Response.json({ ok: true, status: patch.status ?? run.status });
        }),
    },
  },
});
