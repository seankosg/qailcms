import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL 화면 데이터 정본 경유 진입점.
 * 표시·집계 수치는 전부 `spl_rows_as_of`(→ `spl_eval_as_of` → `spl_stage_state` / `spl_active_round`)를 거친다.
 * 원시 테이블 직조회 + 클라이언트 재계산 금지.
 * 판정·대표지연은 읽기 시 서버 재계산 결과이며, 저장 판정 컬럼은 존재하지 않는다.
 */

export type SplStageCell = {
  ps: string | null;
  pf: string | null;
  as: string | null;
  af: string | null;
  fv: string | null;
  na: boolean;
  st: "na" | "done" | "wip" | "delayed" | "planned" | "none";
};

export type SplCatalogEntry = {
  stage_code: string;
  /** Header code shown in the single-row table header (catalog-owned, e.g. D-SB) */
  short_code: string;
  label: string;
  band: "REQUIRED_DOC" | "DOCUMENTATION" | "PO";
  value_type: "flag" | "single" | "range";
  actual_authority: "HDEC" | "ACONEX";
  round_no?: number | null;
  sort_order: number;
  /** 순차 사슬·판정 모집단에서 제외되는 단계(SPL REQUIRED_DOC) */
  chain_excluded?: boolean;
};

export type SplStageRef = {
  stage_code: string;
  /** 카탈로그 short_code (예: D-SB, P-PO) — 클라이언트 보강 필드 */
  short_code?: string;
  label: string;
  band: string;
  round_no?: number | null;
  state?: string;
  days?: number;
  authority?: string;
};

export type SplRow = {
  id: string;
  spl_number: string;
  plot: string | null;
  dis: string | null;
  service: string | null;
  title: string | null;
  team: string | null;
  pic: string | null;
  eng: string | null;
  pic_po: string | null;
  eng_po: string | null;
  supplier: string | null;
  latest_status: string | null;
  approval_status_raw: string | null;
  revision: string | null;
  data_date: string | null;
  active_round: number;
  is_excluded: boolean;
  exclusion_reason: string | null;
  stages: Record<string, SplStageCell>;
  na_count: number;
  done: number;
  delayed: number;
  denom: number;
  /** Required Doc 충족률 (판정 모집단 비포함, 병렬 지표) */
  req_doc_done: number;
  req_doc_total: number;
  active_band: string | null;
  /** 활성 밴드 상태 — 'empty'(미착수) | 'active'(진행). 전 밴드 완료 시 null */
  active_band_state: "empty" | "active" | null;
  /** 밴드별 3값 상태 맵 */
  band_states: Record<string, "empty" | "active" | "complete">;
  /** actual_authority='HDEC' 단계 실적 보유 수 (0 = HDEC 실적 미확보) */
  hdec_actual_count: number;
  /** 계획일(plan_start/plan_finish) 보유 여부 */
  has_plan: boolean;
  completed_stage: SplStageRef | null;
  current_stage: SplStageRef | null;
  /** 활성 밴드 내 HDEC 귀책 최선행 지연 1개 */
  primary_delay: SplStageRef | null;
  /** 후행 밴드 지연 — 인지용, KPI 지연 카드 미합산 */
  delay_bucket: SplStageRef[];
  progress_pct: number | null;
  judgment: "제외" | "완료" | "정상" | "지연" | "미분류" | "미착수";
  /** 관계 정본 파생 캐시 — 과거 as-of 조회에서는 null(공란) */
  ocs_total: number | null;
  ocs_pending: number | null;
  ocs_complied: number | null;
  ocs_check: number | null;
  rsp_total: number | null;
  document_total: number | null;
};

