/** 논리 DR — 업무 버킷 재귀 목록(페이지네이션). 허용 7개 버킷 외에는 거부한다. */
import { createFileRoute } from "@tanstack/react-router";
import { withDrToken } from "./_shared";
import { DR_LIST_PAGE_MAX } from "@/lib/backup/dr-export-contract";

export const Route = createFileRoute("/api/public/dr-export/list")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        withDrToken(request, async ({ admin }) => {
          const url = new URL(request.url);
          const bucket = url.searchParams.get("bucket") ?? "";
          const prefix = url.searchParams.get("prefix") ?? "";
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? DR_LIST_PAGE_MAX), 1), DR_LIST_PAGE_MAX);
          const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
          const mod = await import("@/lib/backup/dr-export.server");
          const result = await mod.listWorkBucketObjects(admin, bucket, { prefix, limit, offset });
          return Response.json(result, { headers: { "cache-control": "no-store" } });
        }),
    },
  },
});
