import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TOC(Handover) 화면 데이터 정본 경유 진입점.
 * 표시·집계 수치는 전부 `toc_rows_as_of`(→ `toc_eval_as_of` → `spl_stage_state`/`toc_code_flag`)를 거친다.
 * 원시 테이블 직조회 + 클라이언트 재계산 금지. 교육 밴드는 조회 시 세션에서 합성된다.
 */

export type TocStageState = "na" | "done" | "wip" | "delayed" | "planned" | "none";

export type TocStageCell = {
  ps: string | null;
  pf: string | null;
  as: string | null;
  af: string | null;
  cv: string | null;
  na: boolean;
  st: TocStageState;
};

export type TocBand = "TAC" | "OMM" | "TRAINING" | "ASSET_TAG" | "ABD" | "SERVICE_REPORT" | "TOC";
export type TocBandState = "na" | "complete" | "active" | "planned" | "blocked" | "empty";

export type TocCatalogEntry = {
  stage_code: string;
  short_code: string;
  label: string;
  band: TocBand;
  value_type: "code" | "single" | "range";
  actual_authority: "HDEC" | "IFM" | "CMS";
  done_codes: string[];
  gate_band: string | null;
  sort_order: number;
};

export type TocJudgment =
  | "Excluded"
  | "Handed Over"
  | "TOC Under Review"
  | "TOC Ready"
  | "Delayed"
  | "Blocked"
  | "In Progress"
  | "Not Started";

export type TocRow = {
  id: string;
  item_key: string;
  plot: string | null;
  team: string | null;
  team_raw: string | null;
  main_system: string | null;
  item_no: string | null;
  sub_system: string | null;
  location: string | null;
  supplier: string | null;
  pic: string | null;
  eng: string | null;
  tac_qty_total: number | null;
  tac_qty_issued: number | null;
  abd_qty_total: number | null;
  abd_qty_code_a: number | null;
  service_report_required: boolean;
  toc_ref: string | null;
  toc_status: string;
  expected_ho_date: string | null;
  ho_status_raw: string | null;
  is_excluded: boolean;
  exclusion_reason: string | null;
  data_date: string | null;
  stages: Record<string, TocStageCell>;
  band_states: Record<string, TocBandState>;
  ready_bands: number;
  ready_denom: number;
  readiness_pct: number | null;
  delayed: number;
  primary_delay: { stage_code: string; label: string; band: string; days: number } | null;
  judgment: TocJudgment;
  training_sessions: number;
};

export type TocRowsAsOf = {
  as_of: string;
  catalog: TocCatalogEntry[];
  rows: TocRow[];
  total_count: number;
  judgment_counts: Record<string, number>;
  band_state_counts: Record<string, Record<string, number>>;
  violations: Record<string, number>;
};

export const getTocRowsAsOf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ as_of: z.string().nullable().default(null) }).parse(v))
  .handler(async ({ data, context }): Promise<TocRowsAsOf> => {
    const { data: res, error } = await (context.supabase as any).rpc("toc_rows_as_of", {
      _as_of: data.as_of || null,
    });
    if (error) throw new Error(`TOC 조회 실패: ${error.message}`);
    if (!res || Array.isArray(res) || typeof res !== "object") {
      throw new Error("TOC 정본 응답 형식 오류 (jsonb object 아님)");
    }
    const out = res as TocRowsAsOf;
    if (out.rows.length !== out.total_count) {
      throw new Error(`TOC 응답 잘림 의심: rows=${out.rows.length} vs total=${out.total_count}`);
    }
    return out;
  });
