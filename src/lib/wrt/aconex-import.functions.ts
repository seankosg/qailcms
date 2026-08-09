import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WRT Aconex Export 임포트 — UPDATE 전용.
 *
 * - 행을 만들지 않는다. 미매칭은 리포트만 한다.
 * - 미리보기와 적용이 같은 patch 계산(`computePatch`)을 쓴다.
 * - 갱신 대상: RESPONSE_DATE_R{n} 실적 · r{n}_response_code · latest_response_code ·
 *   latest_status_raw · is_final_approved. 제출일 · 초안일은 절대 쓰지 않는다.
 * - 회신은 제출 실적이 찍힌 가장 높은 라운드에만 귀속한다(R2 실적 있으면 R2, 없으면 R1).
 * - 값이 있던 칸을 빈칸으로 덮지 않는다(모든 쓰기는 값이 있을 때만).
 */

const RowSchema = z.object({
  document_no: z.string().min(1),
  title: z.string().nullable().optional(),
  revision: z.string().nullable().optional(),
  status_raw: z.string().nullable().optional(),
  code: z.enum(["A", "B", "C", "D", "UR", "CX", "TM"]).nullable().optional(),
  semantic: z
    .enum([
      "APPROVED_A",
      "APPROVED_B",
      "REJECTED_C",
      "REJECTED_D",
      "UNDER_REVIEW",
      "CANCELLED",
      "TERMINATED",
      "UNMAPPED",
    ])
    .default("UNMAPPED"),
  date_modified: z.string().nullable().optional(),
  excel_row: z.number().optional(),
});

export const WRT_ACONEX_FIELDS = [
  "r1_response_code",
  "r2_response_code",
  "r1_response_date",
  "r2_response_date",
  "latest_status",
  "final_approved",
  "exclusion",
] as const;
export type WrtAconexField = (typeof WRT_ACONEX_FIELDS)[number];

const InputSchema = z.object({
  file_name: z.string(),
  sheet_name: z.string().default("Docs"),
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  /** 반영할 필드 집합 (null/빈 배열 = 전체) */
  apply_fields: z.array(z.enum(WRT_ACONEX_FIELDS)).nullable().optional(),
});

export type WrtAconexChange = { field: string; previous: string | null; next: string | null };

export type WrtAconexDiffRow = {
  document_no: string;
  excel_row: number | null;
  round: 1 | 2;
  semantic: string;
  changes: WrtAconexChange[];
};

export type WrtAconexPreview = {
  /** Aconex 파일의 고유 문서 수 */
  aconex_documents: number;
  /** WRT 목록과 매칭된 문서 수 */
  matched: number;
  /** WRT 목록(Status)에만 있는 문서 수 */
  wrt_only: number;
  /** Aconex 에만 있는 문서 수 */
  aconex_only: number;
  aconex_only_list: string[];
  wrt_only_list: string[];
  /** 권한 범위 밖이라 제외된 문서 */
  out_of_scope: number;
  out_of_scope_list: string[];
  role: string | null;
  /** 실제로 바뀌는 칸 수 */
  cells_changed: number;
  filled_blanks: number;
  overwritten: number;
  /** 값 → 빈칸 덮어쓰기 (설계상 0 이어야 함) */
  blank_overwrites: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  status_counts: Array<{ status: string; count: number }>;
  /** 매핑 없는 코드(For Information / For Action / D) — 아무 필드도 쓰지 않음 */
  unmapped_count: number;
  unmapped_list: string[];
  d_code_count: number;
  /** 심사중(For Review)이라 실적을 기록하지 않은 건수 */
  review_skipped: number;
  /** 라운드 2 귀속인데 Aconex 코드가 현재 R1 코드와 같아 아무것도 쓰지 않은 건수 */
  same_as_r1: number;
  same_as_r1_list: string[];
  /** 제출 실적 없이 R1 회신이 붙는 문서 */
  no_submission_r1: number;
  no_submission_r1_list: string[];
  round_counts: { r1: number; r2: number };
  cancelled: number;
  terminated: number;
  diff_rows: WrtAconexDiffRow[];
};

