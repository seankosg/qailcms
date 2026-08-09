import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

/** 진척률 저장 직후 해당 과업 1건만 진도 차트 캐시를 즉시 재계산한다.
 *  실패해도 사용자 흐름을 막지 않는다(야간 배치가 뒤에서 보정). */
export async function recalcTaskChartOne(
  discipline: string | null | undefined,
  taskNo: string | null | undefined,
  qc?: QueryClient,
): Promise<void> {
  if (!taskNo) return;
  try {
    await (supabase as any).rpc("recalc_task_progress_charts", {
      _discipline: discipline ?? null,
      _task_no: taskNo,
    });
    qc?.invalidateQueries({ queryKey: ["task-progress-snapshot"] });
  } catch {
    /* noop */
  }
}
