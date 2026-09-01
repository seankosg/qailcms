/** 논리 DR — manifest 가 선언한 Snapshot part 만 스트리밍한다. */
import { createFileRoute } from "@tanstack/react-router";
import { drJsonError, streamBlob, withDrToken } from "./_shared";

export const Route = createFileRoute("/api/public/dr-export/part")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withDrToken(request, async ({ admin, run }) => {
          const path = new URL(request.url).searchParams.get("path");
          const mod = await import("@/lib/backup/dr-export.server");
          const resolved = await mod.resolveSnapshotPart(admin, run, path);
          const { data, error } = await admin.storage.from(resolved.bucket).download(resolved.fullPath);
          if (error || !data) return drJsonError("PART_DOWNLOAD_FAILED", "파일을 내려받지 못했습니다.", 502);
          return streamBlob(data, resolved.declared.path.split("/").pop() ?? "part.jsonl", {
            "x-dr-part-sha256": resolved.declared.sha256,
            "x-dr-part-bytes": String(resolved.declared.size_bytes),
          });
        }),
    },
  },
});
