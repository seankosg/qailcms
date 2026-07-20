import { FileSpreadsheet, Package, ShieldCheck } from "lucide-react";
import { SectionDashboardCard } from "./SectionDashboardCard";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export function CloseOutDashboardPage() {
  const { data: me } = useCurrentUser();
  const isAdmin = !!me?.isAdmin;
  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Close-Out Doc</h1>
        <p className="text-sm text-muted-foreground">
          준공 문서 관리 요약. 각 모듈로 이동해 세부 데이터를 확인하세요.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SectionDashboardCard
          title="As Built Drawing"
          description="준공 도서(ABD) 관리 및 임포트 현황."
          icon={FileSpreadsheet}
          to="/closure/abd/raw-data"
          cta="ABD 열기"
        />
        {isAdmin && (
          <>
            <SectionDashboardCard
              title="Spare Part"
              description="예비품 목록 및 Aconex 동기화."
              icon={Package}
              to="/closure/spare-part/raw-data"
              cta="Spare Part 열기"
            />
            <SectionDashboardCard
              title="Warranty & License"
              description="보증 및 라이선스 관리. 준비 중입니다."
              icon={ShieldCheck}
              status="coming-soon"
            />
          </>
        )}
      </div>
    </div>
  );
}