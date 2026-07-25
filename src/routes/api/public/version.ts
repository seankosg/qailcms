import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: async () => {
        const fromDefine =
          typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "";
        const fromEnv =
          typeof import.meta !== "undefined"
            ? import.meta.env?.VITE_APP_BUILD_ID
            : undefined;
        const buildId =
          fromDefine || (typeof fromEnv === "string" ? fromEnv : "");
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