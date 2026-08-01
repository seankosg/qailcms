import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SPL 화면 데이터 정본 경유 진입점.
 * 표시·집계 수치는 전부 `spl_rows_as_of`(→ `spl_stage_state` / `spl_judge_v1`)를 거친다.
 * 원시 테이블 직조회 + 클라이언트 재계산 금지.
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
  label: string;
  band: "REQUIRED_DOC" | "DOCUMENTATION" | "PO";
  value_type: "flag" | "single" | "range";
  actual_authority: "HDEC" | "ACONEX";
  sort_order: number;
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
  stages: Record<string, SplStageCell>;
  na_count: number;
  done: number;
  delayed: number;
  denom: number;
  progress_pct: number | null;
  judgment: "완료" | "정상" | "지연" | "미분류";
};

export type SplRowsAsOf = {
  as_of: string;
  catalog: SplCatalogEntry[];
  rows: SplRow[];
  total_count: number;
  judgment_counts: Record<string, number>;
  violations: { total: number; from_last_import: number; last_batch_id: string | null };
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
    return out;
  });

/**
 * Export(왕복 임포트 양식) 전용 원본 조회.
 * 왕복 무결성을 위해 as-of 마스킹을 적용하지 않은 "저장 원본"을 그대로 내보낸다.
 * (마스킹본을 내보내면 재임포트 시 미래 실적이 삭제 의도로 해석된다.)
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
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag",
    );
    const { data: catalog, error: cErr } = await supa
      .from("spl_stage_catalog")
      .select("stage_code, label, band, value_type, actual_authority, sort_order")
      .order("sort_order");
    if (cErr) throw new Error(cErr.message);
    return {
      catalog: (catalog ?? []) as SplCatalogEntry[],
      items: items.filter((i) => i.is_active),
      progress,
    };
  });