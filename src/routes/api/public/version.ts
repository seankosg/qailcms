import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        const buildId =
          typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
        return new Response(JSON.stringify({ buildId }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      },
    },
  },
});