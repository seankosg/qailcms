/** 논리 DR — 업무 버킷의 개별 파일 스트리밍(목록에 실재하는 경로만). */
import { createFileRoute } from "@tanstack/react-router";
import { drJsonError, streamBlob, withDrToken } from "./_shared";

export const Route = createFileRoute("/api/public/dr-export/object")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withDrToken(request, async ({ admin }) => {
          const url = new URL(request.url);
          const bucket = url.searchParams.get("bucket") ?? "";
          const path = url.searchParams.get("path");
          const mod = await import("@/lib/backup/dr-export.server");
          const resolved = await mod.resolveWorkObject(admin, bucket, path);
          const { data, error } = await admin.storage.from(resolved.bucket).download(resolved.path);
          if (error || !data) return drJsonError("OBJECT_DOWNLOAD_FAILED", "파일을 내려받지 못했습니다.", 502);
          return streamBlob(data, resolved.path.split("/").pop() ?? "file.bin", {
            "x-dr-object-bytes": String(resolved.size),
          });
        }),
    },
  },
});
