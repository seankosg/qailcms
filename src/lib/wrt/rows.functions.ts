import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WRT 화면 데이터 정본 경유 진입점.
 * 표시·집계 수치는 전부 `wrt_rows_as_of`(→ `wrt_eval_as_of` → `wrt_stage_state` / `wrt_judge_v2`)를 거친다.
 * 원시 테이블 직조회 + 클라이언트 재계산 금지.
 * 판정·대표지연은 읽기 시 서버 재계산 결과이며, 저장 판정 컬럼은 존재하지 않는다.
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
  chain_excluded?: boolean;
};

export type WrtStageRef = {
  stage_code: string;
  label: string;
  band: string;
  round_no?: number | null;
  state?: string;
  days?: number;
  authority?: string;
};

export type WrtJudgment = "완료" | "정상" | "지연" | "미분류" | "제외" | "미착수";

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
  active_band: string | null;
  /** 활성 밴드 상태 — 'empty'(미착수) | 'active'(진행). 전 밴드 완료 시 null */
  active_band_state: "empty" | "active" | null;
  band_states: Record<string, "empty" | "active" | "complete">;
  /** actual_authority='HDEC' 단계 실적 보유 수 (0 = HDEC 실적 미확보) */
  hdec_actual_count: number;
  /** HDEC 단계 계획일 보유 여부 */
  has_plan: boolean;
  completed_stage: WrtStageRef | null;
  current_stage: WrtStageRef | null;
  /** 활성 밴드 내 HDEC 귀책 최선행 지연 1개 (Aconex 회신 단계 제외) */
  primary_delay: WrtStageRef | null;
  /** 후행 밴드 지연 — 인지용, KPI 지연 카드 미합산 */
  delay_bucket: WrtStageRef[];
  /** Aconex 회신 대기 지연 — HDEC 귀책 아님, 별도 표기 전용 */
  response_wait: WrtStageRef[];
  progress_pct: number | null;
  judgment: WrtJudgment;
};

export type WrtRowsAsOf = {
  as_of: string;
  catalog: WrtCatalogEntry[];
  rows: WrtRow[];
  total_count: number;
  judgment_counts: Record<string, number>;
  band_state_counts: Record<string, Record<string, number>>;
  hdec_missing_items: number;
  hdec_missing_done: number;
  plan_items: number;
  violations: {
    total: number;
    precedence: number;
    /** 선행 단계 자료 자체가 미유입 — 실제 공정 역전과 분리, pending_hdec 과 동일 취급 */
    import_incomplete: number;
    ghost_round: number;
    /** 회신일이 제출 실적일보다 앞선 진짜 위반 */
    response_before_submission: number;
    /**
     * pending_hdec — 위반 아님.
     * 해당 문서의 HDEC 제출 실적이 전 라운드에 걸쳐 전무한 상태에서 Aconex 회신(회신일/회신코드)만 존재하는 건.
     * HDEC 계획·실적 임포트가 진행되면 감소해야 하는 감시 지표이며 `total`(위반 집계)에서 제외된다.
     */
    pending_hdec: number;
    pending_hdec_r1: number;
    pending_hdec_r2: number;
    /** pending_hdec 의 문서(아이템) distinct 수 — 위 3개는 라운드 기준 쌍 수 */
    pending_hdec_items: number;
    /** 위반 검사 모집단 — HDEC 제출 실적을 1건 이상 보유한 활성 문서 수 */
    inspected_items: number;
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