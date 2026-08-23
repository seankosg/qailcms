import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildFieldLog, classifyChange, flushFieldLogs, type PendingFieldLog } from "@/lib/import/field-log";
import { assertImportScope } from "@/lib/import/rcl-import-gate";
import {
  normalizeAconexBatch,
  resolveTerminationAction,
  assertTerminationFieldsAllowed,
  assertNoSameDateConflict,
  TERMINATION_CLEAR_REASON,
  TERMINATION_SAME_DATE_DETAIL,
  type BatchBlocker,
  type TerminationAction,
} from "@/lib/abd/aconex-termination";

/**
 * Aconex Export 임포트 - 기존 abd_items_raw 행에 대해 UPDATE 전용.
 * - 매칭 키: abd_number = document_no
 * - 갱신 컬럼: latest_status, latest_rev, approval_date,
 *   aconex_status_raw, aconex_review_status_raw, aconex_date_modified,
 *   rN_dar_actual, rN_response_result,
 *   aconex_last_synced_at
 * - Aconex 는 r*_submission_actual / r*_draft_*_actual 을 절대 쓰지 않음.
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
  "dar_response",
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
  /** 권한 범위 밖이라 제외된 문서 (WRT Aconex 와 동일 규약) */
  out_of_scope: number;
  out_of_scope_list: string[];
  role: string | null;
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
  /** §3.1 동일 문서+동일 날짜+상충 semantic — 자동 판정 금지 대상 */
  same_date_blockers: BatchBlocker[];
  /** 결정론적 축약으로 제거된 중복 입력 행수 */
  collapsed_duplicates: number;
  /** Termination 자동 해제 대상 */
  termination_cleared: Array<{
    document_no: string;
    semantic: string;
    existing_date: string | null;
    incoming_date: string | null;
    same_date: boolean;
  }>;
  /** 날짜 없음/파싱 불가로 해제하지 않은 건 */
  termination_warnings: Array<{ document_no: string; semantic: string; reason: "missing_date" }>;
  /** Round attribution 방어 카운터 */
  round_guard: {
    skipped_r2_no_sb: number;
    skipped_r3_no_sb: number;
    legacy_r1_attribution: number;
    skipped_samples: string[];
  };
};

export type AconexImportResult = AconexImportPreview & {
  updated: number;
  batch_id: string | null;
  /** Step 4 사후 검증: upload_id 기준 change_log 에서 non-null → null 로 덮어쓴 필드별 건수. */
  null_overwrites?: Record<string, number>;
  /** 감사 로그(import_field_logs) 저장 실패 — 조용한 실패 금지 */
  log_persist_failed?: boolean;
  log_persist_errors?: { source: string; error: string; attempted: number; persisted: number }[];
};

/** status_code='D' 는 현재 DB/실파일 모두 0건 관측 — 등장 시 매핑 확정 전까지 임포트 에러로 보고. */
function isDCode(r: { status_code?: string | null }): boolean {
  return String(r.status_code ?? "").toUpperCase() === "D";
}

async function assertEditor(ctx: any) {
  // RCL 정본: 역할 × 범위 격자에서 ABD/import 가 한 범위라도 열려 있어야 실행 가능.
  // 행 단위 판정은 아래 `rcl_import_filter` + `assertImportScope` 가 최종 관문이다.
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "ABD", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: ABD 임포트 권한이 없습니다");
  }
  return g.role;
}

