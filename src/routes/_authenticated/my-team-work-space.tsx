import { createFileRoute } from "@tanstack/react-router";
import { MyWorkSpacePage } from "@/components/my-work-space/MyWorkSpacePage";

export const Route = createFileRoute("/_authenticated/my-team-work-space")({
  head: () => ({
    meta: [
      { title: "My Team Work Space — QAIL CMS" },
      { name: "description", content: "본인이 소속된 팀의 항목에 대한 모듈별 KPI 및 리스트 요약." },
    ],
  }),
  component: () => <MyWorkSpacePage scope="team" />,
});