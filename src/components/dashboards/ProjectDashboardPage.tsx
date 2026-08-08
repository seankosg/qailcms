import { MilestoneTimelineCard } from "./MilestoneTimelineCard";
import { MilestoneReferenceButton } from "@/components/task-management/shared/MilestoneReferenceButton";

export function ProjectDashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Milestone Timeline</h1>
          <p className="text-sm text-muted-foreground">
            프로젝트 전체 마일스톤 및 미완료 업무 요약.
          </p>
        </div>
        <MilestoneReferenceButton />
      </div>
      <MilestoneTimelineCard />
    </div>
  );
}
