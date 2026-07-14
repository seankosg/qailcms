import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ImportLogsHubPage } from "@/components/import-log/ImportLogsHubPage";

const searchSchema = z.object({
  tab: fallback(z.string(), "task").default("task"),
});

export const Route = createFileRoute("/_authenticated/import-log/logs")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: "Import Logs — QAIL CMS" }] }),
  component: ImportLogsHubPage,
});