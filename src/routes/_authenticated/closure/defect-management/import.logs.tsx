import { createFileRoute } from "@tanstack/react-router";

function DefectImportLogsPlaceholder() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Defect Management — Import Logs</h1>
      <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">Phase 2에서 구현됩니다.</div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/closure/defect-management/import/logs")({
  head: () => ({ meta: [{ title: "Defect Management — Import Logs" }] }),
  component: DefectImportLogsPlaceholder,
});