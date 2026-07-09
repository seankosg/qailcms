import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/closure/spare-part/import/logs")({
  head: () => ({ meta: [{ title: "Spare Part — Import Logs" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Import Logs</h1>
      <p className="text-sm text-muted-foreground">임포트 실행 이력은 다음 단계에서 구축됩니다.</p>
    </div>
  ),
});