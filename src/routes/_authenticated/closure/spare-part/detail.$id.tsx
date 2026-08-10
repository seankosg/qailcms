import { createFileRoute } from "@tanstack/react-router";
import { SplDetailPage } from "@/components/spl/detail/SplDetailPage";

export const Route = createFileRoute("/_authenticated/closure/spare-part/detail/$id")({
  head: () => ({
    meta: [
      { title: "SPL Detail | QAIL CMS" },
      { name: "description", content: "예비품 목록(SPL) 항목 상세 — 단계 타임라인, 필수 문서, 변경 이력." },
      { property: "og:title", content: "SPL Detail | QAIL CMS" },
      { property: "og:description", content: "예비품 목록(SPL) 항목 상세 — 단계 타임라인, 필수 문서, 변경 이력." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SplDetailPage,
});