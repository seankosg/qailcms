import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPage } from "@/components/organization/OrganizationPage";

export const Route = createFileRoute("/_authenticated/organization")({
  head: () => ({
    meta: [
      { title: "Organization — QAIL CMS" },
      { name: "description", content: "전 사용자 업무 이관(위임) 현황 요약." },
      { property: "og:title", content: "Organization — QAIL CMS" },
      { property: "og:description", content: "전 사용자 업무 이관(위임) 현황 요약." },
    ],
  }),
  component: OrganizationPage,
});
