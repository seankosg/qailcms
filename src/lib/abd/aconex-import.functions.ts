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
  /** semantic === "EXCLUDED_TERMINATED" 건수 — 라운드 리셋 대상 */
  terminated_reset_count: number;
  /** semantic === "EXCLUDED_CANCELLED" 건수 — 통계 제외 */
  cancelled_excluded_count: number;
  /** is_excluded 지만 두 semantic 어디에도 속하지 않는 예외 케이스 (실측 0건 기대) */
  other_excluded_count: number;
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
  /** Step 4 사후 검증: upload_id 기준 change_log 에서 non-null → null 로 덮어쓴 필드별 건수. */
  null_overwrites?: Record<string, number>;
};

/** status_code='D' 는 현재 DB/실파일 모두 0건 관측 — 등장 시 매핑 확정 전까지 임포트 에러로 보고. */
function isDCode(r: { status_code?: string | null }): boolean {
  return String(r.status_code ?? "").toUpperCase() === "D";
}

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
    const terminated_reset_count = data.rows.filter((r) => r.semantic === "EXCLUDED_TERMINATED").length;
    const cancelled_excluded_count = data.rows.filter((r) => r.semantic === "EXCLUDED_CANCELLED").length;
    const other_excluded_count = Math.max(0, excludedCount - terminated_reset_count - cancelled_excluded_count);

    // 2) 매칭 검사: RPC 를 청크 호출.
    // 청크 분할은 요청 payload 크기와 함수 실행 타임아웃 관리를 위함.
    // 응답 잘림 회피 목적이 아님 — abd_items_by_numbers 는 jsonb 단일 값(배열)을
    // 반환하므로 Data API 행 상한(1,000) 비적용.
    // 중복 abd_number 정책: 배열에 여러 건이 있으면 첫 건만 채택(뒤는 무시).
    const docNos = Array.from(new Set(data.rows.map((r) => r.document_no)));
    const existingRows = new Map<string, any>();
    const CHUNK = 2000;
    for (let i = 0; i < docNos.length; i += CHUNK) {
      const slice = docNos.slice(i, i + CHUNK);
      try {
        const { data: rpcData, error } = await supa.rpc("abd_items_by_numbers", {
          _nums: slice,
        });
        if (error) throw new Error(error.message);
        if (!Array.isArray(rpcData)) {
          throw new Error("abd_items_by_numbers RPC contract mismatch");
        }
        for (const row of rpcData as any[]) {
          if (!row || typeof row !== "object") continue;
          const key = row.abd_number as string | undefined;
          if (!key) continue;
          // 첫 건 채택 정책
          if (!existingRows.has(key)) existingRows.set(key, row);
        }
      } catch (e: any) {
        const msg = e?.cause?.message ?? e?.message ?? String(e);
        throw new Error(
          `abd_items_by_numbers 조회 실패 (chunk ${i}-${i + slice.length}, docNos=${docNos.length}): ${msg}`,
        );
      }
    }
    const matched = data.rows.filter((r) => existingRows.has(r.document_no));
    const unmatched = data.rows.filter((r) => !existingRows.has(r.document_no));

    // §1(a) D-코드 감지: 임포트 에러로 기록만 하고 latest_status 반영 금지.
    const dCodeRows = data.rows.filter((r) => isDCode(r));
    if (dCodeRows.length > 0) {
      console.warn(
        `[aconex] D-code detected in ${dCodeRows.length} row(s) — latest_status write blocked. Samples: ${dCodeRows
          .slice(0, 5)
          .map((r) => r.document_no)
          .join(", ")}`,
      );
    }

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
      terminated_reset_count,
      cancelled_excluded_count,
      other_excluded_count,
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

    // 3) import log — 처음부터 success 로 기록 (실패 경로만 별도 UPDATE)
    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("abd_import_logs")
      .insert({
        file_name: data.file_name,
        team: null, // Aconex 는 team 개념 없음 — 로그 화면에서 "—" 표시
        plot: null,
        sheet_name: "Docs (Aconex)",
        total_rows: data.rows.length,
        status: "success",
        started_at: nowIso,
        finished_at: nowIso,
        inserted: 0,
        inactivated: 0,
        mismatched: unmatched.length,
        imported_by: context.userId,
        build_id: typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : null,
        note: `Aconex sync — matched=${matched.length} unmatched=${unmatched.length}`,
      })
      .select("id")
      .single();
    if (logErr) throw new Error(logErr.message);
    const batchId = logRow.id as string;

    // 4) 벌크 UPDATE — 개별 UPDATE 루프(N회 라운드트립)를 단일 RPC 호출로 대체.
    //    matched 수천 건에서 subrequest 폭증으로 인한 Worker fetch 실패를 근본 해결.
    //    안전 마진으로 1,000건씩 청크 분할 호출.
    const APPLY_CHUNK = 1000;
    let updated = 0;
    try {
      for (let i = 0; i < diffs.length; i += APPLY_CHUNK) {
        const slice = diffs.slice(i, i + APPLY_CHUNK);
        const patches = slice.map((d) => ({ document_no: d.document_no, ...d.patch }));
        const { data: n, error: applyErr } = await supa.rpc("abd_aconex_apply_diffs", {
          _batch_id: batchId,
          _patches: patches,
        });
        if (applyErr) throw new Error(applyErr.message);
        updated += Number(n ?? 0);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await supa
        .from("abd_import_logs")
        .update({ status: "failed", note: `Aconex sync FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    // 4b) 실제 변경된 필드에 대해서만 감사 로그 축적 (unchanged 로그는 제거 — 볼륨 90%+ 감소).
    //     `abd_change_log` 트리거가 이미 row 단위 이력을 남기므로 unchanged 라인은 불필요.
    const pendingLogs: PendingFieldLog[] = [];
    for (const d of diffs) {
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
    }
    // 필드 변경 로그 flush (실패 시 임포트는 성공 처리)
    void flushFieldLogs(supa, batchId, context.userId, pendingLogs).catch((e) =>
      console.warn("[abd_aconex flushFieldLogs]", e),
    );

    // 실제 updated 카운트 반영
    await supa.from("abd_import_logs").update({ updated }).eq("id", batchId);

    // Step 4 사후 검증 — 클라이언트 diffs 가 아닌 서버 change_log(upload_id 기준)로
    // non-null → null 덮어쓰기 건수를 field 별로 집계. 스테일 인스턴스가 실행돼도
    // 트리거가 남긴 흔적이 곧 진실이므로 이 방식이 유일하게 신뢰 가능하다.
    const WATCH_NULL_FIELDS = [
      "latest_status",
      "latest_rev",
      "approval_date",
      "r1_response_result",
      "r2_response_result",
      "r3_response_result",
    ];
    const nullOverwrites: Record<string, number> = {};
    try {
      const { data: audit, error: auditErr } = await supa
        .from("abd_change_log")
        .select("field")
        .eq("upload_id", batchId)
        .in("field", WATCH_NULL_FIELDS)
        .not("old_value", "is", null)
        .is("new_value", null);
      if (auditErr) throw new Error(auditErr.message);
      for (const row of audit ?? []) {
        const f = (row as any).field as string;
        nullOverwrites[f] = (nullOverwrites[f] ?? 0) + 1;
      }
      const total = Object.values(nullOverwrites).reduce((a, b) => a + b, 0);
      if (total > 0) {
        const summary = Object.entries(nullOverwrites)
          .map(([f, n]) => `${f}=${n}`)
          .join(", ");
        await supa
          .from("abd_import_logs")
          .update({
            note: `Aconex sync — matched=${matched.length} unmatched=${unmatched.length} ⚠ null_overwrites: ${summary}`,
          })
          .eq("id", batchId);
      }
    } catch (e) {
      console.warn("[abd_aconex postAudit]", e);
    }

    return { ...preview, updated, batch_id: batchId, null_overwrites: nullOverwrites };
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

function resolveActiveRound(existing: any): 1 | 2 | 3 {
  let n: 1 | 2 | 3 = (existing?.active_round as 1 | 2 | 3) ?? 1;
  if (!existing?.active_round) {
    if (
      existing?.r3_submission_actual ||
      existing?.r3_dar_actual ||
      existing?.r2_response_result === "B" ||
      existing?.r2_response_result === "C"
    )
      n = 3;
    else if (
      existing?.r2_submission_actual ||
      existing?.r2_dar_actual ||
      existing?.r1_response_result === "B" ||
      existing?.r1_response_result === "C"
    )
      n = 2;
    else n = 1;
  }
  return n;
}

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
    // §1(b) Terminated: 합의된 철회 → 동일 라운드 재제출 대기.
    //   ① 실적 필드(actual/response_result)는 절대 리셋하지 않음 (실수신 회신 이력 보존)
    //   ② Draft 데이터도 절대 건드리지 않음 (재작성 불필요)
    //   ③ latest_status / approval_date 도 덮어쓰지 않음
    //   ④ is_terminated=true 로 마킹 → stage 판정에서 '재제출 대기'로 오버라이드
    //   ⑤ 통계에는 포함 (재제출 예정 물량)
    // §1(c) Cancelled: HDEC 자체 폐기 → 통계 완전 제외. latest_status 이력 보존.
    if (semantic === "EXCLUDED_TERMINATED") {
      if (allowed.has("is_terminated")) patch.is_terminated = true;
    } else {
      // Cancelled: 통계 완전 제외 플래그 (is_active=false).
      patch.is_active = false;
      patch.inactive_reason = "aconex_cancelled";
    }
    // latest_status / approval_date: 두 케이스 모두 덮어쓰기 금지 (§1(b)③, §1(c))
    return patch;
  }

  const n = resolveActiveRound(existing);

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
    // §1(a) D-코드: 매핑 미확정 → latest_status/response_result 에 쓰지 않고 skip.
    if (isDCode(r)) {
      // meta 필드만 유지, 상태 계열은 비움 (호출부에서 배치 warning 이미 로그됨)
      return patch;
    }
    if (allowed.has("round_actual") && iso) {
      patch[`r${n}_dar_actual`] = iso;
      patch[`r${n}_response_result`] = "C";
    }
    if (allowed.has("latest_status")) patch.latest_status = "C";
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