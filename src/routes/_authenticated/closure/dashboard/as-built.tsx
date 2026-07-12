import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ComingSoonWidget } from "@/components/dashboard/ComingSoonWidget";

export const Route = createFileRoute("/_authenticated/closure/dashboard/as-built")({
  head: () => ({ meta: [{ title: "As-Built Drawing Dashboard — QAIL CMS" }] }),
  component: () => (
    <div className="p-4 space-y-4">
      <Link to="/closure/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboard 허브로 돌아가기
      </Link>
      <ComingSoonWidget domain="As-Built Drawing Dashboard" description="준공 도서 대시보드는 향후 이터레이션에서 추가됩니다." />
    </div>
  ),
});