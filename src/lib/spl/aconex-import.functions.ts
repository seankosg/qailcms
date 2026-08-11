import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";

/**
 * SPL Aconex Export 임포트 — UPDATE 전용.
 *
 * - 행을 만들지 않는다. 미매칭은 리포트만 한다.
 * - 반영 대상은 두 칸뿐: `approval_status_raw`(Response Status) 와
 *   APPROVAL_DATE 의 `actual_start`(Dar Response Date).
 * - UR(For Review) 은 날짜를 쓰지 않는다. APPROVAL_DATE 는 single 이라
 *   actual 이 차는 순간 그 단계가 done 으로 뒤집히기 때문이다.
 * - plan_start 는 절대 건드리지 않는다. 빈칸이 기존 값을 지우지 않는다.
 * - 미리보기(apply:false) 와 적용(apply:true) 이 같은 patch 계산을 쓴다.
 */

const RowSchema = z.object({
  document_no: z.string().min(1),
  status_raw: z.string().nullable().optional(),
  code: z.enum(["A", "B", "C", "D", "UR"]).nullable().optional(),
  date_modified: z.string().nullable().optional(),
  excel_row: z.number().optional(),
});

export const SPL_ACONEX_FIELDS = ["approval_status_raw", "approval_date"] as const;
export type SplAconexField = (typeof SPL_ACONEX_FIELDS)[number];

const InputSchema = z.object({
  file_name: z.string(),
  sheet_name: z.string().default("Docs"),
  plot: z.enum(["C", "D"]),
  export_date: z.string(),
  ocs_excluded: z.number().default(0),
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  /** 반영할 필드 집합 (null/빈 배열 = 전체) */
  apply_fields: z.array(z.enum(SPL_ACONEX_FIELDS)).nullable().optional(),
});

export type SplAconexChange = { field: string; previous: string | null; next: string | null };

export type SplAconexDiffRow = {
  document_no: string;
  excel_row: number | null;
  status_raw: string | null;
  code: string | null;
  changes: SplAconexChange[];
};

export type SplAconexPreview = {
  aconex_documents: number;
  matched: number;
  aconex_only: number;
  aconex_only_list: string[];
  out_of_scope: number;
  out_of_scope_list: string[];
  role: string | null;
  ocs_excluded: number;
  cells_changed: number;
  filled_blanks: number;
  overwritten: number;
  blank_overwrites: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  status_counts: Array<{ status: string; count: number }>;
  /** 매핑 없는 상태값 — 아무 필드도 쓰지 않음 */
  unmapped_count: number;
  unmapped_list: Array<{ status: string; count: number }>;
  /** For Review — 상태만 쓰고 날짜는 쓰지 않은 건수 */
  review_no_date: number;
  diff_rows: SplAconexDiffRow[];
};

export type SplAconexResult = SplAconexPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
  rejected: Array<{ key: string; reason_code: string; message: string }>;
};

type ExistingItem = {
  id: string;
  spl_number: string;
  team: string | null;
  pic: string | null;
  eng: string | null;
  pic_po: string | null;
  eng_po: string | null;
  approval_status_raw: string | null;
  approval_actual: string | null;
};

async function assertEditor(ctx: any): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "SPL", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: SPL 임포트 권한이 없습니다");
  }
  return g.role;
}

async function fetchAll(supa: any, table: string, cols: string) {
  const out: any[] = [];
  const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    const { data, error } = await supa.from(table).select(cols).range(from, from + SIZE - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < SIZE) break;
  }
  return out;
}

type Patch = {
  spl_number: string;
  item: Record<string, string>;
  stages: Array<{ stage_code: string; actual_start: string }>;
};

function computePatch(
  row: z.infer<typeof RowSchema>,
  ex: ExistingItem,
  allowed: Set<string>,
): { patch: Patch; changes: SplAconexChange[]; reviewNoDate: boolean } {
  const patch: Patch = { spl_number: ex.spl_number, item: {}, stages: [] };
  const changes: SplAconexChange[] = [];
  const code = row.code ?? null;
  if (!code) return { patch, changes, reviewNoDate: false };

  if (allowed.has("approval_status_raw") && code !== (ex.approval_status_raw ?? null)) {
    patch.item.approval_status_raw = code;
    changes.push({ field: "approval_status_raw", previous: ex.approval_status_raw, next: code });
  }

  // UR 은 회신 대기 — 실적일을 쓰지 않는다.
  if (code === "UR") return { patch, changes, reviewNoDate: true };

  const iso = row.date_modified && row.date_modified.trim() !== "" ? row.date_modified.trim() : null;
  if (allowed.has("approval_date") && iso && iso !== ex.approval_actual) {
    patch.stages.push({ stage_code: "APPROVAL_DATE", actual_start: iso });
    changes.push({ field: "APPROVAL_DATE.actual_start", previous: ex.approval_actual, next: iso });
  }
  return { patch, changes, reviewNoDate: false };
}

