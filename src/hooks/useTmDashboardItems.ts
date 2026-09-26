import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withSrvFields, type TmAsOfRow } from "@/hooks/useTmRowsAsOf";
import { useTaskManagementSettings } from "@/hooks/useTaskManagementSettings";
import { DEFAULT_THRESHOLDS } from "@/lib/task-management/derived";
import { resolveJudgment } from "@/lib/task-management/delay-utils";
import { scopeItems, type TaskScope } from "@/lib/task-management/kpi-utils";
import type { TaskItem } from "@/lib/task-management/schedule-utils";
import {
  TM_DELAY_FILTER_OPTIONS,
  type TmScurveParams,
} from "@/hooks/useTmScurveData";

/**
 * 프로젝트 대시보드 전용 TM 행 소스.
 * 정본 tm_rows_as_of 의 경량 투영 RPC(tm_dashboard_items_json)만 사용한다 —
 * 계산식을 새로 만들지 않고 정본 값을 그대로 받는다(화면 숫자 불변).
 * TM KPI Analysis 등 전체 컬럼이 필요한 화면은 기존 useTmScurveData 를 그대로 쓴다.
 */
export function useTmDashboardItems(params: TmScurveParams) {
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

  const q = useQuery({
    queryKey: ["tm-dashboard-items", asOfDate],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<TmAsOfRow[]> => {
      const { data, error } = await (supabase as any).rpc("tm_dashboard_items_json", {
        p_as_of: asOfDate,
      });
      if (error) throw error;
      return withSrvFields(Array.isArray(data) ? data : []);
    },
  });

  const items = useMemo(() => {
    const rows = (q.data ?? []) as unknown as TaskItem[];
    return rows.filter((r) => {
      if (disciplines?.length && !disciplines.includes(String(r.discipline ?? ""))) return false;
      if (plots?.length && !plots.includes(String(r.plot ?? ""))) return false;
      const pic = String((r as any).effective_pic ?? r.hdec_pic_name ?? "");
      const picOrig = String(r.hdec_pic_name ?? "");
      if (hdecPic?.length && !hdecPic.includes(pic) && !hdecPic.includes(picOrig)) return false;
      if (hdecEng?.length && !hdecEng.includes(String(r.hdec_eng_name ?? ""))) return false;
      return true;
    });
  }, [q.data, disciplines, plots, hdecPic, hdecEng]);

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
    return base;
  }, [scopedByTaskScope, workType, delayFilter, thresholds, asOfDate]);

  const listLabel = (arr: string[] | undefined) =>
    !arr || arr.length === 0 ? "All" : arr.length <= 3 ? arr.join(", ") : `${arr.length} selected`;

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

  return { items, scopedItems, thresholds, isLoading: q.isLoading, filterSummary };
}
