import { createFileRoute } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ImportHubPage } from "@/components/import-log/ImportHubPage";

const searchSchema = z.object({
  tab: fallback(z.string(), "task").default("task"),
});

export const Route = createFileRoute("/_authenticated/import-log/import")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({ meta: [{ title: "Import — QAIL CMS" }] }),
  component: ImportHubPage,
});