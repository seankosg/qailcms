import { createFileRoute } from "@tanstack/react-router";
import { AbdImportPage } from "@/components/abd/import/AbdImportPage";

export const Route = createFileRoute("/_authenticated/closure/abd/import")({
  head: () => ({ meta: [{ title: "ABD Import — QAIL CMS" }] }),
  component: AbdImportPage,
});