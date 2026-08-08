import { MilestoneTimelineCard } from "./MilestoneTimelineCard";

export function ProjectDashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Project Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          프로젝트 전체 마일스톤 및 미완료 업무 요약.
        </p>
      </div>
      <MilestoneTimelineCard />
    </div>
  );
}
