import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * WRT HDEC 임포트 (왕복 임포트).
 * - 매칭 키: wrt_number (Aconex 시딩본이 그대로 돌아오므로 전건 매칭이 정상 상태)
 * - 빈값 규약: 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도
 * - 삭제 규모 가드: wrt_settings.delete_guard (pct, min_count) 초과 시 중단 → 사용자 승인 필요
 * - 권위 모델: Aconex 정본(회신코드 · 회신일 Actual · Latest Status · Final Approved)은 대상 제외.
 *   서버 RPC(wrt_hdec_apply) 가 위반 시 RAISE.
 * - 미매칭 아이템은 생성하지 않는다 (아이템 마스터 출발점 = Aconex).
 */

const STAGE_FIELDS = ["plan_start", "actual_start", "plan_finish", "actual_finish", "flag_value"] as const;
const ITEM_FIELDS = ["team", "pic", "eng"] as const;

const RowSchema = z.object({
  wrt_number: z.string().min(1),
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
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  allow_deletes: z.boolean().default(false),
});

export type WrtChange = { target: string; field: string; previous: string | null; next: string | null };

export type WrtRowDiff = {
  wrt_number: string;
  sheet_name: string;
  excel_row: number;
  outcome: "updated" | "unchanged" | "unmatched";
  changes: WrtChange[];
};

export type WrtHdecPreview = {
  total: number;
  matched: number;
  unmatched: number;
  unmatched_list: string[];
  rows_changed: number;
  cleared_values: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  delete_guard: { pct: number; min_count: number; tripped: boolean };
  diff_rows: WrtRowDiff[];
};

export type WrtHdecResult = WrtHdecPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
};

async function assertEditor(ctx: any) {
  const [{ data: isAdmin }, { data: isSuper }, { data: isD }] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superuser" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "d_superuser" }),
  ]);
  if (!isAdmin && !isSuper && !isD) throw new Error("권한 없음: 관리자만 WRT 임포트를 실행할 수 있습니다");
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

function pick(row: { wrt_number: string; sheet_name: string; excel_row: number }) {
  return { wrt_number: row.wrt_number, sheet_name: row.sheet_name, excel_row: row.excel_row };
}

export const importWrtHdecBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<WrtHdecResult> => {
    await assertEditor(context);
    const supa = context.supabase as any;

    const items = await fetchAll(supa, "wrt_items", "id, wrt_number, team, pic, eng");
    const byNumber = new Map<string, any>(items.map((i) => [i.wrt_number, i]));
    const progress = await fetchAll(
      supa,
      "wrt_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value",
    );
    const byStage = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const { data: settingRow } = await supa.from("wrt_settings").select("value").eq("key", "delete_guard").maybeSingle();
    const guardPct = Number(settingRow?.value?.pct ?? 5);
    const guardMin = Number(settingRow?.value?.min_count ?? 50);

    const fieldDiff = new Map<string, number>();
    const diffs: WrtRowDiff[] = [];
    const patches: any[] = [];
    let cleared = 0;
    const unmatched: string[] = [];

    for (const row of data.rows) {
      const existing = byNumber.get(row.wrt_number);
      if (!existing) {
        unmatched.push(row.wrt_number);
        diffs.push({ ...pick(row), outcome: "unmatched", changes: [] });
        continue;
      }
      const changes: WrtChange[] = [];
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
        patches.push({ wrt_number: row.wrt_number, item: itemPatch, stages: stagePatches });
      }
    }

    const rowsChanged = diffs.filter((d) => d.outcome === "updated").length;
    const denominator = Math.max(data.rows.length, 1);
    const tripped = cleared > 0 && (cleared >= guardMin || (cleared * 100) / denominator >= guardPct);

    const preview: WrtHdecPreview = {
      total: data.rows.length,
      matched: data.rows.length - unmatched.length,
      unmatched: unmatched.length,
      unmatched_list: unmatched.slice(0, 200),
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
      .from("wrt_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: data.sheet_names,
        total_rows: data.rows.length,
        matched: preview.matched,
        unmatched: preview.unmatched,
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
        const { data: res, error } = await supa.rpc("wrt_hdec_apply", {
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
        .from("wrt_import_logs")
        .update({ status: "failed", note: `WRT HDEC import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    const rowLogs = diffs.map((d) => ({
      batch_id: batchId,
      sheet_name: d.sheet_name,
      excel_row: d.excel_row,
      wrt_number: d.wrt_number,
      outcome: d.outcome,
      code: d.outcome === "unmatched" ? "no_match" : d.outcome === "updated" ? "applied" : "unchanged",
      detail:
        d.outcome === "unmatched"
          ? "Aconex 마스터에 없는 번호 — 신규 생성하지 않음"
          : `${d.changes.length} field(s) changed`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("wrt_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[wrt row logs]", error.message);
    }

    await supa
      .from("wrt_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        finished_at: new Date().toISOString(),
        note: `rows=${data.rows.length} changed=${rowsChanged} cleared=${cleared} unmatched=${unmatched.length}`,
      })
      .eq("id", batchId);

    return { ...preview, applied: true, batch_id: batchId, items_updated: itemsUpdated, stages_upserted: stagesUpserted };
  });