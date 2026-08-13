import { useMemo } from "react";
import { useTaskDashboardData } from "@/hooks/useTaskDashboardData";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { resolveJudgment } from "@/lib/task-management/delay-utils";
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import type { TaskItem } from "@/lib/task-management/schedule-utils";

/**
 * TM S-Curve · KPI 정본 데이터.
 * TmKpiAnalysisPage 에 박혀 있던 props 준비 로직을 그대로 옮긴 것이다(계산식 변경 없음).
 * 프로젝트 대시보드와 KPI Analysis 화면이 같은 훅을 쓴다.
 */
export const TM_DELAY_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "delayed", label: "지연만" },
  { value: "risk", label: "악화만" },
] as const;

export interface TmScurveParams {
  asOfDate: string;
  disciplines?: string[];
  plots?: string[];
  hdecPic?: string[];
  hdecEng?: string[];
  taskScope: TaskScope;
  workType: string;
  delayFilter?: string;
}

function listLabel(arr: string[] | undefined) {
  return !arr || arr.length === 0 ? "All" : arr.length <= 3 ? arr.join(", ") : `${arr.length} selected`;
}

export function useTmScurveData(params: TmScurveParams) {
  const {
    asOfDate,
    disciplines,
    plots,
    hdecPic,
    hdecEng,
    taskScope,
    workType,
    delayFilter,
  } = params;

  const { data: items = [], isLoading } = useTaskDashboardData(
    {
      disciplines: disciplines ?? [],
      plots: plots ?? [],
      // 담당자 축의 Team 필터는 폐기 — 상단 Team(=discipline) 필터만 사용
      teams: [],
      hdecPic: hdecPic ?? [],
      hdecEng: hdecEng ?? [],
      level: "all",
      q: "",
    },
    asOfDate,
  );

  const scopedByTaskScope = useMemo(() => scopeItems(items, taskScope), [items, taskScope]);

  const { data: thresholdsData } = useTaskManagementSettings();
  const thresholds = thresholdsData ?? DEFAULT_THRESHOLDS;

  const scopedItems: TaskItem[] = useMemo(() => {
    let base = scopedByTaskScope;
    if (workType !== "all")
      base = base.filter(
        (it) => ((it as { row_type?: string | null }).row_type ?? "").trim() === workType,
      );
    if (delayFilter === "risk")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "악화");
    if (delayFilter === "delayed")
      return base.filter((it) => resolveJudgment(it, thresholds, asOfDate) === "지연");
    // "전체" 는 모집단 그대로 — 지연 과업만 남기지 않는다.
    return base;
  }, [scopedByTaskScope, workType, delayFilter, thresholds, asOfDate]);

  const filterSummary = useMemo(
    () => [
      { label: "Task", value: taskScope === "main" ? "Main" : "Sub" },
      { label: "Team", value: listLabel(disciplines) },
      { label: "PIC", value: listLabel(hdecPic) },
      { label: "ENG", value: listLabel(hdecEng) },
      { label: "Work Type", value: workType === "all" ? "All" : workType },
      {
        label: "Delay",
        value:
          TM_DELAY_FILTER_OPTIONS.find((o) => o.value === delayFilter)?.label ??
          String(delayFilter ?? "all"),
      },
    ],
    [taskScope, disciplines, hdecPic, hdecEng, workType, delayFilter],
  );

  return { items, scopedItems, thresholds, isLoading, filterSummary };
}
