import { createFileRoute } from "@tanstack/react-router";
import { TocMechMapPage } from "@/components/toc/admin/TocMechMapPage";

export const Route = createFileRoute("/_authenticated/closure/toc/mech-map")({
  component: TocMechMapPage,
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6 text-sm text-destructive">
      {error.message}
    </div>
  ),
  head: () => ({
    meta: [
      { title: "설비 T&C 대응표 | QAIL CMS" },
      {
        name: "description",
        content: "설비 T&C 잔여 파일의 시스템·설명 조합을 인계(TOC) 항목 키에 연결하는 대응표 화면.",
      },
      { property: "og:title", content: "설비 T&C 대응표 | QAIL CMS" },
      { property: "og:description", content: "설비 T&C 파일 조합과 인계 항목 연결 관리." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
