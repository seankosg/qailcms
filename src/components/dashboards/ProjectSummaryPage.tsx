import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayInDoha } from "@/lib/time/doha";
import { usePdbCache } from "@/lib/dashboards/pdb-cache";
import { TmDashboardSection } from "./TmDashboardSection";
import { SmDashboardSection } from "./SmDashboardSection";
import { AbdDashboardSection } from "./AbdDashboardSection";
import { LazySection } from "./LazySection";


export function ProjectSummaryPage() {
  // 기준일 하나 — 세 모듈이 같은 as-of 를 쓴다.
  const [asOfDate, setAsOfDate] = useState<string>(() => todayInDoha());
  // 기준일 입력 디바운스 — 타이핑 중 재조회 폭주를 막는다(표시값은 즉시 갱신).
  const [appliedDate, setAppliedDate] = useState<string>(asOfDate);
  useEffect(() => {
    const t = setTimeout(() => setAppliedDate(asOfDate), 400);
    return () => clearTimeout(t);
  }, [asOfDate]);
  // 캐시 복원(localStorage) — 복원 전에는 섹션 마운트를 미뤄 중복 조회를 막는다.
  const { restored, refresh, refreshing } = usePdbCache();

  return (
    <div className="flex flex-col gap-8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Project Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            TM · SM · ABD 진행 현황 요약 — Plot 별 좌우 비교.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">기준일</span>
            <Input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value || todayInDoha())}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => void refresh()}
              disabled={refreshing || !restored}
              title="저장된 캐시를 비우고 최신 데이터를 다시 불러온다"
            >
              <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              Refresh
            </Button>
            <Link to="/admin/setting">
              <Button variant="outline" size="sm" className="h-7 text-xs">
                Setting
              </Button>
            </Link>
          </div>
        </div>
      </div>


      {restored ? (
        <>
          <TmDashboardSection asOfDate={appliedDate} />
          <LazySection>
            <SmDashboardSection asOfDate={appliedDate} />
          </LazySection>
          <LazySection>
            <AbdDashboardSection asOfDate={appliedDate} />
          </LazySection>
        </>
      ) : (
        <div className="py-10 text-center text-sm text-muted-foreground">캐시 복원 중…</div>
      )}
    </div>
  );
}