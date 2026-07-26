import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildFieldLog, classifyChange, flushFieldLogs, type PendingFieldLog } from "@/lib/import/field-log";

/**
 * Aconex Export 임포트 - 기존 abd_items_raw 행에 대해 UPDATE 전용.
 * - 매칭 키: abd_number = document_no
 * - 갱신 컬럼: latest_status, latest_rev, approval_date,
 *   aconex_status_raw, aconex_review_status_raw, aconex_date_modified,
 *   aconex_last_synced_at
 * - 미매칭 문서는 INSERT 하지 않음 (unmatched 로 리포트).
 * - CX / TM (Cancelled / Terminated) 은 latest_status 를 그대로 반영하되
 *   파생 트리거가 상태 분류에서 제외 처리.
 */

const RowSchema = z.object({
  document_no: z.string().min(1),
  revision: z.string().nullable().optional(),
  status_raw: z.string().nullable().optional(),
  review_status_raw: z.string().nullable().optional(),
  status_code: z.string().nullable().optional(),
  status_norm: z.string().nullable().optional(),
  date_modified: z.string().nullable().optional(),
  is_excluded: z.boolean().default(false),
  semantic: z
    .enum([
      "DAR_APPROVED_A",
      "DAR_APPROVED_B",
      "DAR_REJECTED",
      "SUBMITTED",
      "EXCLUDED_TERMINATED",
      "EXCLUDED_CANCELLED",
      "UNKNOWN",
    ])
    .default("UNKNOWN"),
  excel_row: z.number().optional(),
});

const SYNC_FIELD_KEYS = [
  "latest_status",
  "latest_rev",
  "approval_date",
  "aconex_status_raw",
  "aconex_review_status_raw",
  "aconex_date_modified",
  "round_actual",
  "is_terminated",
] as const;
export type AconexSyncField = (typeof SYNC_FIELD_KEYS)[number];

const InputSchema = z.object({
  file_name: z.string(),
  data_date: z.string().nullable().optional(),
  rows: z.array(RowSchema).max(20000),
  /** true = 실제 반영 / false = preview 만 */
  apply: z.boolean().default(false),
  /** 사용자가 반영을 선택한 컬럼 집합 (null 이면 전체) */
  apply_fields: z.array(z.enum(SYNC_FIELD_KEYS)).nullable().optional(),
});

export type AconexImportPreview = {
  total: number;
  matched: number;
  unmatched: number;
  excluded: number;
  by_status: Array<{ code: string; count: number }>;
  by_semantic: Array<{ semantic: string; count: number }>;
  unmatched_samples: string[];
  /** 필드별 실제 변경 예상 건수 (unchanged 제외). */
  field_diff_counts: Array<{ field: string; changed: number }>;
  /** 미리보기용 상세 diff 샘플 (최대 200 rows). */
  diff_rows: Array<{
    document_no: string;
    excel_row: number | null;
    semantic: string;
    changes: Array<{ field: string; previous: string | null; next: string | null }>;
  }>;
  /** Termination/Cancelled 로 감지되어 해당 라운드가 재제출 대기 상태로 리셋된 도면 목록. */
  terminated_reset: Array<{
    document_no: string;
    round: 1 | 2 | 3;
    prev_submission_actual: string | null;
    prev_response_result: string | null;
    date_modified: string | null;
    semantic: "EXCLUDED_TERMINATED" | "EXCLUDED_CANCELLED";
  }>;
};

export type AconexImportResult = AconexImportPreview & {
  updated: number;
  batch_id: string | null;
};

async function assertEditor(ctx: any) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superuser" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 Aconex 임포트를 실행할 수 있습니다");
}

