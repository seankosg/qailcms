/**
 * 논리 DR — run·Snapshot 계약 조회 (읽기 전용).
 * 인증: Authorization: Bearer <일회용 DR 토큰>
 */
import { createFileRoute } from "@tanstack/react-router";
import { drJsonError, withDrToken } from "./_shared";
import { DR_PACKAGE_SCHEMA_VERSION, DR_WORK_BUCKETS } from "@/lib/backup/dr-export-contract";

export const Route = createFileRoute("/api/public/dr-export/run")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withDrToken(request, async ({ admin, run }) => {
          const mod = await import("@/lib/backup/dr-export.server");
          const v = await mod.loadAndVerifySnapshot(admin, run.snapshot_id);
          if (run.snapshot_manifest_sha256 && run.snapshot_manifest_sha256 !== v.manifestSha) {
            return drJsonError("SNAPSHOT_MANIFEST_CHANGED", "Snapshot 목록 파일이 발급 시점과 다릅니다.", 409);
          }
          return Response.json({
            package_schema_version: DR_PACKAGE_SCHEMA_VERSION,
            run_id: run.id,
            status: run.status,
            expires_at: run.expires_at,
            snapshot: {
              id: v.row.id,
              name: v.row.name,
              created_at: v.row.created_at,
              manifest_sha256: v.manifestSha,
              overall_sha256: v.manifest.sha256,
              schema_fingerprint: v.manifest.schema_fingerprint,
              part_count: v.parts.length,
              total_rows: v.manifest.total_rows ?? null,
            },
            buckets: [...DR_WORK_BUCKETS],
            excluded_buckets: ["db-backups"],
          });
        }),
    },
  },
});