export const importAbdAconexBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<AconexImportResult> => {
    const role = await assertEditor(context);
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
    // 중복 abd_number 정책: 결정적 규칙 — 동일 abd_number 로 여러 행이 돌아오면
    //   최신 aconex_date_modified 우선(동률 시 updated_at 최신). 실측 중복 0건이지만
    //   규칙은 결정적이어야 하므로 명시.
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
          const prev = existingRows.get(key);
          if (!prev) {
            existingRows.set(key, row);
            continue;
          }
          const pick = pickNewer(prev, row);
          existingRows.set(key, pick);
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

    // 권한 스코프 — 행 단위 판정은 서버 `rcl_import_filter` 가 정본.
    // 전건이 기존 행이므로 담당자/팀은 DB 저장값으로 판정된다(파일 값 신뢰 안 함).
    const allowedKeys = new Set<string>();
    const SCOPE_CHUNK = 1000;
    for (let i = 0; i < matched.length; i += SCOPE_CHUNK) {
      const slice = matched.slice(i, i + SCOPE_CHUNK);
      const { data: res, error } = await supa.rpc("rcl_import_filter", {
        _module: "ABD",
        _match_cols: ["abd_number"],
        _rows: slice.map((r) => ({
          abd_number: r.document_no,
          hdec_pic_name: null,
          hdec_eng_name: null,
          team: null,
        })),
      });
      if (error) throw new Error(`임포트 권한 판정 실패(ABD Aconex): ${error.message}`);
      for (const k of ((res as any)?.allowed ?? []) as Array<Record<string, string>>) {
        allowedKeys.add(String(k.abd_number ?? ""));
      }
    }
    const inScope = matched.filter((r) => allowedKeys.has(r.document_no));
    const outOfScope = matched.filter((r) => !allowedKeys.has(r.document_no)).map((r) => r.document_no);

    // ★ 서버 최종 관문: 반영 대상(in-scope)만 다시 판정한다(WRT hdec 와 동일 호출 방식).
    await assertImportScope(
      supa,
      "ABD",
      "abd_number",
      ["hdec_pic_name", "hdec_eng_name", "team"],
      inScope.map((r) => ({ document_no: r.document_no, item: {} as Record<string, string | null> })),
      (r) => r.document_no,
      null,
    );

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
    const roundGuard = {
      skipped_r2_no_sb: 0,
      skipped_r3_no_sb: 0,
      legacy_r1_attribution: 0,
      skipped_samples: [] as string[],
    };
    // §3.1 입력 배치 결정론: 문서당 1행으로 축약, 동일 날짜 상충 semantic 은 blocker.
    const normalized = normalizeAconexBatch(inScope);
    const blockerDocs = new Set(normalized.blockers.map((b) => b.document_no));

    // §2.3 서버 최종 관문 — apply 시 부분 반영조차 금지한다(로그/UPDATE 이전).
    if (data.apply) assertNoSameDateConflict(normalized.blockers);

    // §3.2~3.4 Termination 전환 사전 판정 — preset 누락 시 조용한 스킵 금지.
    const termActions = new Map<string, TerminationAction>();
    for (const r of normalized.rows) {
      termActions.set(
        r.document_no,
        resolveTerminationAction({
          row: r,
          existing: existingRows.get(r.document_no) ?? null,
          sameDateUnambiguous: normalized.unambiguous.get(r.document_no) === true,
        }),
      );
    }
    const termTouching = normalized.rows.filter((r) => {
      const a = termActions.get(r.document_no);
      return a?.kind === "set" || a?.kind === "clear";
    });
    assertTerminationFieldsAllowed(termTouching.map((r) => r.document_no), allowed);

    const terminationCleared: AconexImportPreview["termination_cleared"] = [];
    const terminationWarnings: AconexImportPreview["termination_warnings"] = [];

    for (const r of normalized.rows) {
      if (blockerDocs.has(r.document_no)) continue;
      const existing = existingRows.get(r.document_no) ?? {};
      const termAction = termActions.get(r.document_no) ?? { kind: "none" as const };
      if (termAction.kind === "none" && termAction.warning === "missing_date") {
        terminationWarnings.push({
          document_no: r.document_no,
          semantic: r.semantic ?? "UNKNOWN",
          reason: "missing_date",
        });
      }
      const { patch, guard } = computePatch(r, existing, allowed, termAction);
      if (termAction.kind === "clear" && patch.is_terminated === false) {
        terminationCleared.push({
          document_no: r.document_no,
          semantic: r.semantic ?? "UNKNOWN",
          existing_date: existing.aconex_date_modified ?? null,
          incoming_date: r.date_modified ?? null,
          same_date: termAction.sameDate,
        });
      }
      if (guard === "skipped_r2_no_sb") {
        roundGuard.skipped_r2_no_sb += 1;
        if (roundGuard.skipped_samples.length < 20) roundGuard.skipped_samples.push(r.document_no);
      } else if (guard === "skipped_r3_no_sb") {
        roundGuard.skipped_r3_no_sb += 1;
        if (roundGuard.skipped_samples.length < 20) roundGuard.skipped_samples.push(r.document_no);
      } else if (guard === "legacy_r1_attribution") {
        roundGuard.legacy_r1_attribution += 1;
      }
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
      out_of_scope: outOfScope.length,
      out_of_scope_list: outOfScope.slice(0, 200),
      role,
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
      same_date_blockers: normalized.blockers,
      collapsed_duplicates: normalized.collapsedDuplicates,
      termination_cleared: terminationCleared,
      termination_warnings: terminationWarnings,
      round_guard: roundGuard,
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
        note: `Aconex sync — matched=${matched.length} unmatched=${unmatched.length} in_scope=${inScope.length} out_of_scope=${outOfScope.length}`,
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
            code: ch.field === "is_terminated" && ch.next === "false" ? TERMINATION_CLEAR_REASON : "aconex_sync",
            detail:
              ch.field === "is_terminated" && ch.next === "false"
                ? `document_no=${d.document_no} semantic=${d.semantic} prev_date=${
                    terminationCleared.find((t) => t.document_no === d.document_no)?.existing_date ?? "null"
                  } incoming_date=${
                    terminationCleared.find((t) => t.document_no === d.document_no)?.incoming_date ?? "null"
                  }${
                    terminationCleared.find((t) => t.document_no === d.document_no)?.same_date
                      ? ` ${TERMINATION_SAME_DATE_DETAIL}`
                      : ""
                  }`
                : `document_no=${d.document_no} semantic=${d.semantic}`,
          }),
        );
      }
    }
    // 필드 변경 로그 flush — 실패는 조용히 넘기지 않고 결과에 실어 반환한다.
    const logPersistErrors: { source: string; error: string; attempted: number; persisted: number }[] = [];
    const fieldLogRes = await flushFieldLogs(supa, batchId, context.userId, pendingLogs);
    if (!fieldLogRes.ok) {
      logPersistErrors.push({
        source: "import_field_logs",
        error: fieldLogRes.error ?? "unknown",
        attempted: fieldLogRes.attempted,
        persisted: fieldLogRes.persisted,
      });
    }

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
            note: `Aconex sync — matched=${matched.length} unmatched=${unmatched.length} in_scope=${inScope.length} out_of_scope=${outOfScope.length} ⚠ null_overwrites: ${summary}`,
          })
          .eq("id", batchId);
      }
    } catch (e) {
      console.warn("[abd_aconex postAudit]", e);
    }

    return {
      ...preview,
      updated,
      batch_id: batchId,
      null_overwrites: nullOverwrites,
      log_persist_failed: logPersistErrors.length > 0,
      log_persist_errors: logPersistErrors,
    };
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