export type SplRowsAsOf = {
  as_of: string;
  catalog: SplCatalogEntry[];
  rows: SplRow[];
  total_count: number;
  judgment_counts: Record<string, number>;
  /** Required Doc 충족 단계 수별 문서 건수 (키 = 0..5) */
  req_doc_counts: Record<string, number>;
  band_state_counts: Record<string, Record<string, number>>;
  /** HDEC 실적 0건 아이템 수 / 그중 완료 판정 수 */
  hdec_missing_items: number;
  hdec_missing_done: number;
  /** 계획일 보유 아이템 수 — 0이면 지연 판정 미실시 */
  plan_items: number;
  violations: {
    total: number;
    precedence: number;
    /** 선행 단계 자료 자체가 미유입 — 실제 공정 역전과 분리 */
    import_incomplete: number;
    from_last_import: number;
    last_batch_id: string | null;
  };
};

export const getSplRowsAsOf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ as_of: z.string().nullable().default(null) }).parse(v))
  .handler(async ({ data, context }): Promise<SplRowsAsOf> => {
    const { data: res, error } = await (context.supabase as any).rpc("spl_rows_as_of", {
      _as_of: data.as_of,
    });
    if (error) throw new Error(`SPL 조회 실패: ${error.message}`);
    if (!res || Array.isArray(res) || typeof res !== "object") {
      throw new Error("SPL 정본 응답 형식 오류 (jsonb object 아님)");
    }
    const out = res as SplRowsAsOf;
    if (out.rows.length !== out.total_count) {
      throw new Error(`SPL 응답 잘림 의심: rows=${out.rows.length} vs total=${out.total_count}`);
    }
    // 카탈로그 short_code 를 각 행의 stage_ref 에 보강 (primary_delay, completed_stage, current_stage, delay_bucket)
    const scMap = new Map(out.catalog.map((c) => [c.stage_code, c.short_code]));
    const enrich = (ref: SplStageRef | null): SplStageRef | null =>
      ref && scMap.has(ref.stage_code) ? { ...ref, short_code: scMap.get(ref.stage_code)! } : ref;
    for (const r of out.rows) {
      r.primary_delay = enrich(r.primary_delay);
      r.completed_stage = enrich(r.completed_stage);
      r.current_stage = enrich(r.current_stage);
      r.delay_bucket = r.delay_bucket.map((d) => enrich(d) ?? d);
    }
    return out;
  });

/**
 * 역산(back-fill)으로 채운 추정 실적 칸 목록.
 * map: item_id -> stage_code -> { as?: true, af?: true }
 */
export type SplEstimatedCells = {
  items: number;
  map: Record<string, Record<string, { as?: boolean; af?: boolean }>>;
};

export const getSplEstimatedCells = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SplEstimatedCells> => {
    const { data, error } = await (context.supabase as any).rpc("spl_estimated_cells");
    if (error) throw new Error(`SPL 추정 실적 조회 실패: ${error.message}`);
    return (data ?? { items: 0, map: {} }) as SplEstimatedCells;
  });

/**
 * Export(왕복 임포트 양식) 전용 원본 조회.
 * 왕복 무결성을 위해 as-of 마스킹을 적용하지 않은 "저장 원본"을 그대로 내보낸다.
 * (마스킹본을 내보내면 재임포트 시 미래 실적이 삭제 의도로 해석된다.)
 * ★ 역산 추정 실적(actual_estimated)은 내보내지 않는다 — 재임포트 시 실측으로 둔갑하는 것을 막는다.
 */
export const getSplExportRows = createServerFn({ method: "POST" })
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
      "spl_items",
      "id, spl_number, plot, dis, service, title, team, pic, eng, pic_po, eng_po, supplier, approval_status_raw, is_active",
    );
    const progress = await fetchAll(
      "spl_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag, actual_estimated",
    );
    const { data: catalog, error: cErr } = await supa
      .from("spl_stage_catalog")
      .select("stage_code, short_code, label, band, value_type, actual_authority, sort_order")
      .order("sort_order");
    if (cErr) throw new Error(cErr.message);
    return {
      catalog: (catalog ?? []) as SplCatalogEntry[],
      items: items.filter((i) => i.is_active),
      progress: progress.map((p) =>
        p.actual_estimated ? { ...p, actual_start: null, actual_finish: null } : p,
      ),
    };
  });