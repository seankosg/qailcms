import { createFileRoute } from "@tanstack/react-router";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/spare-part/aconex-sync")({
  beforeLoad: () => assertAdminOrRedirect(),
  head: () => ({ meta: [{ title: "Spare Part — Aconex Sync" }] }),
  component: () => (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Aconex Sync</h1>
      <p className="text-sm text-muted-foreground">Aconex 승인 상태 동기화는 다음 단계에서 구축됩니다.</p>
    </div>
  ),
});