export const importAbdAconexBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<AconexImportResult> => {
    await assertEditor(context);
    const supa = context.supabase as any;

    // 1) 상태 분포 집계
    const byStatus = new Map<string, number>();
    const bySemantic = new Map<string, number>();
    for (const r of data.rows) {
      const key = r.status_code ?? "UNKNOWN";
      byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
      const sem = r.semantic ?? "UNKNOWN";
      bySemantic.set(sem, (bySemantic.get(sem) ?? 0) + 1);
    }
    const excludedCount = data.rows.filter((r) => r.is_excluded).length;

    // 2) 매칭 검사: chunked IN
    const docNos = Array.from(new Set(data.rows.map((r) => r.document_no)));
    const existing = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < docNos.length; i += CHUNK) {
      const slice = docNos.slice(i, i + CHUNK);
      const { data: rows, error } = await supa
        .from("abd_items_raw")
        .select("abd_number")
        .in("abd_number", slice);
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) existing.add(row.abd_number);
    }
    // 라운드 라우팅을 위해 기존 행의 라운드별 값을 함께 로드.
    const existingRows = new Map<string, any>();
    const roundCols =
      "abd_number,latest_status,latest_status_norm,is_terminated,active_round," +
      "r1_submission_actual,r2_submission_actual,r3_submission_actual," +
      "r1_dar_actual,r2_dar_actual,r3_dar_actual," +
      "r1_response_result,r2_response_result,r3_response_result," +
      "r1_ds_actual,r2_ds_actual,r3_ds_actual," +
      "r1_df_actual,r2_df_actual,r3_df_actual," +
      "r1_ds_plan,r2_ds_plan,r3_ds_plan," +
      "r1_df_plan,r2_df_plan,r3_df_plan";
    for (let i = 0; i < docNos.length; i += CHUNK) {
      const slice = docNos.slice(i, i + CHUNK);
      const { data: rows, error } = await supa
        .from("abd_items_raw")
        .select(roundCols)
        .in("abd_number", slice);
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) existingRows.set(row.abd_number, row);
    }
    const matched = data.rows.filter((r) => existingRows.has(r.document_no));
    const unmatched = data.rows.filter((r) => !existingRows.has(r.document_no));

    // 어떤 필드가 실제 반영되는지 결정 (apply_fields 미지정 시 전체).
    const allowed = new Set<string>(
      data.apply_fields && data.apply_fields.length > 0
        ? data.apply_fields
        : (SYNC_FIELD_KEYS as readonly string[]),
    );

    // ---------- Diff 계산 (preview & apply 공통) ----------
    type Diff = {
      document_no: string;
      excel_row: number | null;
      semantic: string;
      patch: Record<string, any>;
      changes: Array<{ field: string; previous: string | null; next: string | null }>;
    };
    const fieldDiffCounts = new Map<string, number>();
    const diffs: Diff[] = [];
    const terminatedReset: AconexImportPreview["terminated_reset"] = [];
    for (const r of matched) {
      const existing = existingRows.get(r.document_no) ?? {};
      const patch = computePatch(r, existing, allowed);
      if (r.semantic === "EXCLUDED_TERMINATED" || r.semantic === "EXCLUDED_CANCELLED") {
        const n = resolveActiveRound(existing);
        terminatedReset.push({
          document_no: r.document_no,
          round: n,
          prev_submission_actual: existing[`r${n}_submission_actual`] ?? null,
          prev_response_result: existing[`r${n}_response_result`] ?? null,
          date_modified: r.date_modified ?? null,
          semantic: r.semantic,
        });
      }
      const changes: Diff["changes"] = [];
      for (const [field, next] of Object.entries(patch)) {
        if (META_FIELDS.has(field)) continue;
        const prev = existing[field] ?? null;
        if (classifyChange(next, prev) !== "applied") continue;
        changes.push({
          field,
          previous: prev == null ? null : String(prev),
          next: next == null ? null : String(next),
        });
        fieldDiffCounts.set(field, (fieldDiffCounts.get(field) ?? 0) + 1);
      }
      diffs.push({
        document_no: r.document_no,
        excel_row: r.excel_row ?? null,
        semantic: r.semantic ?? "UNKNOWN",
        patch,
        changes,
      });
    }

    const preview: AconexImportPreview = {
      total: data.rows.length,
      matched: matched.length,
      unmatched: unmatched.length,
      excluded: excludedCount,
      by_status: Array.from(byStatus.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
      by_semantic: Array.from(bySemantic.entries())
        .map(([semantic, count]) => ({ semantic, count }))
        .sort((a, b) => b.count - a.count),
      unmatched_samples: unmatched.slice(0, 20).map((r) => r.document_no),
      field_diff_counts: Array.from(fieldDiffCounts.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      diff_rows: diffs
        .filter((d) => d.changes.length > 0)
        .slice(0, 200)
        .map(({ document_no, excel_row, semantic, changes }) => ({
          document_no,
          excel_row,
          semantic,
          changes,
        })),
      terminated_reset: terminatedReset,
    };

    if (!data.apply) {
      return { ...preview, updated: 0, batch_id: null };
    }

    // 3) import log
    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("abd_import_logs")
      .insert({
        file_name: data.file_name,
        team: "MECH", // Aconex 는 team 무관, NOT NULL 스키마 회피
        plot: null,
        sheet_name: "Docs (Aconex)",
        total_rows: data.rows.length,
        status: "in_progress",
        started_at: nowIso,
        imported_by: context.userId,
        note: `Aconex sync — matched=${matched.length} unmatched=${unmatched.length}`,
      })
      .select("id")
      .single();
    if (logErr) throw new Error(logErr.message);
    const batchId = logRow.id as string;

    // 4) 개별 UPDATE + 필드 변경 로그 축적 (T6)
    const pendingLogs: PendingFieldLog[] = [];
    let updated = 0;
    for (const d of diffs) {
      const existing = existingRows.get(d.document_no) ?? {};
      const patch = {
        ...d.patch,
        aconex_last_synced_at: nowIso,
        source_import_log_id: batchId,
        updated_at: nowIso,
        updated_by: context.userId,
      };
      const { error: upErr } = await supa
        .from("abd_items_raw")
        .update(patch)
        .eq("abd_number", d.document_no);
      if (upErr) throw new Error(upErr.message);
      updated++;

      for (const ch of d.changes) {
        pendingLogs.push(
          buildFieldLog("abd", {
            rawRowNo: d.excel_row,
            field: ch.field,
            outcome: "applied",
            raw: ch.next,
            applied: ch.next,
            previous: ch.previous,
            code: "aconex_sync",
            detail: `document_no=${d.document_no} semantic=${d.semantic}`,
          }),
        );
      }
      // 변경 없이 스킵된 필드 (unchanged) 도 축약 기록 - 라운드 라우팅 감사용
      const cur = String(existing.latest_status ?? "").toUpperCase();
      if (d.changes.length === 0) {
        pendingLogs.push(
          buildFieldLog("abd", {
            rawRowNo: d.excel_row,
            field: "latest_status",
            outcome: "unchanged",
            raw: cur,
            applied: cur,
            previous: cur,
            code: "aconex_no_change",
            detail: `document_no=${d.document_no} semantic=${d.semantic}`,
          }),
        );
      }
    }

    // 필드 변경 로그 flush (실패 시 임포트는 성공 처리)
    void flushFieldLogs(supa, batchId, context.userId, pendingLogs).catch((e) =>
      console.warn("[abd_aconex flushFieldLogs]", e),
    );

    await supa
      .from("abd_import_logs")
      .update({
        inserted: 0,
        updated,
        inactivated: 0,
        mismatched: unmatched.length,
        status: "success",
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    return { ...preview, updated, batch_id: batchId };
  });

// ------------------------------------------------------------------
// 헬퍼: 단일 row → 패치 오브젝트 계산.
// preview / apply 양쪽에서 동일 로직을 재사용.
// ------------------------------------------------------------------
const META_FIELDS = new Set([
  "aconex_last_synced_at",
  "source_import_log_id",
  "updated_at",
  "updated_by",
]);

function computePatch(
  r: z.infer<typeof RowSchema>,
  existing: any,
  allowed: Set<string>,
): Record<string, any> {
  const patch: Record<string, any> = {};

  if (allowed.has("aconex_status_raw")) patch.aconex_status_raw = r.status_raw ?? null;
  if (allowed.has("aconex_review_status_raw"))
    patch.aconex_review_status_raw = r.review_status_raw ?? null;
  if (allowed.has("aconex_date_modified"))
    patch.aconex_date_modified = r.date_modified ?? null;
  if (allowed.has("latest_rev") && r.revision) patch.latest_rev = r.revision;

  const semantic = r.semantic ?? "UNKNOWN";
  const iso = r.date_modified;

  if (semantic === "EXCLUDED_TERMINATED" || semantic === "EXCLUDED_CANCELLED") {
    if (allowed.has("is_terminated")) patch.is_terminated = true;
    if (allowed.has("latest_status"))
      patch.latest_status = r.status_code ?? r.status_raw ?? null;
    return patch;
  }

  let n: 1 | 2 | 3 = (existing.active_round as 1 | 2 | 3) ?? 1;
  if (!existing.active_round) {
    if (
      existing.r3_submission_actual ||
      existing.r3_dar_actual ||
      existing.r2_response_result === "B" ||
      existing.r2_response_result === "C"
    )
      n = 3;
    else if (
      existing.r2_submission_actual ||
      existing.r2_dar_actual ||
      existing.r1_response_result === "B" ||
      existing.r1_response_result === "C"
    )
      n = 2;
    else n = 1;
  }

  if (semantic === "DAR_APPROVED_A" || semantic === "DAR_APPROVED_B") {
    if (allowed.has("round_actual") && iso) {
      patch[`r${n}_dar_actual`] = iso;
      patch[`r${n}_response_result`] = semantic === "DAR_APPROVED_A" ? "A" : "B";
    }
    if (allowed.has("approval_date") && iso && semantic === "DAR_APPROVED_A") {
      patch.approval_date = iso;
    }
    if (allowed.has("latest_status"))
      patch.latest_status = semantic === "DAR_APPROVED_A" ? "A" : "B";
  } else if (semantic === "DAR_REJECTED") {
    if (allowed.has("round_actual") && iso) {
      patch[`r${n}_dar_actual`] = iso;
      patch[`r${n}_response_result`] = r.status_code === "D" ? "D" : "C";
    }
    if (allowed.has("latest_status"))
      patch.latest_status = r.status_code === "D" ? "D" : "C";
  } else if (semantic === "SUBMITTED") {
    const submissionCol = `r${n}_submission_actual`;
    if (allowed.has("round_actual") && iso && !existing[submissionCol]) {
      patch[submissionCol] = iso;
    }
    const cur = String(existing.latest_status ?? "").toUpperCase();
    if (allowed.has("latest_status") && !["A", "B", "C", "D"].includes(cur)) {
      patch.latest_status = "UR";
    }
  }
  return patch;
}