import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripNullExcept } from "@/lib/import/strip-null";
import { buildFieldLog, classifyChange, flushFieldLogs, type PendingFieldLog } from "@/lib/import/field-log";

const UpdateFieldSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

const EDITABLE_FIELDS = new Set<string>([
  "hdec_pic_name", "hdec_eng_name", "document_title", "latest_rev", "latest_status", "approval_date", "batch_no",
  "r1_submission_plan", "r1_submission_actual", "r1_dar_plan", "r1_dar_actual",
  "r2_submission_plan", "r2_submission_actual", "r2_dar_plan", "r2_dar_actual",
  "r3_submission_plan", "r3_submission_actual", "r3_dar_plan", "r3_dar_actual",
  // v5 신규: DS/DF + Response Result
  "r1_draft_start_plan","r1_draft_start_actual","r1_draft_finish_plan","r1_draft_finish_actual","r1_response_result",
  "r2_draft_start_plan","r2_draft_start_actual","r2_draft_finish_plan","r2_draft_finish_actual","r2_response_result",
  "r3_draft_start_plan","r3_draft_start_actual","r3_draft_finish_plan","r3_draft_finish_actual","r3_response_result",
  "is_active",
]);

async function assertEditor(ctx: any) {
  // 임포트 등 행 단위 판정이 어려운 경로용 – rank ≥ senior_user 통과
  const { data: ok } = await ctx.supabase.rpc("has_any_role", {
    _user_id: ctx.userId,
    _roles: ["admin", "superuser", "senior_user"],
  });
  if (!ok) throw new Error("권한 없음: 편집 권한이 없습니다");
}

async function assertCanEditRow(ctx: any, rowId: string) {
  const { data: ok, error } = await ctx.supabase.rpc("can_edit_row", {
    _user_id: ctx.userId,
    _table_name: "abd_items_raw",
    _row_id: rowId,
  });
  if (error) throw new Error(error.message);
  if (!ok) throw new Error("권한 없음: 이 행을 편집할 수 없습니다");
}

export const updateAbdField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateFieldSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEditRow(context, data.id);
    if (!EDITABLE_FIELDS.has(data.field)) throw new Error(`Field '${data.field}' 은 편집 대상이 아닙니다.`);
    await (context.supabase as any).rpc("set_config", { setting_name: "app.change_source", new_value: "manual", is_local: true }).catch(() => {});
    const patch: Record<string, any> = { [data.field]: data.value, updated_at: new Date().toISOString(), updated_by: context.userId };
    const { error } = await (context.supabase as any).from("abd_items_raw").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -- Import: 배치 임포트 (upsert + inactivate missing) --------------------------
