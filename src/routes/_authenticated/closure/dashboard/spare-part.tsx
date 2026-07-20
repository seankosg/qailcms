import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ComingSoonWidget } from "@/components/dashboard/ComingSoonWidget";
import { assertAdminOrRedirect } from "@/lib/auth/route-guards";

export const Route = createFileRoute("/_authenticated/closure/dashboard/spare-part")({
  beforeLoad: () => assertAdminOrRedirect(),
  head: () => ({ meta: [{ title: "Spare Part Dashboard — QAIL CMS" }] }),
  component: () => (
    <div className="p-4 space-y-4">
      <Link to="/closure/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboard 허브로 돌아가기
      </Link>
      <ComingSoonWidget
        domain="Spare Part Dashboard"
        description="예비품 대시보드는 다음 이터레이션에서 추가됩니다. 현재는 Raw Data 페이지에서 데이터를 확인하실 수 있습니다."
      />
    </div>
  ),
});