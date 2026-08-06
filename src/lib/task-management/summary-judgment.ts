/**
 * Task Summary 판정 정본 — 화면(TaskTreePage)과 Export(exportTaskSummary)가
 * 반드시 같은 함수를 부른다. 식을 복제하지 말 것.
 */
import {
  DEFAULT_THRESHOLDS,
  computeJudgment,
  judgeFromGap,
  mainVariance,
  worstJudgment,
} from "@/lib/task-management/derived";
import type { TaskThresholds } from "@/lib/task-management/derived";
import { resolveJudgment } from "@/lib/task-management/delay-utils";

export type JudgeableRow = Record<string, unknown> & {
  task_no: string;
  actual_progress?: number | null;
  actual_start?: string | null;
  actual_finish?: string | null;
  plan_start?: string | null;
  plan_end?: string | null;
  auto_judgment?: string | null;
};

/** 정본 경유: 서버 병합 판정(srv_judgment) 우선, 없을 때만 as-of 클라 재판정. */
export function resolveRowJudgment(
  r: JudgeableRow,
  thresholds: TaskThresholds = DEFAULT_THRESHOLDS,
  asOfDate?: string,
): string {
  return resolveJudgment(r as never, thresholds, asOfDate ?? "") || "";
}

export function resolveMainJudgment(
  main: JudgeableRow,
  kids: JudgeableRow[],
  thresholds: TaskThresholds = DEFAULT_THRESHOLDS,
  asOfDate?: string,
): string {
  // 정본 우선: 서버 tm_kpi_judgment_g(Main 가중 계획 tm_main_tplan 기준) 값이 있으면 그대로 사용.
  const srv = (main as { srv_judgment?: string | null }).srv_judgment;
  if (srv != null && srv !== "" && srv !== "이력 없음") return srv;
  if (kids.length === 0) {
    // 하위 없는 Main = 자기 창 선형 tplan vs 자기 Actual
    return computeJudgment(main as never, thresholds, asOfDate) || "";
  }

  const clamp01 = (v: unknown) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n)) return 0;
    const s = n > 1 ? n / 100 : n;
    return Math.max(0, Math.min(1, s));
  };
  const rolledActual = clamp01(main.actual_progress);
  const allDone = kids.every(
    (k) => clamp01(k.actual_progress) >= 1 || k.auto_judgment === "완료",
  );
  const hasProgress = rolledActual > 0;
  const syntheticMain: JudgeableRow = {
    ...main,
    actual_progress: rolledActual,
    actual_start: main.actual_start ?? (hasProgress ? main.plan_start ?? null : null),
    actual_finish: allDone ? (main.actual_finish ?? main.plan_end ?? null) : null,
    auto_judgment: allDone ? "완료" : null,
  };
  // 동종 비교: 하위 가중 누계 계획(Σwₖ·tplanₖ/Σwₖ) vs 동일 가중 실적(롤업 Actual)
  const gap = mainVariance(syntheticMain as never, kids as never[], asOfDate);
  const j = judgeFromGap(syntheticMain as never, gap, thresholds, asOfDate);
  // 하위 하나라도 미완이면 상위는 어떤 경우에도 "완료"가 될 수 없음.
  if (!allDone && j === "완료") {
    const kidJudgments = kids.map((k) => resolveRowJudgment(k, thresholds, asOfDate));
    return worstJudgment(kidJudgments) ?? "정상";
  }
  return j;
}