const ImportRowSchema = z.object({
  abd_number: z.string().min(1),
  plot: z.string().nullable().optional(),
  sl_no: z.number().nullable().optional(),
  dis: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  doc_ax: z.string().nullable().optional(),
  doc_axx: z.string().nullable().optional(),
  doc_nn1: z.string().nullable().optional(),
  doc_n: z.string().nullable().optional(),
  doc_nn2: z.string().nullable().optional(),
  document_title: z.string().nullable().optional(),
  abd_ocs_no: z.string().nullable().optional(),
  batch_no: z.string().nullable().optional(),
  hdec_pic_name: z.string().nullable().optional(),
  hdec_eng_name: z.string().nullable().optional(),
  latest_rev: z.string().nullable().optional(),
  latest_status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  r1_submission_plan: z.string().nullable().optional(), r1_submission_actual: z.string().nullable().optional(),
  r1_dar_plan: z.string().nullable().optional(),        r1_dar_actual: z.string().nullable().optional(),
  r2_submission_plan: z.string().nullable().optional(), r2_submission_actual: z.string().nullable().optional(),
  r2_dar_plan: z.string().nullable().optional(),        r2_dar_actual: z.string().nullable().optional(),
  r3_submission_plan: z.string().nullable().optional(), r3_submission_actual: z.string().nullable().optional(),
  r3_dar_plan: z.string().nullable().optional(),        r3_dar_actual: z.string().nullable().optional(),
  // v5 신규
  r1_draft_start_plan: z.string().nullable().optional(),  r1_draft_start_actual: z.string().nullable().optional(),
  r1_draft_finish_plan: z.string().nullable().optional(), r1_draft_finish_actual: z.string().nullable().optional(),
  r1_response_result: z.string().nullable().optional(),
  r2_draft_start_plan: z.string().nullable().optional(),  r2_draft_start_actual: z.string().nullable().optional(),
  r2_draft_finish_plan: z.string().nullable().optional(), r2_draft_finish_actual: z.string().nullable().optional(),
  r2_response_result: z.string().nullable().optional(),
  r3_draft_start_plan: z.string().nullable().optional(),  r3_draft_start_actual: z.string().nullable().optional(),
  r3_draft_finish_plan: z.string().nullable().optional(), r3_draft_finish_actual: z.string().nullable().optional(),
  r3_response_result: z.string().nullable().optional(),
  raw_payload: z.record(z.string(), z.any()).optional(),
  excel_row: z.number().optional(),
  sheet_name: z.string().optional(),
});

const ImportBatchSchema = z.object({
  file_name: z.string(),
  team: z.enum(["MECH", "ELEC", "ARCH", "DESN", "PRJC"]),
  plot: z.string().nullable().optional(),
  sheet_name: z.string().nullable().optional(),
  data_date: z.string().nullable().optional(),
  rows: z.array(ImportRowSchema).max(10000),
  inactivate_missing: z.boolean().default(true),
  allow_duplicates: z.boolean().default(false),
  note: z.string().nullable().optional(),
  /** payload에서 제외할 필드 목록 (기존 DB 값 보존). 시스템 키는 서버에서 강제 필터. */
  excluded_fields: z.array(z.string()).optional(),
  /** append 모드: 기존 abd_import_logs 행을 재사용. 없으면 새 로그 생성. */
  log_id: z.string().uuid().nullable().optional(),
  /** 파일 전체의 예상 총 행수(첫 호출에서 total_rows에 저장) */
  file_total_rows: z.number().int().nonnegative().optional(),
  /** 마지막 호출 여부. true일 때만 inactivate_missing 수행 및 log finalize. */
  finalize: z.boolean().default(false),
  /** finalize=true일 때 inactivate_missing 판정 스코프: 파일 전체에서 본 (plot, abd_numbers). */
  finalize_scope: z
    .array(
      z.object({
        plot: z.string().nullable(),
        abd_numbers: z.array(z.string()),
      }),
    )
    .optional(),
});