function pickNewer(a: any, b: any): any {
  const ad = a?.aconex_date_modified ?? a?.updated_at ?? "";
  const bd = b?.aconex_date_modified ?? b?.updated_at ?? "";
  return String(bd) > String(ad) ? b : a;
}

function resolveActiveRound(existing: any): 1 | 2 | 3 {
  // Option B: active_round(계획 라벨 파생)는 신뢰하지 않는다.
  // 실제 SB actual이 기록된 최고 라운드에만 회신을 귀속시킨다.
  // 레거시 R1(SB actual 없이 승인/거절) 케이스는 컴퓨트 단계에서 별도 카운팅.
  //
  // NOTE (2026-07-29): 판정측 v_active (public.abd_judge_v1) 는 이와 의도적으로 다르다.
  //   - 판정측: 다음 라운드 실적(actual) 또는 이전 라운드 회신(B/C) 존재 시 승격.
  //   - 임포트측(여기): SB actual 최고 라운드만 신뢰 — Aconex 회신을 계획만 있는
  //     빈 라운드에 잘못 귀속시키는 것을 방지.
  // 두 규칙의 차이는 무결성 검사 시 반드시 상호 참조.
  //
  // NOTE (2026-07-29): Progress 집계(public.abd_progress_cells / abd_progress_totals)는
  //   또 다른 기준을 쓴다 — 실적(r{n}_*_actual)은 "영구히 라운드 n 의 사건"이므로
  //   active_round 로 슬라이스하지 않고 컬럼이 라운드를 결정한다.
  //   현재 라운드 개념은 잔여/예정(plan) 산정에만 쓰이며 정본 abd_judge_v1 을 경유한다.
  if (existing?.r3_submission_actual) return 3;
  if (existing?.r2_submission_actual) return 2;
  return 1;
}

