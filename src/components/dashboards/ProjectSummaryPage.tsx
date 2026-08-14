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
import { PdbLangProvider, usePdbLang, usePdbT } from "@/lib/dashboards/pdb-i18n";
import { PdbPlotProvider, usePdbPlot, type PdbPlotFilter } from "@/lib/dashboards/pdb-plot";

export function ProjectSummaryPage() {
  return (
    <PdbLangProvider>
      <PdbPlotProvider>
        <ProjectSummaryBody />
      </PdbPlotProvider>
    </PdbLangProvider>
  );
}

function ProjectSummaryBody() {
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
  const { lang, setLang } = usePdbLang();
  const { plotFilter, setPlotFilter } = usePdbPlot();
  const t = usePdbT();

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* 페이지 제목이 화면의 유일한 최상위 위계 — 모듈 제목은 한 단계 아래 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Project Dashboard</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("dataDate")}</span>
          <Input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value || todayInDoha())}
            className="h-8 w-[150px] text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => void refresh()}
            disabled={refreshing || !restored}
            title={t("refreshHint")}
          >
            <RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Refresh
          </Button>
          <Link to="/admin/setting">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Setting
            </Button>
          </Link>
          <div className="inline-flex h-8 items-center overflow-hidden rounded-md border">
            {(["ko", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={
                  lang === l
                    ? "h-full px-2 text-xs font-semibold bg-primary text-primary-foreground"
                    : "h-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted"
                }
              >
                {l === "ko" ? "KOR" : "ENG"}
              </button>
            ))}
          </div>
          {/* Plot 탭 — 한 플롯만 고르면 아래 모든 섹션이 1열로 좁혀진다 */}
          <div className="inline-flex h-8 items-center overflow-hidden rounded-md border">
            {(["D", "C", "all"] as const).map((p: PdbPlotFilter) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlotFilter(p)}
                className={
                  plotFilter === p
                    ? "h-full px-2.5 text-xs font-semibold bg-primary text-primary-foreground"
                    : "h-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                }
              >
                {p === "all" ? "All" : `Plot ${p}`}
              </button>
            ))}
          </div>
        </div>
      </header>

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
        <div className="py-10 text-center text-sm text-muted-foreground">{t("restoring")}</div>
      )}
    </div>
  );
}
