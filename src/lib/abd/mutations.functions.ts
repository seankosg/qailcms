import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UpdateFieldSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

const EDITABLE_FIELDS = new Set<string>([
  "pic", "document_title", "latest_rev", "latest_status", "approval_date",
  "r1_drafting_plan", "r1_drafting_actual", "r1_submission_plan", "r1_submission_actual", "r1_dar_plan", "r1_dar_actual",
  "r2_drafting_plan", "r2_drafting_actual", "r2_submission_plan", "r2_submission_actual", "r2_dar_plan", "r2_dar_actual",
  "r3_drafting_plan", "r3_drafting_actual", "r3_submission_plan", "r3_submission_actual", "r3_dar_plan", "r3_dar_actual",
  "is_active",
]);

async function assertEditor(ctx: any) {
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superuser" }),
  ]);
  if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 편집할 수 있습니다");
}

export const updateAbdField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateFieldSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertEditor(context);
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
  pic: z.string().nullable().optional(),
  latest_rev: z.string().nullable().optional(),
  latest_status: z.string().nullable().optional(),
  approval_date: z.string().nullable().optional(),
  r1_drafting_plan: z.string().nullable().optional(),   r1_drafting_actual: z.string().nullable().optional(),
  r1_submission_plan: z.string().nullable().optional(), r1_submission_actual: z.string().nullable().optional(),
  r1_dar_plan: z.string().nullable().optional(),        r1_dar_actual: z.string().nullable().optional(),
  r2_drafting_plan: z.string().nullable().optional(),   r2_drafting_actual: z.string().nullable().optional(),
  r2_submission_plan: z.string().nullable().optional(), r2_submission_actual: z.string().nullable().optional(),
  r2_dar_plan: z.string().nullable().optional(),        r2_dar_actual: z.string().nullable().optional(),
  r3_drafting_plan: z.string().nullable().optional(),   r3_drafting_actual: z.string().nullable().optional(),
  r3_submission_plan: z.string().nullable().optional(), r3_submission_actual: z.string().nullable().optional(),
  r3_dar_plan: z.string().nullable().optional(),        r3_dar_actual: z.string().nullable().optional(),
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
});

export const importAbdBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ImportBatchSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertEditor(context);
    const supa = context.supabase as any;

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

    // 1) create import log
    const { data: logRow, error: logErr } = await supa
      .from("abd_import_logs")
      .insert({
        file_name: data.file_name,
        team: data.team,
        plot: data.plot ?? null,
        sheet_name: data.sheet_name ?? null,
        total_rows: data.rows.length,
        status: "in_progress",
        started_at: new Date().toISOString(),
        imported_by: context.userId,
      })
      .select("id").single();
    if (logErr) throw new Error(logErr.message);
    const batchId = logRow.id as string;

    // 2) upsert rows in chunks
    let inserted = 0, updated = 0;
    const seenNumbers = new Set<string>();
    const CHUNK = 500;
    const rowLogs: any[] = [];
    let rowIndex = 0;
    for (let i = 0; i < rowsToImport.length; i += CHUNK) {
      const chunk = rowsToImport.slice(i, i + CHUNK);
      const payload = chunk.map((r) => {
        seenNumbers.add(r.abd_number);
        return {
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
          pic: r.pic ?? null,
          latest_rev: r.latest_rev ?? null,
          latest_status: r.latest_status ?? null,
          approval_date: r.approval_date ?? null,
          r1_drafting_plan: r.r1_drafting_plan ?? null,   r1_drafting_actual: r.r1_drafting_actual ?? null,
          r1_submission_plan: r.r1_submission_plan ?? null, r1_submission_actual: r.r1_submission_actual ?? null,
          r1_dar_plan: r.r1_dar_plan ?? null,             r1_dar_actual: r.r1_dar_actual ?? null,
          r2_drafting_plan: r.r2_drafting_plan ?? null,   r2_drafting_actual: r.r2_drafting_actual ?? null,
          r2_submission_plan: r.r2_submission_plan ?? null, r2_submission_actual: r.r2_submission_actual ?? null,
          r2_dar_plan: r.r2_dar_plan ?? null,             r2_dar_actual: r.r2_dar_actual ?? null,
          r3_drafting_plan: r.r3_drafting_plan ?? null,   r3_drafting_actual: r.r3_drafting_actual ?? null,
          r3_submission_plan: r.r3_submission_plan ?? null, r3_submission_actual: r.r3_submission_actual ?? null,
          r3_dar_plan: r.r3_dar_plan ?? null,             r3_dar_actual: r.r3_dar_actual ?? null,
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
      });

      // Which existed before?
      const nums = chunk.map((r) => r.abd_number);
      const { data: existingRows } = await supa
        .from("abd_items_raw")
        .select("abd_number")
        .eq("team", data.team)
        .in("abd_number", nums);
      const existingSet = new Set((existingRows ?? []).map((x: any) => x.abd_number));

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
      }
    }

    // 3) inactivate missing rows in same team+plot
    let inactivated = 0;
    if (data.inactivate_missing && seenNumbers.size > 0) {
      const { data: allActive } = await supa
        .from("abd_items_raw")
        .select("id, abd_number, plot")
        .eq("team", data.team)
        .eq("is_active", true);
      const scopeRows = (allActive ?? []).filter((r: any) => (data.plot ? r.plot === data.plot : true));
      const missing = scopeRows.filter((r: any) => !seenNumbers.has(r.abd_number));
      const missingIds = missing.map((r: any) => r.id);
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
        for (const m of missing) {
          rowLogs.push({
            upload_id: batchId,
            team: data.team,
            abd_number: m.abd_number,
            action_taken: "inactivated",
            reason_code: "missing_in_upload",
            reason_detail: `missing_in_upload:${batchId}`,
          });
        }
      }
    }

    // 3.5) persist row logs (chunked to keep request size reasonable)
    for (let i = 0; i < rowLogs.length; i += 500) {
      await supa.from("abd_import_row_logs").insert(rowLogs.slice(i, i + 500));
    }

    // 4) finalize log
    await supa
      .from("abd_import_logs")
      .update({
        inserted, updated, inactivated, mismatched: 0,
        status: "success",
        finished_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    return { batch_id: batchId, inserted, updated, inactivated, total: rowsToImport.length };
  });