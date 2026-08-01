import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WRT 화면 데이터 정본 경유 진입점.
 * 표시·집계 수치는 전부 `wrt_rows_as_of`(→ `wrt_stage_state` / `wrt_judge_v1`)를 거친다.
 * 원시 테이블 직조회 + 클라이언트 재계산 금지.
 */

export type WrtStageCell = {
  ps: string | null;
  pf: string | null;
  as: string | null;
  af: string | null;
  fv: string | null;
  na: boolean;
  st: "na" | "done" | "wip" | "delayed" | "planned" | "none";
};

export type WrtCatalogEntry = {
  stage_code: string;
  label: string;
  band: "COMMERCIAL" | "DRAFT_APPROVAL" | "SUBMISSION";
  value_type: "flag" | "single" | "range";
  actual_authority: "HDEC" | "ACONEX";
  round_no: number | null;
  sort_order: number;
};

export type WrtJudgment = "완료" | "정상" | "지연" | "미분류" | "제외";

export type WrtRow = {
  id: string;
  wrt_number: string;
  plot: string | null;
  dis: string | null;
  service: string | null;
  title: string | null;
  team: string | null;
  pic: string | null;
  eng: string | null;
  r1_response_code: string | null;
  r2_response_code: string | null;
  latest_response_code: string | null;
  latest_status_raw: string | null;
  is_final_approved: boolean;
  is_excluded: boolean;
  exclusion_reason: string | null;
  active_round: number;
  response_source: string | null;
  data_date: string | null;
  stages: Record<string, WrtStageCell>;
  na_count: number;
  done: number;
  delayed: number;
  denom: number;
  progress_pct: number | null;
  judgment: WrtJudgment;
};

export type WrtRowsAsOf = {
  as_of: string;
  catalog: WrtCatalogEntry[];
  rows: WrtRow[];
  total_count: number;
  judgment_counts: Record<string, number>;
  violations: {
    total: number;
    precedence: number;
    ghost_round: number;
    from_last_import: number;
    last_batch_id: string | null;
  };
};

export const getWrtRowsAsOf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ as_of: z.string().nullable().default(null) }).parse(v))
  .handler(async ({ data, context }): Promise<WrtRowsAsOf> => {
    const { data: res, error } = await (context.supabase as any).rpc("wrt_rows_as_of", {
      _as_of: data.as_of,
    });
    if (error) throw new Error(`WRT 조회 실패: ${error.message}`);
    if (!res || Array.isArray(res) || typeof res !== "object") {
      throw new Error("WRT 정본 응답 형식 오류 (jsonb object 아님)");
    }
    const out = res as WrtRowsAsOf;
    if (out.rows.length !== out.total_count) {
      throw new Error(`WRT 응답 잘림 의심: rows=${out.rows.length} vs total=${out.total_count}`);
    }
    return out;
  });

/**
 * Export(왕복 임포트 양식) 전용 원본 조회.
 * 왕복 무결성을 위해 as-of 마스킹을 적용하지 않은 "저장 원본"을 그대로 내보낸다.
 */
export const getWrtExportRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supa = context.supabase as any;
    const fetchAll = async (table: string, cols: string) => {
      const out: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supa.from(table).select(cols).range(from, from + 999);
        if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    };
    const items = await fetchAll(
      "wrt_items",
      "id, wrt_number, plot, dis, service, title, team, pic, eng, r1_response_code_raw, r2_response_code_raw, latest_status_raw, final_approved_raw, is_active",
    );
    const progress = await fetchAll(
      "wrt_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag",
    );
    const { data: catalog, error: cErr } = await supa
      .from("wrt_stage_catalog")
      .select("stage_code, label, band, value_type, actual_authority, round_no, sort_order")
      .order("sort_order");
    if (cErr) throw new Error(cErr.message);
    return {
      catalog: (catalog ?? []) as WrtCatalogEntry[],
      items: items.filter((i) => i.is_active),
      progress,
    };
  });