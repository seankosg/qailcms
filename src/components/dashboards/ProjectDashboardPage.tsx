import { useState } from "react";
import { MilestoneTimelineCard } from "./MilestoneTimelineCard";
import { MilestoneReferenceButton } from "@/components/task-management/shared/MilestoneReferenceButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ProjectDashboardPage() {
  const [hidePlotG, setHidePlotG] = useState(false);

  return (
    <div className="flex flex-col gap-8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Milestone Timeline</h1>
          <p className="text-sm text-muted-foreground">프로젝트 전체 마일스톤 타임라인.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={hidePlotG}
            onClick={() => setHidePlotG((s) => !s)}
            className={cn(
              "h-8 px-2.5 text-xs",
              hidePlotG && "bg-muted text-muted-foreground",
            )}
            title={hidePlotG ? "Plot G 표시" : "Plot G 숨기기"}
          >
            off
          </Button>
          <MilestoneReferenceButton />
        </div>
      </div>

      <MilestoneTimelineCard hidePlotG={hidePlotG} />
    </div>
  );
}

