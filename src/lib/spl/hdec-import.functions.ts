import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";

/**
 * SPL HDEC 임포트 (왕복 임포트).
 * - 매칭 키: spl_number (Aconex 시딩본이 그대로 돌아오므로 전건 매칭이 정상 상태)
 * - 빈값 규약: 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도
 * - 삭제 규모 가드: spl_settings.delete_guard (pct, min_count) 초과 시 중단 → 사용자 승인 필요
 * - 권위 모델: Aconex 정본 실적(APPROVAL_DATE actual)은 대상 제외. 서버 RPC 가 위반 시 RAISE.
 * - 미매칭 아이템은 생성하지 않는다 (아이템 마스터 출발점 = Aconex).
 */

const STAGE_FIELDS = ["plan_start", "actual_start", "plan_finish", "actual_finish", "flag_value"] as const;
const ITEM_FIELDS = ["team", "pic", "eng", "pic_po", "eng_po", "supplier"] as const;

const RowSchema = z.object({
  spl_number: z.string().min(1),
  sheet_name: z.string(),
  plot: z.enum(["C", "D"]),
  excel_row: z.number(),
  item: z.record(z.string(), z.string().nullable()),
  stages: z.array(
    z.object({
      stage_code: z.string(),
      fields: z.record(z.enum(STAGE_FIELDS), z.string().nullable()),
    }),
  ),
});

const InputSchema = z.object({
  file_name: z.string(),
  sheet_names: z.array(z.string()).default([]),
  ocs_excluded: z.number().default(0),
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  /** 삭제 규모 가드 초과분을 사용자가 명시 승인 */
  allow_deletes: z.boolean().default(false),
  /** 클라이언트가 서버 `rcl_import_filter` 로 걸러낸 결과 요약 (감사 로그용) */
  scope_note: z.string().optional(),
  /** 클라이언트가 판정한 allowed 키 집합 — 서버가 다시 대조한다(신뢰하지 않음) */
  allowed_keys: z.array(z.string()).max(20000).optional(),
});

export type SplChange = { target: string; field: string; previous: string | null; next: string | null };

export type SplRowDiff = {
  spl_number: string;
  sheet_name: string;
  excel_row: number;
  outcome: "updated" | "unchanged" | "unmatched";
  changes: SplChange[];
};

export type SplHdecPreview = {
  total: number;
  matched: number;
  unmatched: number;
  unmatched_list: string[];
  ocs_excluded: number;
  rows_changed: number;
  cleared_values: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  delete_guard: { pct: number; min_count: number; tripped: boolean };
  diff_rows: SplRowDiff[];
};

export type SplHdecResult = SplHdecPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
};

