import { MilestoneTimelineCard } from "./MilestoneTimelineCard";

export function OutstandingDashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Outstanding Work</h1>
        <p className="text-sm text-muted-foreground">
          미완료 업무 요약 대시보드. 각 모듈로 이동해 세부 데이터를 확인하세요.
        </p>
      </div>
      <MilestoneTimelineCard />
    </div>
  );
}