function computePatch(
  r: z.infer<typeof RowSchema>,
  existing: any,
  allowed: Set<string>,
  termAction: TerminationAction = { kind: "none" },
): { patch: Record<string, any>; guard: null | "skipped_r2_no_sb" | "skipped_r3_no_sb" | "legacy_r1_attribution" } {
  const patch: Record<string, any> = {};
  let guard: null | "skipped_r2_no_sb" | "skipped_r3_no_sb" | "legacy_r1_attribution" = null;

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
      if (allowed.has("is_terminated") && termAction.kind === "set") patch.is_terminated = true;
    } else {
      // Cancelled: 통계 완전 제외 플래그 (is_active=false).
      patch.is_active = false;
      patch.inactive_reason = "aconex_cancelled";
    }
    // latest_status / approval_date: 두 케이스 모두 덮어쓰기 금지 (§1(b)③, §1(c))
    return { patch, guard };
  }

  // §3.3 Termination 자동 해제 — 정본 전환은 resolveTerminationAction() 이 판정한다.
  if (termAction.kind === "clear" && allowed.has("is_terminated")) {
    patch.is_terminated = false;
  }

  const n = resolveActiveRound(existing);
  // 방어: n∈{2,3}에서 존재하지 않는 SB actual에 회신 귀속 금지
  if ((n === 2 || n === 3) && !existing?.[`r${n}_submission_actual`]) {
    guard = n === 3 ? "skipped_r3_no_sb" : "skipped_r2_no_sb";
    // 상태 필드는 latest_status만 반영 (아래 분기에서 처리)
  } else if (n === 1 && !existing?.r1_submission_actual && (semantic === "DAR_APPROVED_A" || semantic === "DAR_APPROVED_B" || semantic === "DAR_REJECTED")) {
    guard = "legacy_r1_attribution";
  }

  const canWriteRound = guard !== "skipped_r2_no_sb" && guard !== "skipped_r3_no_sb";

  if (semantic === "DAR_APPROVED_A" || semantic === "DAR_APPROVED_B") {
    if (canWriteRound && allowed.has("dar_response") && iso) {
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
      return { patch, guard };
    }
    if (canWriteRound && allowed.has("dar_response") && iso) {
      patch[`r${n}_dar_actual`] = iso;
      patch[`r${n}_response_result`] = "C";
    }
    if (allowed.has("latest_status")) patch.latest_status = "C";
  } else if (semantic === "SUBMITTED") {
    // §1(d) Under Workflow Review / For Review / Submitted:
    //   Aconex Date Modified 는 워크플로우 이동 시각일 뿐 HDEC 실제 제출일이
    //   아니므로 어떤 실적 필드(r*_submission_actual / r*_dar_actual / r*_draft_*_actual)
    //   에도 기록 금지. latest_status 만 UR 로 표기하되 기존 확정 회신 A/B/C/D 는 보호.
    //   (2026-07-29 오염 재발 방지 — backfill 확정 1,385건 원인 지점.)
    const cur = String(existing.latest_status ?? "").toUpperCase();
    if (allowed.has("latest_status") && !["A", "B", "C", "D"].includes(cur)) {
      patch.latest_status = "UR";
    }
  }
  return { patch, guard };
}