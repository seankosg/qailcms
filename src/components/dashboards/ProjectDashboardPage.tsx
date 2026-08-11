import { useState } from "react";
import { MilestoneTimelineCard } from "./MilestoneTimelineCard";
import { MilestoneReferenceButton } from "@/components/task-management/shared/MilestoneReferenceButton";
import { TmDashboardSection } from "./TmDashboardSection";
import { SmDashboardSection } from "./SmDashboardSection";
import { AbdDashboardSection } from "./AbdDashboardSection";
import { Input } from "@/components/ui/input";
import { todayInDoha } from "@/lib/time/doha";

export function ProjectDashboardPage() {
  // 기준일 하나 — 세 모듈이 같은 as-of 를 쓴다.
  const [asOfDate, setAsOfDate] = useState<string>(() => todayInDoha());

  return (
    <div className="flex flex-col gap-8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Project Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            프로젝트 전체 마일스톤과 TM · SM · ABD 진행 현황 요약.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">기준일</span>
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value || todayInDoha())}
            className="h-8 w-[150px] text-xs"
          />
          <MilestoneReferenceButton />
        </div>
      </div>

      <MilestoneTimelineCard />

      <TmDashboardSection asOfDate={asOfDate} />
      <SmDashboardSection asOfDate={asOfDate} />
      <AbdDashboardSection asOfDate={asOfDate} />
    </div>
  );
}
