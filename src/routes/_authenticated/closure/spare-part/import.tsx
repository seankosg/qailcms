import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import")({
  head: () => ({ meta: [{ title: "Spare Part — Import" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Spare Part — Import</h1>
      <p className="text-sm text-muted-foreground">SHAW Defect Import 파리티 UI를 다음 단계에서 구축합니다.</p>
    </div>
  ),
});