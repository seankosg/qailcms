import { createFileRoute } from "@tanstack/react-router";
import { MyWorkSpacePage } from "@/components/my-work-space/MyWorkSpacePage";

export const Route = createFileRoute("/_authenticated/my-work-space")({
  head: () => ({
    meta: [
      { title: "My Work Space — QAIL CMS" },
      { name: "description", content: "본인이 HDEC PIC인 항목에 대한 모듈별 KPI 및 리스트 요약." },
    ],
  }),
  component: MyWorkSpacePage,
});