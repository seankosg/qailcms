import { createFileRoute } from "@tanstack/react-router";

function DefectImportPlaceholder() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Defect Management — Import</h1>
      <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
        Phase 2에서 구현됩니다. Team 선택(건축/전기/설비), 컬럼 매핑, 배치 upsert, Rollback 을 포함합니다.
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/closure/defect-management/import")({
  head: () => ({ meta: [{ title: "Defect Management — Import" }] }),
  component: DefectImportPlaceholder,
});