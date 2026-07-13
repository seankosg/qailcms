import { ClipboardList, AlertTriangle } from "lucide-react";
import { SectionDashboardCard } from "./SectionDashboardCard";

export function OutstandingDashboardPage() {
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Outstanding Work</h1>
        <p className="text-sm text-muted-foreground">
          미완료 업무 요약 대시보드. 각 모듈로 이동해 세부 데이터를 확인하세요.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SectionDashboardCard
          title="Task Management"
          description="공정·진도 계획 대비 실적 및 리스크 감시."
          icon={ClipboardList}
          to="/closure/task-management/raw-data"
          cta="Task 열기"
        />
        <SectionDashboardCard
          title="Defect Management"
          description="Defect 발생·조치·종결 현황. (KPI/S-Curve/Breakdown은 Phase 3 예정)"
          icon={AlertTriangle}
          to="/closure/defect-management/raw-data"
          cta="Defect 열기"
        />
      </div>
    </div>
  );
}