/** 논리 DR — 선택 Snapshot manifest 원본 반환 (읽기 전용). */
import { createFileRoute } from "@tanstack/react-router";
import { withDrToken } from "./-shared";

export const Route = createFileRoute("/api/public/dr-export/manifest")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withDrToken(request, async ({ admin, run }) => {
          const mod = await import("@/lib/backup/dr-export.server");
          const v = await mod.loadAndVerifySnapshot(admin, run.snapshot_id);
          return new Response(v.manifestBytes as unknown as BodyInit, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              "x-dr-manifest-sha256": v.manifestSha,
            },
          });
        }),
    },
  },
});