export const importAbdBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ImportBatchSchema.parse(data))
  .handler(async ({ data, context }) => {
   try {
    await assertEditor(context);
    const supa = context.supabase as any;

    // 시스템 키는 excluded_fields 로 절대 제외되지 않음 (매칭/메타/upsert 필수)
    const NEVER_EXCLUDE = new Set<string>([
      "team",
      "abd_number",
      "plot",
      "is_active",
      "inactive_reason",
      "field_mismatch",
      "mismatch_fields",
      "raw_payload",
      "source_import_log_id",
      "data_date",
      "updated_at",
      "updated_by",
    ]);
    const excluded = new Set<string>(
      (data.excluded_fields ?? []).filter((f) => !NEVER_EXCLUDE.has(f)),
    );

    // 파일 내 중복 처리:
    //  - 불허(default): 즉시 차단
    //  - 허용: 2번째 등장부터 ABD_NUMBER 뒤에 -02, -03 … 접미사를 붙여 모두 저장
    let rowsToImport: Array<typeof data.rows[number] & { original_abd_number?: string }> = data.rows;
    {
      const counts = new Map<string, number>();
      const dupSet = new Set<string>();
      for (const r of data.rows) {
        const n = (counts.get(r.abd_number) ?? 0) + 1;
        counts.set(r.abd_number, n);
        if (n > 1) dupSet.add(r.abd_number);
      }
      if (dupSet.size > 0) {
        if (!data.allow_duplicates) {
          throw new Error(
            `파일 내 ABD_NUMBER 중복이 있어 임포트를 진행할 수 없습니다: ${Array.from(dupSet).slice(0, 5).join(", ")}${dupSet.size > 5 ? " …" : ""}`,
          );
        }
        // suffix rename: 2번째부터 -02, -03 … (첫 번째는 원본 유지)
        const seq = new Map<string, number>();
        rowsToImport = data.rows.map((r) => {
          const cur = (seq.get(r.abd_number) ?? 0) + 1;
          seq.set(r.abd_number, cur);
          if (cur === 1) return r;
          const suffix = String(cur).padStart(2, "0");
          const newNum = `${r.abd_number}-${suffix}`;
          return {
            ...r,
            original_abd_number: r.abd_number,
            abd_number: newNum,
            raw_payload: {
              ...(r.raw_payload ?? {}),
              _original_abd_number: r.abd_number,
              _duplicate_suffix: suffix,
            },
          };
        });
      }
    }

    // 1) create or reuse import log (파일당 1건)
    let batchId: string;
    if (data.log_id) {
      batchId = data.log_id;
    } else {
      const { data: logRow, error: logErr } = await supa
        .from("abd_import_logs")
        .insert({
          file_name: data.file_name,
          team: data.team,
          // 파일 단위 로그이므로 시트별 plot/sheet_name은 저장하지 않음
          plot: null,
          sheet_name: null,
          total_rows: data.file_total_rows ?? data.rows.length,
          status: "in_progress",
          started_at: new Date().toISOString(),
          imported_by: context.userId,
          build_id: typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : null,
          note: data.note ?? null,
        })
        .select("id").single();
      if (logErr) throw new Error(logErr.message);
      batchId = logRow.id as string;
    }

    // 2) upsert rows in chunks
    let inserted = 0, updated = 0;
    const seenNumbers = new Set<string>();
    const CHUNK = 500;
    const rowLogs: any[] = [];
    const pendingFieldLogs: PendingFieldLog[] = [];
    // Tracked fields for import_field_logs (excluding meta/system)
    const ABD_TRACKED_FIELDS = [
      "plot","sl_no","dis","service","doc_ax","doc_axx","doc_nn1","doc_n","doc_nn2",
      "document_title","abd_ocs_no","batch_no","hdec_pic_name","hdec_eng_name",
      "latest_rev","latest_status","approval_date",
      "r1_submission_plan","r1_submission_actual","r1_dar_plan","r1_dar_actual",
      "r2_submission_plan","r2_submission_actual","r2_dar_plan","r2_dar_actual",
      "r3_submission_plan","r3_submission_actual","r3_dar_plan","r3_dar_actual",
      "r1_draft_start_plan","r1_draft_start_actual","r1_draft_finish_plan","r1_draft_finish_actual","r1_response_result",
      "r2_draft_start_plan","r2_draft_start_actual","r2_draft_finish_plan","r2_draft_finish_actual","r2_response_result",
      "r3_draft_start_plan","r3_draft_start_actual","r3_draft_finish_plan","r3_draft_finish_actual","r3_response_result",
    ] as const;
    let rowIndex = 0;
    const ABD_FORCE_KEYS = [
      "team",
      "abd_number",
      "is_active",
      "inactive_reason",
      "field_mismatch",
      "mismatch_fields",
      "raw_payload",
      "source_import_log_id",
      "data_date",
      "updated_at",
      "updated_by",
    ] as const;
    for (let i = 0; i < rowsToImport.length; i += CHUNK) {
      const chunk = rowsToImport.slice(i, i + CHUNK);
      const payload = chunk.map((r) => {
        seenNumbers.add(r.abd_number);
        const row = {
          team: data.team,
          abd_number: r.abd_number,
          plot: r.plot ?? null,
          sl_no: r.sl_no ?? null,
          dis: r.dis ?? null,
          service: r.service ?? null,
          doc_ax: r.doc_ax ?? null,
          doc_axx: r.doc_axx ?? null,
          doc_nn1: r.doc_nn1 ?? null,
          doc_n: r.doc_n ?? null,
          doc_nn2: r.doc_nn2 ?? null,
          document_title: r.document_title ?? null,
          abd_ocs_no: r.abd_ocs_no ?? null,
          batch_no: r.batch_no ?? null,
          hdec_pic_name: r.hdec_pic_name ?? null,
          hdec_eng_name: r.hdec_eng_name ?? null,
          latest_rev: r.latest_rev ?? null,
          latest_status: r.latest_status ?? null,
          approval_date: r.approval_date ?? null,
          r1_submission_plan: r.r1_submission_plan ?? null, r1_submission_actual: r.r1_submission_actual ?? null,
          r1_dar_plan: r.r1_dar_plan ?? null,             r1_dar_actual: r.r1_dar_actual ?? null,
          r2_submission_plan: r.r2_submission_plan ?? null, r2_submission_actual: r.r2_submission_actual ?? null,
          r2_dar_plan: r.r2_dar_plan ?? null,             r2_dar_actual: r.r2_dar_actual ?? null,
          r3_submission_plan: r.r3_submission_plan ?? null, r3_submission_actual: r.r3_submission_actual ?? null,
          r3_dar_plan: r.r3_dar_plan ?? null,             r3_dar_actual: r.r3_dar_actual ?? null,
          r1_draft_start_plan: r.r1_draft_start_plan ?? null,   r1_draft_start_actual: r.r1_draft_start_actual ?? null,
          r1_draft_finish_plan: r.r1_draft_finish_plan ?? null, r1_draft_finish_actual: r.r1_draft_finish_actual ?? null,
          r1_response_result: r.r1_response_result ?? null,
          r2_draft_start_plan: r.r2_draft_start_plan ?? null,   r2_draft_start_actual: r.r2_draft_start_actual ?? null,
          r2_draft_finish_plan: r.r2_draft_finish_plan ?? null, r2_draft_finish_actual: r.r2_draft_finish_actual ?? null,
          r2_response_result: r.r2_response_result ?? null,
          r3_draft_start_plan: r.r3_draft_start_plan ?? null,   r3_draft_start_actual: r.r3_draft_start_actual ?? null,
          r3_draft_finish_plan: r.r3_draft_finish_plan ?? null, r3_draft_finish_actual: r.r3_draft_finish_actual ?? null,
          r3_response_result: r.r3_response_result ?? null,
          field_mismatch: false,
          mismatch_fields: {},
          raw_payload: r.raw_payload ?? {},
          is_active: true,
          inactive_reason: null,
          source_import_log_id: batchId,
          data_date: data.data_date ?? null,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        };
        // 사용자가 제외한 필드는 payload에서 삭제 → upsert 시 기존 DB 값 유지
        if (excluded.size > 0) {
          for (const k of Object.keys(row)) {
            if (excluded.has(k)) delete (row as any)[k];
          }
        }
        return stripNullExcept(row, ABD_FORCE_KEYS);
      });

      // Tier1 #9: single select covers both existence check (diff) and source
      // stamp guard (Aconex source protection). In-memory branching below.
      const nums = chunk.map((r) => r.abd_number);
      const combinedSelect =
        "abd_number," +
        ABD_TRACKED_FIELDS.join(",") +
        ",r1_response_source,r2_response_source,r3_response_source";
      const { data: existingRows } = await supa
        .from("abd_items_raw")
        .select(combinedSelect)
        .eq("team", data.team)
        .in("abd_number", nums);
      const existingMap = new Map<string, any>();
      const srcMap = new Map<string, any>();
      for (const e of (existingRows ?? []) as any[]) {
        existingMap.set(e.abd_number, e);
        srcMap.set(e.abd_number, e);
      }
      const existingSet = new Set(existingMap.keys());

      // Aconex 정본 가드: 기존 행의 r{n}_response_source='imported' 이면
      // HDEC 파서가 해당 라운드의 r{n}_response_result 를 덮어쓰지 못하게 payload에서 제거
      // 추가 정책: 기존 소스가 'backfill' 인데 HDEC 이 실제 값을 채워 넣는 경우,
      //           덮어쓰기를 허용하되 r{n}_response_source 를 'hdec' 로 명시 갱신한다.
      for (const row of payload) {
        const src = srcMap.get((row as any).abd_number);
        for (const n of [1, 2, 3] as const) {
          const key = `r${n}_response_result`;
          const srcKey = `r${n}_response_source`;
          const incoming = (row as any)[key];
          if (src && src[srcKey] === "imported" && key in (row as any)) {
            delete (row as any)[key];
            continue;
          }
          // HDEC 이 실제 값을 채운 경우, source 스탬프도 'hdec' 로 갱신
          if (incoming !== null && incoming !== undefined && incoming !== "") {
            (row as any)[srcKey] = "hdec";
          }
        }
      }

      const { error: upErr } = await supa
        .from("abd_items_raw")
        .upsert(payload, { onConflict: "team,abd_number" });
      if (upErr) throw new Error(upErr.message);

      for (const r of chunk) {
        rowIndex++;
        const wasExisting = existingSet.has(r.abd_number);
        if (wasExisting) updated++; else inserted++;
        rowLogs.push({
          upload_id: batchId,
          raw_row_no: rowIndex,
          team: data.team,
          abd_number: r.abd_number,
          action_taken: wasExisting ? "updated" : "inserted",
          reason_code: null,
          reason_detail: null,
        });
        // Field-level logs
        const prior = existingMap.get(r.abd_number) ?? {};
        for (const fname of ABD_TRACKED_FIELDS) {
          const incoming = (r as any)[fname] ?? null;
          const previous = prior[fname] ?? null;
          const cls = classifyChange(incoming, previous);
          if (cls === "empty" || cls === "unchanged") continue;
          pendingFieldLogs.push(
            buildFieldLog("abd", {
              rawRowNo: rowIndex,
              field: fname,
              outcome: "applied",
              raw: incoming,
              applied: incoming,
              previous: wasExisting ? previous : null,
            }),
          );
        }
      }
    }

    // 3) inactivate missing rows in same team+plot
    let inactivated = 0;
    // finalize=true인 마지막 호출에서만 파일 전체 스코프로 inactivate 수행.
    // append 모드가 아닌 legacy 단일 호출(log_id 없음 + finalize 미지정)에도 하위 호환 유지.
    // 청크 append 모드는 첫 호출에서 log_id 없이 시작하지만 file_total_rows 를 함께 보낸다.
    // legacy 단일 호출(비-청크)은 file_total_rows 도 없다.
    const isLegacySingle = !data.log_id && !data.finalize && data.file_total_rows === undefined;
    const shouldInactivate =
      data.inactivate_missing && (data.finalize || isLegacySingle);
    if (shouldInactivate) {
      // finalize_scope 우선. 없으면 이 호출의 seenNumbers/plot으로 대체 (legacy).
      const scope: Array<{ plot: string | null; abd_numbers: string[] }> =
        data.finalize_scope && data.finalize_scope.length > 0
          ? data.finalize_scope
          : [{ plot: data.plot ?? null, abd_numbers: Array.from(seenNumbers) }];
      const scopePlots = Array.from(
        new Set(scope.map((s) => s.plot).filter((plot): plot is string => !!plot)),
      );
      let activeQuery = supa
        .from("abd_items_raw")
        .select("id, abd_number, plot")
        .eq("team", data.team)
        .eq("is_active", true);
      if (scopePlots.length > 0 && scope.every((s) => !!s.plot)) {
        activeQuery = activeQuery.in("plot", scopePlots);
      }
      const { data: allActive } = await activeQuery;
      const missing: any[] = [];
      for (const s of scope) {
        const seenSet = new Set(s.abd_numbers);
        const scopeRows = (allActive ?? []).filter((r: any) =>
          s.plot ? r.plot === s.plot : true,
        );
        for (const r of scopeRows) {
          if (!seenSet.has(r.abd_number)) missing.push(r);
        }
      }
      // dedupe by id
      const uniqMissing = Array.from(
        new Map(missing.map((m: any) => [m.id, m])).values(),
      );
      const missingIds = uniqMissing.map((r: any) => r.id);
      if (missingIds.length > 0) {
        const { error: inaErr } = await supa
          .from("abd_items_raw")
          .update({
            is_active: false,
            inactive_reason: `missing_in_upload:${batchId}`,
            updated_at: new Date().toISOString(),
            updated_by: context.userId,
          })
          .in("id", missingIds);
        if (inaErr) throw new Error(inaErr.message);
        inactivated = missingIds.length;
        for (const m of uniqMissing) {
          rowLogs.push({
            upload_id: batchId,
            team: data.team,
            abd_number: m.abd_number,
            action_taken: "inactivated",
            reason_code: "missing_in_upload",
            reason_detail: `missing_in_upload:${batchId}`,
          });
          pendingFieldLogs.push(
            buildFieldLog("abd", {
              rawRowNo: null,
              field: "__row__",
              outcome: "info",
              raw: m.abd_number,
              applied: "inactivated",
              previous: "active",
              code: "missing_in_upload",
              detail: `missing_in_upload:${batchId}`,
            }),
          );
        }
      }
    }

    // 3.5) persist row logs (chunked to keep request size reasonable)
    for (let i = 0; i < rowLogs.length; i += 500) {
      await supa.from("abd_import_row_logs").insert(rowLogs.slice(i, i + 500));
    }

    // 3.6) persist field logs
    await flushFieldLogs(supa, batchId, context.userId, pendingFieldLogs);

    // 4) finalize log — 파일 마지막 호출에서만 성공 마감.
    //    append 모드 중간 호출에서는 누적 값을 원자적으로 더한다.
    if (data.finalize || isLegacySingle) {
      // 누적된 카운트를 읽어와 이번 호출분과 합산 후 마감
      const { data: cur } = await supa
        .from("abd_import_logs")
        .select("inserted, updated")
        .eq("id", batchId)
        .single();
      await supa
        .from("abd_import_logs")
        .update({
          inserted: (cur?.inserted ?? 0) + inserted,
          updated: (cur?.updated ?? 0) + updated,
          inactivated,
          mismatched: 0,
          status: "success",
          finished_at: new Date().toISOString(),
        })
        .eq("id", batchId);
    } else {
      // 중간 호출: 누적만 갱신 (finished/status 건드리지 않음)
      const { data: cur } = await supa
        .from("abd_import_logs")
        .select("inserted, updated")
        .eq("id", batchId)
        .single();
      await supa
        .from("abd_import_logs")
        .update({
          inserted: (cur?.inserted ?? 0) + inserted,
          updated: (cur?.updated ?? 0) + updated,
        })
        .eq("id", batchId);
    }

    return { batch_id: batchId, inserted, updated, inactivated, total: rowsToImport.length };
   } catch (err: any) {
     const msg = err?.message ?? String(err);
     const stack = err?.stack ? String(err.stack).split("\n").slice(0, 4).join(" | ") : "";
     console.error("[importAbdBatch] failed:", msg, stack);
     throw new Error(`ABD 임포트 실패: ${msg}${stack ? ` [${stack}]` : ""}`);
   }
  });