export const importSplAconexBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<SplAconexResult> => {
    const role = await assertEditor(context);
    const supa = context.supabase as any;

    const items = (await fetchAll(
      supa,
      "spl_items",
      "id, spl_number, team, pic, eng, pic_po, eng_po, approval_status_raw",
    )) as any[];
    const progress = (await fetchAll(
      supa,
      "spl_stage_progress",
      "item_id, stage_code, actual_start",
    )) as any[];
    const actualOf = new Map<string, string | null>(
      progress
        .filter((p) => p.stage_code === "APPROVAL_DATE")
        .map((p) => [String(p.item_id), (p.actual_start as string | null) ?? null]),
    );

    const existing = new Map<string, ExistingItem>();
    for (const i of items) {
      existing.set(String(i.spl_number).trim().toUpperCase(), {
        id: i.id,
        spl_number: i.spl_number,
        team: i.team,
        pic: i.pic,
        eng: i.eng,
        pic_po: i.pic_po,
        eng_po: i.eng_po,
        approval_status_raw: i.approval_status_raw ?? null,
        approval_actual: actualOf.get(String(i.id)) ?? null,
      });
    }

    const matchedRows = data.rows.filter((r) => existing.has(r.document_no));
    const aconexOnly = data.rows.filter((r) => !existing.has(r.document_no)).map((r) => r.document_no);

    // 행 단위 스코프 — 서버 rcl_import_filter 가 정본.
    const allowedKeys = new Set<string>();
    const CHUNK = 1000;
    for (let i = 0; i < matchedRows.length; i += CHUNK) {
      const slice = matchedRows.slice(i, i + CHUNK);
      const payload = slice.map((r) => {
        const ex = existing.get(r.document_no)!;
        return {
          spl_number: ex.spl_number,
          team: ex.team,
          pic: ex.pic,
          eng: ex.eng,
          pic_po: ex.pic_po,
          eng_po: ex.eng_po,
        };
      });
      const { data: res, error } = await supa.rpc("rcl_import_filter", {
        _module: "SPL",
        _match_cols: ["spl_number"],
        _rows: payload,
      });
      if (error) throw new Error(`임포트 권한 판정 실패(SPL Aconex): ${error.message}`);
      for (const k of ((res as any)?.allowed ?? []) as Array<Record<string, string>>) {
        allowedKeys.add(String(k.spl_number ?? "").trim().toUpperCase());
      }
    }
    const inScope = matchedRows.filter((r) => allowedKeys.has(r.document_no));
    const outOfScope = matchedRows.filter((r) => !allowedKeys.has(r.document_no)).map((r) => r.document_no);

    const allowed = new Set<string>(
      data.apply_fields && data.apply_fields.length > 0 ? data.apply_fields : (SPL_ACONEX_FIELDS as readonly string[]),
    );

    const fieldDiff = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    const unmapped = new Map<string, number>();
    const patches: Patch[] = [];
    const diffRows: SplAconexDiffRow[] = [];
    let filled = 0;
    let overwritten = 0;
    let blankOverwrites = 0;
    let reviewNoDate = 0;

    for (const r of inScope) {
      const ex = existing.get(r.document_no)!;
      if (r.status_raw) statusCounts.set(r.status_raw, (statusCounts.get(r.status_raw) ?? 0) + 1);
      if (!r.code && r.status_raw) unmapped.set(r.status_raw, (unmapped.get(r.status_raw) ?? 0) + 1);
      const { patch, changes, reviewNoDate: rn } = computePatch(r, ex, allowed);
      if (rn) reviewNoDate += 1;
      for (const c of changes) {
        fieldDiff.set(c.field, (fieldDiff.get(c.field) ?? 0) + 1);
        if (c.previous == null) filled += 1;
        else overwritten += 1;
        if (c.previous != null && c.next == null) blankOverwrites += 1;
      }
      if (changes.length > 0) {
        patches.push(patch);
        diffRows.push({
          document_no: r.document_no,
          excel_row: r.excel_row ?? null,
          status_raw: r.status_raw ?? null,
          code: r.code ?? null,
          changes,
        });
      }
    }

    const unmappedList = Array.from(unmapped.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const preview: SplAconexPreview = {
      aconex_documents: data.rows.length,
      matched: matchedRows.length,
      aconex_only: aconexOnly.length,
      aconex_only_list: aconexOnly.slice(0, 500),
      out_of_scope: outOfScope.length,
      out_of_scope_list: outOfScope.slice(0, 200),
      role,
      ocs_excluded: data.ocs_excluded,
      cells_changed: filled + overwritten,
      filled_blanks: filled,
      overwritten,
      blank_overwrites: blankOverwrites,
      field_diff_counts: Array.from(fieldDiff.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      status_counts: Array.from(statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      unmapped_count: unmappedList.reduce((a, b) => a + b.count, 0),
      unmapped_list: unmappedList,
      review_no_date: reviewNoDate,
      diff_rows: diffRows.slice(0, 300),
    };

    if (!data.apply) {
      return { ...preview, applied: false, batch_id: null, items_updated: 0, stages_upserted: 0, rejected: [] };
    }

    // ★ 서버 최종 관문: SECURITY DEFINER apply 전에 행 단위 스코프를 재판정한다.
    await assertImportScope(
      supa,
      "SPL",
      "spl_number",
      ["team", "pic", "eng", "pic_po", "eng_po"],
      patches.map((p) => {
        const ex = existing.get(p.spl_number.trim().toUpperCase())!;
        return {
          spl_number: p.spl_number,
          item: {
            team: ex?.team ?? null,
            pic: ex?.pic ?? null,
            eng: ex?.eng ?? null,
            pic_po: ex?.pic_po ?? null,
            eng_po: ex?.eng_po ?? null,
          },
        };
      }),
      (r) => r.spl_number,
      null,
    );

    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("spl_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: [data.sheet_name],
        total_rows: data.rows.length,
        matched: matchedRows.length,
        unmatched: aconexOnly.length,
        ocs_excluded: data.ocs_excluded,
        cleared_values: 0,
        status: "success",
        started_at: nowIso,
        imported_by: context.userId,
      })
      .select("id")
      .single();
    if (logErr) throw new Error(logErr.message);
    const batchId = logRow.id as string;

    let itemsUpdated = 0;
    let stagesUpserted = 0;
    const rejected: SplAconexResult["rejected"] = [];
    try {
      const APPLY_CHUNK = 200;
      for (let i = 0; i < patches.length; i += APPLY_CHUNK) {
        const { data: res, error } = await supa.rpc("spl_aconex_apply", {
          _batch_id: batchId,
          _patches: patches.slice(i, i + APPLY_CHUNK),
        });
        if (error) throw new Error(error.message);
        itemsUpdated += Number(res?.items_updated ?? 0);
        stagesUpserted += Number(res?.stages_upserted ?? 0);
        for (const r of (res?.rejected ?? []) as any[]) {
          rejected.push({
            key: String(r?.key ?? ""),
            reason_code: String(r?.reason_code ?? ""),
            message: String(r?.message ?? ""),
          });
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await supa
        .from("spl_import_logs")
        .update({ status: "failed", note: `SPL Aconex import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    const rowLogs = diffRows.map((d) => ({
      batch_id: batchId,
      sheet_name: data.sheet_name,
      excel_row: d.excel_row ?? 0,
      spl_number: d.document_no,
      outcome: "updated",
      code: "aconex_sync",
      detail: `status=${d.status_raw ?? "-"} code=${d.code ?? "-"} ${d.changes.length} field(s)`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("spl_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[spl aconex row logs]", error.message);
    }

    await supa
      .from("spl_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        finished_at: new Date().toISOString(),
        note:
          `aconex plot=${data.plot} export_date=${data.export_date} docs=${data.rows.length} ` +
          `matched=${matchedRows.length} aconex_only=${aconexOnly.length} out_of_scope=${outOfScope.length} ` +
          `ocs_excluded=${data.ocs_excluded} cells=${preview.cells_changed} review_no_date=${reviewNoDate} ` +
          `unmapped=${preview.unmapped_count} rejected=${rejected.length}`,
      })
      .eq("id", batchId);

    return {
      ...preview,
      applied: true,
      batch_id: batchId,
      items_updated: itemsUpdated,
      stages_upserted: stagesUpserted,
      rejected,
    };
  });