async function assertEditor(ctx: any) {
  // RCL 정본: 역할 × 범위 격자에서 SPL/import 가 한 범위라도 열려 있어야 실행 가능.
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "SPL", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: SPL 임포트 권한이 없습니다");
  }
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

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export const importSplHdecBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<SplHdecResult> => {
    await assertEditor(context);
    const supa = context.supabase as any;

    // ★ 서버 최종 관문: SECURITY DEFINER apply 전에 행 단위 스코프를 재판정한다.
    await assertImportScope(
      supa,
      "SPL",
      "spl_number",
      ["team", "pic", "eng", "pic_po", "eng_po"],
      data.rows,
      (r) => r.spl_number,
      data.allowed_keys ?? null,
    );

    const items = await fetchAll(supa, "spl_items", "id, spl_number, team, pic, eng, pic_po, eng_po, supplier");
    const byNumber = new Map<string, any>(items.map((i) => [i.spl_number, i]));
    const progress = await fetchAll(
      supa,
      "spl_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value",
    );
    const byStage = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const { data: settingRow } = await supa.from("spl_settings").select("value").eq("key", "delete_guard").maybeSingle();
    const guardPct = Number(settingRow?.value?.pct ?? 5);
    const guardMin = Number(settingRow?.value?.min_count ?? 50);

    const fieldDiff = new Map<string, number>();
    const diffs: SplRowDiff[] = [];
    const patches: any[] = [];
    let cleared = 0;
    const unmatched: string[] = [];

    for (const row of data.rows) {
      const existing = byNumber.get(row.spl_number);
      if (!existing) {
        unmatched.push(row.spl_number);
        diffs.push({ ...pick(row), outcome: "unmatched", changes: [] });
        continue;
      }
      const changes: SplChange[] = [];
      const itemPatch: Record<string, string | null> = {};
      for (const f of ITEM_FIELDS) {
        if (!(f in row.item)) continue; // 컬럼 부재 = 미제공
        const next = s(row.item[f]);
        const prev = s(existing[f]);
        if (next === prev) continue;
        itemPatch[f] = next;
        changes.push({ target: "item", field: f, previous: prev, next });
        fieldDiff.set(f, (fieldDiff.get(f) ?? 0) + 1);
        if (prev !== null && next === null) cleared += 1;
      }

      const stagePatches: any[] = [];
      for (const st of row.stages) {
        const cur = byStage.get(`${existing.id}|${st.stage_code}`) ?? {};
        const patch: Record<string, string | null> = {};
        for (const f of STAGE_FIELDS) {
          if (!(f in st.fields)) continue; // 컬럼 부재 = 미제공
          const next = s((st.fields as any)[f]);
          const prev = s((cur as any)[f]);
          if (next === prev) continue;
          patch[f] = next;
          const key = `${st.stage_code}.${f}`;
          changes.push({ target: st.stage_code, field: f, previous: prev, next });
          fieldDiff.set(key, (fieldDiff.get(key) ?? 0) + 1);
          if (prev !== null && next === null) cleared += 1;
        }
        if (Object.keys(patch).length > 0) stagePatches.push({ stage_code: st.stage_code, ...patch });
      }

      diffs.push({ ...pick(row), outcome: changes.length > 0 ? "updated" : "unchanged", changes });
      if (changes.length > 0) {
        patches.push({
          spl_number: row.spl_number,
          item: itemPatch,
          stages: stagePatches,
        });
      }
    }

    const rowsChanged = diffs.filter((d) => d.outcome === "updated").length;
    const denominator = Math.max(data.rows.length, 1);
    const tripped = cleared > 0 && (cleared >= guardMin || (cleared * 100) / denominator >= guardPct);

    const preview: SplHdecPreview = {
      total: data.rows.length,
      matched: data.rows.length - unmatched.length,
      unmatched: unmatched.length,
      unmatched_list: unmatched.slice(0, 200),
      ocs_excluded: data.ocs_excluded,
      rows_changed: rowsChanged,
      cleared_values: cleared,
      field_diff_counts: Array.from(fieldDiff.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      delete_guard: { pct: guardPct, min_count: guardMin, tripped },
      diff_rows: diffs.filter((d) => d.outcome !== "unchanged").slice(0, 300),
    };

    if (!data.apply) {
      return { ...preview, applied: false, batch_id: null, items_updated: 0, stages_upserted: 0 };
    }
    if (tripped && !data.allow_deletes) {
      throw new Error(
        `삭제 규모 가드 작동: 값 삭제 ${cleared}건 (임계 ${guardPct}% 또는 ${guardMin}건). 승인 후 다시 실행하세요.`,
      );
    }

    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("spl_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: data.sheet_names,
        total_rows: data.rows.length,
        matched: preview.matched,
        unmatched: preview.unmatched,
        ocs_excluded: data.ocs_excluded,
        cleared_values: cleared,
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
    try {
      const CHUNK = 200;
      for (let i = 0; i < patches.length; i += CHUNK) {
        const slice = patches.slice(i, i + CHUNK);
        const { data: res, error } = await supa.rpc("spl_hdec_apply", {
          _batch_id: batchId,
          _patches: slice,
          _allow_deletes: true, // 가드는 서버 fn 에서 이미 판정·승인 처리
          _delete_count: 0,
        });
        if (error) throw new Error(error.message);
        itemsUpdated += Number(res?.items_updated ?? 0);
        stagesUpserted += Number(res?.stages_upserted ?? 0);
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await supa
        .from("spl_import_logs")
        .update({ status: "failed", note: `SPL HDEC import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    // 행 단위 로그 (TM 수준)
    const rowLogs = diffs.map((d) => ({
      batch_id: batchId,
      sheet_name: d.sheet_name,
      excel_row: d.excel_row,
      spl_number: d.spl_number,
      outcome: d.outcome,
      code: d.outcome === "unmatched" ? "no_match" : d.outcome === "updated" ? "applied" : "unchanged",
      detail:
        d.outcome === "unmatched"
          ? "Aconex 마스터에 없는 번호 — 신규 생성하지 않음"
          : `${d.changes.length} field(s) changed`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("spl_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[spl row logs]", error.message);
    }

    await supa
      .from("spl_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        finished_at: new Date().toISOString(),
        note: `rows=${data.rows.length} changed=${rowsChanged} cleared=${cleared} unmatched=${unmatched.length} ocs_excluded=${data.ocs_excluded}${data.scope_note ? ` ${data.scope_note}` : ""}`,
      })
      .eq("id", batchId);

    return { ...preview, applied: true, batch_id: batchId, items_updated: itemsUpdated, stages_upserted: stagesUpserted };
  });

function pick(row: { spl_number: string; sheet_name: string; excel_row: number }) {
  return { spl_number: row.spl_number, sheet_name: row.sheet_name, excel_row: row.excel_row };
}