export type WrtAconexResult = WrtAconexPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
  rejected: Array<{ key: string; reason_code: string; message: string }>;
  /** 서버 change_log 기준 non-null → null 덮어쓰기 건수 */
  null_overwrites: Record<string, number>;
};

type ExistingItem = {
  id: string;
  wrt_number: string;
  team: string | null;
  pic: string | null;
  eng: string | null;
  r1_response_code: string | null;
  r1_response_code_raw: string | null;
  r2_response_code: string | null;
  r2_response_code_raw: string | null;
  latest_response_code: string | null;
  latest_status_raw: string | null;
  is_final_approved: boolean | null;
  final_approved_raw: string | null;
  is_active: boolean | null;
  is_excluded: boolean | null;
  exclusion_reason: string | null;
  sb1: string | null;
  sb2: string | null;
  dr2: string | null;
  rs1: string | null;
  rs2: string | null;
};

async function assertEditor(ctx: any) {
  // RCL 정본 경로 — 역할 이름 하드코딩 금지.
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "WRT", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: WRT 임포트 권한이 없습니다");
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

function str(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

type Patch = {
  wrt_number: string;
  item: Record<string, string | boolean | null>;
  stages: Array<{ stage_code: string; actual_start: string }>;
};

function computePatch(
  row: z.infer<typeof RowSchema>,
  ex: ExistingItem,
  allowed: Set<string>,
): {
  round: 1 | 2;
  patch: Patch;
  changes: WrtAconexChange[];
  flags: { review_skipped: boolean; no_submission_r1: boolean; unmapped: boolean; same_as_r1: boolean };
} {
  // 라운드 귀속 — DB 정본(wrt_active_round)과 동일 기준.
  const r1Code = String(ex.r1_response_code ?? "").trim().toUpperCase();
  const round: 1 | 2 =
    ex.r2_response_code || r1Code === "B" || r1Code === "C" || ex.dr2 || ex.sb2 || ex.rs2 ? 2 : 1;
  const patch: Patch = { wrt_number: ex.wrt_number, item: {}, stages: [] };
  const changes: WrtAconexChange[] = [];
  const flags = { review_skipped: false, no_submission_r1: false, unmapped: false, same_as_r1: false };
  const iso = str(row.date_modified);
  const code = row.code ?? null;

  const setItem = (field: string, col: string, next: string | boolean, prev: string | null) => {
    if (!allowed.has(field)) return;
    const nextStr = typeof next === "boolean" ? (next ? "true" : "false") : next;
    if (nextStr === (prev ?? null)) return;
    patch.item[col] = next;
    changes.push({ field, previous: prev, next: nextStr });
  };

  /** 코드 컬럼과 _raw 컬럼은 한 건으로 센다. 각 컬럼은 자기 이전값과 비교. */
  const setPair = (
    field: string,
    col: string,
    rawCol: string,
    next: string,
    prev: string | null,
    prevRaw: string | null,
  ) => {
    if (!allowed.has(field)) return;
    let changed = false;
    if (next !== (prev ?? null)) {
      patch.item[col] = next;
      changed = true;
    }
    if (next !== (prevRaw ?? null)) {
      patch.item[rawCol] = next;
      changed = true;
    }
    if (changed) changes.push({ field, previous: prev, next });
  };

  switch (row.semantic) {
    case "CANCELLED": {
      if (allowed.has("exclusion") && (ex.is_active !== false || ex.exclusion_reason !== "aconex_cancelled")) {
        patch.item.is_active = false;
        patch.item.is_excluded = true;
        patch.item.exclusion_reason = "aconex_cancelled";
        changes.push({ field: "exclusion", previous: ex.exclusion_reason, next: "aconex_cancelled" });
      }
      return { round, patch, changes, flags };
    }
    case "TERMINATED": {
      // 실적은 지우지 않고 플래그만.
      if (allowed.has("exclusion") && ex.exclusion_reason !== "aconex_terminated") {
        patch.item.is_excluded = true;
        patch.item.exclusion_reason = "aconex_terminated";
        changes.push({ field: "exclusion", previous: ex.exclusion_reason, next: "aconex_terminated" });
      }
      return { round, patch, changes, flags };
    }
    case "UNDER_REVIEW": {
      // 실적 필드 기록 금지. 이미 확정된 A/B/C/D 는 보호.
      flags.review_skipped = true;
      const cur = String(ex.latest_response_code ?? "").toUpperCase();
      if (!["A", "B", "C", "D"].includes(cur)) {
        setPair(
          "latest_status",
          "latest_response_code",
          "latest_status_raw",
          "UR",
          ex.latest_response_code,
          ex.latest_status_raw,
        );
      }
      return { round, patch, changes, flags };
    }
    case "REJECTED_D":
    case "UNMAPPED": {
      // 매핑 없는 코드 — 어떤 필드도 쓰지 않는다. 건수만 보고.
      flags.unmapped = true;
      return { round, patch, changes, flags };
    }
    default:
      break;
  }

  if (!code) {
    flags.unmapped = true;
    return { round, patch, changes, flags };
  }

  // 라운드 2 귀속인데, 승격 이유가 R1 코드 B/C 뿐이고 R2 실적이 없는 경우에만
  // 같은 회신을 다시 본 것으로 본다. R2 실적이 있으면 진짜 R2 회신이다.
  if (
    round === 2 &&
    !ex.r2_response_code &&
    (r1Code === "B" || r1Code === "C") &&
    !ex.dr2 && !ex.sb2 && !ex.rs2 &&
    code === r1Code
  ) {
    flags.same_as_r1 = true;
    return { round, patch, changes, flags };
  }

  // 제출 실적 없이 R1 회신이 붙는 경우 — 쓰되 목록으로 남긴다.
  if (round === 1 && !ex.sb1) flags.no_submission_r1 = true;

  const codeField = round === 1 ? "r1_response_code" : "r2_response_code";
  const prevCode = round === 1 ? ex.r1_response_code : ex.r2_response_code;
  const prevCodeRaw = round === 1 ? ex.r1_response_code_raw : ex.r2_response_code_raw;
  setPair(codeField, codeField, `${codeField}_raw`, code, prevCode, prevCodeRaw);

  const dateField = round === 1 ? "r1_response_date" : "r2_response_date";
  const stageCode = round === 1 ? "RESPONSE_DATE_R1" : "RESPONSE_DATE_R2";
  const prevDate = round === 1 ? ex.rs1 : ex.rs2;
  if (allowed.has(dateField) && iso && iso !== prevDate) {
    patch.stages.push({ stage_code: stageCode, actual_start: iso });
    changes.push({ field: dateField, previous: prevDate, next: iso });
  }

  setPair(
    "latest_status",
    "latest_response_code",
    "latest_status_raw",
    code,
    ex.latest_response_code,
    ex.latest_status_raw,
  );

  if (code === "A") {
    if (allowed.has("final_approved") && ex.is_final_approved !== true) {
      patch.item.is_final_approved = true;
      patch.item.final_approved_raw = "A";
      changes.push({ field: "final_approved", previous: ex.is_final_approved ? "A" : null, next: "A" });
    }
  }

  return { round, patch, changes, flags };
}

export const importWrtAconexBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<WrtAconexResult> => {
    const role = await assertEditor(context);
    const supa = context.supabase as any;

    const items = (await fetchAll(
      supa,
      "wrt_items",
      "id, wrt_number, team, pic, eng, r1_response_code, r1_response_code_raw, r2_response_code, r2_response_code_raw, latest_response_code, latest_status_raw, is_final_approved, final_approved_raw, is_active, is_excluded, exclusion_reason",
    )) as any[];
    const progress = (await fetchAll(
      supa,
      "wrt_stage_progress",
      "item_id, stage_code, actual_start, actual_finish",
    )) as any[];
    const stageOf = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const existing = new Map<string, ExistingItem>();
    for (const i of items) {
      existing.set(i.wrt_number, {
        ...i,
        sb1: stageOf.get(`${i.id}|SUBMISSION_R1`)?.actual_finish ?? stageOf.get(`${i.id}|SUBMISSION_R1`)?.actual_start ?? null,
        sb2: stageOf.get(`${i.id}|SUBMISSION_R2`)?.actual_finish ?? stageOf.get(`${i.id}|SUBMISSION_R2`)?.actual_start ?? null,
        dr2: stageOf.get(`${i.id}|DRAFT_DOC_R2`)?.actual_finish ?? stageOf.get(`${i.id}|DRAFT_DOC_R2`)?.actual_start ?? null,
        rs1: stageOf.get(`${i.id}|RESPONSE_DATE_R1`)?.actual_start ?? null,
        rs2: stageOf.get(`${i.id}|RESPONSE_DATE_R2`)?.actual_start ?? null,
      });
    }

    const seen = new Set(data.rows.map((r) => r.document_no));
    const matchedRows = data.rows.filter((r) => existing.has(r.document_no));
    const aconexOnly = data.rows.filter((r) => !existing.has(r.document_no)).map((r) => r.document_no);
    const wrtOnly = items.map((i) => i.wrt_number as string).filter((n) => !seen.has(n));

    // 권한 스코프 — 행 단위 판정은 서버 rcl_import_filter 가 정본.
    const allowedKeys = new Set<string>();
    const CHUNK = 1000;
    for (let i = 0; i < matchedRows.length; i += CHUNK) {
      const slice = matchedRows.slice(i, i + CHUNK);
      const payload = slice.map((r) => {
        const ex = existing.get(r.document_no)!;
        return { wrt_number: r.document_no, team: ex.team, pic: ex.pic, eng: ex.eng };
      });
      const { data: res, error } = await supa.rpc("rcl_import_filter", {
        _module: "WRT",
        _match_cols: ["wrt_number"],
        _rows: payload,
      });
      if (error) throw new Error(`임포트 권한 판정 실패(WRT Aconex): ${error.message}`);
      for (const k of ((res as any)?.allowed ?? []) as Array<Record<string, string>>) {
        allowedKeys.add(String(k.wrt_number ?? ""));
      }
    }
    const inScope = matchedRows.filter((r) => allowedKeys.has(r.document_no));
    const outOfScope = matchedRows.filter((r) => !allowedKeys.has(r.document_no)).map((r) => r.document_no);

    const allowed = new Set<string>(
      data.apply_fields && data.apply_fields.length > 0 ? data.apply_fields : (WRT_ACONEX_FIELDS as readonly string[]),
    );

    const fieldDiff = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    const patches: Patch[] = [];
    const diffRows: WrtAconexDiffRow[] = [];
    const noSubmissionR1: string[] = [];
    const unmappedList: string[] = [];
    const sameAsR1List: string[] = [];
    let filled = 0;
    let overwritten = 0;
    let blankOverwrites = 0;
    let reviewSkipped = 0;
    let dCode = 0;
    let cancelled = 0;
    let terminated = 0;
    const roundCounts = { r1: 0, r2: 0 };

    for (const r of inScope) {
      const ex = existing.get(r.document_no)!;
      if (r.status_raw) statusCounts.set(r.status_raw, (statusCounts.get(r.status_raw) ?? 0) + 1);
      if (r.semantic === "CANCELLED") cancelled += 1;
      if (r.semantic === "TERMINATED") terminated += 1;
      if (r.code === "D") dCode += 1;
      const { round, patch, changes, flags } = computePatch(r, ex, allowed);
      if (round === 1) roundCounts.r1 += 1;
      else roundCounts.r2 += 1;
      if (flags.review_skipped) reviewSkipped += 1;
      if (flags.no_submission_r1) noSubmissionR1.push(r.document_no);
      if (flags.unmapped) unmappedList.push(r.document_no);
      if (flags.same_as_r1) sameAsR1List.push(r.document_no);
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
          round,
          semantic: r.semantic,
          changes,
        });
      }
    }

    const preview: WrtAconexPreview = {
      aconex_documents: data.rows.length,
      matched: matchedRows.length,
      wrt_only: wrtOnly.length,
      aconex_only: aconexOnly.length,
      aconex_only_list: aconexOnly.slice(0, 500),
      wrt_only_list: wrtOnly.slice(0, 500),
      out_of_scope: outOfScope.length,
      out_of_scope_list: outOfScope.slice(0, 200),
      role,
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
      unmapped_count: unmappedList.length,
      unmapped_list: unmappedList.slice(0, 200),
      d_code_count: dCode,
      review_skipped: reviewSkipped,
      same_as_r1: sameAsR1List.length,
      same_as_r1_list: sameAsR1List.slice(0, 500),
      no_submission_r1: noSubmissionR1.length,
      no_submission_r1_list: noSubmissionR1.slice(0, 500),
      round_counts: roundCounts,
      cancelled,
      terminated,
      diff_rows: diffRows.slice(0, 300),
    };

    if (!data.apply) {
      return {
        ...preview,
        applied: false,
        batch_id: null,
        items_updated: 0,
        stages_upserted: 0,
        rejected: [],
        null_overwrites: {},
      };
    }

    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("wrt_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: [data.sheet_name],
        total_rows: data.rows.length,
        matched: matchedRows.length,
        unmatched: aconexOnly.length,
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
    const rejected: WrtAconexResult["rejected"] = [];
    try {
      const APPLY_CHUNK = 200;
      for (let i = 0; i < patches.length; i += APPLY_CHUNK) {
        const { data: res, error } = await supa.rpc("wrt_aconex_apply", {
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
        .from("wrt_import_logs")
        .update({ status: "failed", note: `WRT Aconex import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    // 행 로그 — 변경된 행만
    const rowLogs = diffRows.map((d) => ({
      batch_id: batchId,
      sheet_name: data.sheet_name,
      excel_row: d.excel_row ?? 0,
      wrt_number: d.document_no,
      outcome: "updated",
      code: "aconex_sync",
      detail: `round=${d.round} semantic=${d.semantic} ${d.changes.length} field(s)`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("wrt_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[wrt aconex row logs]", error.message);
    }

    // 사후 검증 — change_log 에서 값 → 빈칸 덮어쓰기 실측
    const nullOverwrites: Record<string, number> = {};
    try {
      const { data: audit } = await supa
        .from("wrt_change_log")
        .select("column_name")
        .eq("batch_id", batchId)
        .not("old_value", "is", null)
        .is("new_value", null);
      for (const row of (audit ?? []) as any[]) {
        const f = String(row.column_name);
        nullOverwrites[f] = (nullOverwrites[f] ?? 0) + 1;
      }
    } catch (e) {
      console.warn("[wrt aconex postAudit]", e);
    }
    const nullTotal = Object.values(nullOverwrites).reduce((a, b) => a + b, 0);

    await supa
      .from("wrt_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        finished_at: new Date().toISOString(),
        note:
          `aconex docs=${data.rows.length} matched=${matchedRows.length} aconex_only=${aconexOnly.length} ` +
          `wrt_only=${wrtOnly.length} out_of_scope=${outOfScope.length} cells=${preview.cells_changed} ` +
          `review_skipped=${reviewSkipped} no_sb_r1=${noSubmissionR1.length} unmapped=${unmappedList.length} ` +
          `same_as_r1=${sameAsR1List.length} ` +
          `rejected=${rejected.length}` +
          (nullTotal > 0
            ? ` ⚠ blank_overwrites: ${Object.entries(nullOverwrites).map(([f, n]) => `${f}=${n}`).join(", ")}`
            : ""),
      })
      .eq("id", batchId);

    return {
      ...preview,
      applied: true,
      batch_id: batchId,
      items_updated: itemsUpdated,
      stages_upserted: stagesUpserted,
      rejected,
      null_overwrites: nullOverwrites,
    };
  });
