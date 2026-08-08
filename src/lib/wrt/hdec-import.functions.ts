import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";

/**
 * WRT HDEC 임포트 (왕복 임포트).
 * - 매칭 키: wrt_number (Aconex 시딩본이 그대로 돌아오므로 전건 매칭이 정상 상태)
 * - 빈값 규약: 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도
 * - 삭제 규모 가드: wrt_settings.delete_guard (pct, min_count) 초과 시 중단 → 사용자 승인 필요
 * - 권위 모델(2026-08-05 변경): 회신코드 · Latest Status · Final Approved 는 여전히 대상 제외.
 *   단 Aconex 축 실적(RESPONSE_DATE_R1/R2 actual)은 **값이 있을 때만** 반영한다.
 *   빈칸은 기존 값을 절대 지우지 않는다.
 * - 미매칭 아이템은 신규 생성한다 (HDEC 파일이 마스터).
 */

const STAGE_FIELDS = ["plan_start", "actual_start", "plan_finish", "actual_finish", "flag_value"] as const;
const ITEM_FIELDS = ["team", "pic", "eng"] as const;
/** Aconex 권위 단계 — actual 은 값이 있을 때만 반영 (빈칸 무시) */
const ACONEX_STAGES = new Set(["RESPONSE_DATE_R1", "RESPONSE_DATE_R2"]);

function isAconexNoClear(stageCode: string, field: string, next: string | null): boolean {
  return next === null && ACONEX_STAGES.has(stageCode) && (field === "actual_start" || field === "actual_finish");
}

const RowSchema = z.object({
  wrt_number: z.string().min(1),
  sheet_name: z.string(),
  plot: z.enum(["C", "D"]),
  excel_row: z.number(),
  item: z.record(z.string(), z.string().nullable()),
  stages: z.array(
    z.object({
      stage_code: z.string(),
      // 컬럼 부재 = 미제공이므로 부분 레코드여야 한다 (z.record + enum 은 전 키 필수)
      fields: z.partialRecord(z.enum(STAGE_FIELDS), z.string().nullable()),
      na: z.boolean().optional(),
    }),
  ),
});

const InputSchema = z.object({
  file_name: z.string(),
  sheet_names: z.array(z.string()).default([]),
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  allow_deletes: z.boolean().default(false),
  /** 클라이언트가 서버 `rcl_import_filter` 로 걸러낸 결과 요약 (감사 로그용) */
  scope_note: z.string().optional(),
  /** 클라이언트가 판정한 allowed 키 집합 — 서버가 다시 대조한다(신뢰하지 않음) */
  allowed_keys: z.array(z.string()).max(20000).optional(),
});

export type WrtChange = { target: string; field: string; previous: string | null; next: string | null };

export type WrtRowDiff = {
  wrt_number: string;
  sheet_name: string;
  excel_row: number;
  outcome: "updated" | "unchanged" | "created";
  changes: WrtChange[];
};

export type WrtHdecPreview = {
  total: number;
  matched: number;
  unmatched: number;
  unmatched_list: string[];
  /** 파일에만 있어 새로 만드는(만든) 행 */
  created: number;
  created_list: string[];
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
  items_created: number;
  /** 임포트 후 감시 지표: pending_hdec(위반 아님, 감소해야 함) / violation(진짜 위반) */
  integrity: { pending_hdec: number; pending_hdec_r1: number; pending_hdec_r2: number; violation: number };
};

async function readIntegrity(supa: any) {
  const { data, error } = await supa.from("wrt_precedence_violations").select("violation_type, stage_code");
  if (error) return { pending_hdec: 0, pending_hdec_r1: 0, pending_hdec_r2: 0, violation: 0 };
  const rows = (data ?? []) as Array<{ violation_type: string; stage_code: string }>;
  const pend = rows.filter((r) => r.violation_type === "pending_hdec");
  return {
    pending_hdec: pend.length,
    pending_hdec_r1: pend.filter((r) => r.stage_code === "ROUND_1").length,
    pending_hdec_r2: pend.filter((r) => r.stage_code === "ROUND_2").length,
    violation: rows.length - pend.length,
  };
}

async function assertEditor(ctx: any) {
  // RCL 정본: 역할 × 범위 격자에서 WRT/import 가 한 범위라도 열려 있어야 실행 가능.
  // 행 단위 판정은 핸들러의 `assertImportScope`(서버 `rcl_import_filter`)가 최종 관문이다.
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "WRT", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: WRT 임포트 권한이 없습니다");
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

function pick(row: { wrt_number: string; sheet_name: string; excel_row: number }) {
  return { wrt_number: row.wrt_number, sheet_name: row.sheet_name, excel_row: row.excel_row };
}

export const importWrtHdecBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<WrtHdecResult> => {
    await assertEditor(context);
    const supa = context.supabase as any;

    // ★ 서버 최종 관문: SECURITY DEFINER apply 전에 행 단위 스코프를 재판정한다.
    await assertImportScope(
      supa,
      "WRT",
      "wrt_number",
      ["team", "pic", "eng"],
      data.rows,
      (r) => r.wrt_number,
      data.allowed_keys ?? null,
    );

    const items = await fetchAll(supa, "wrt_items", "id, wrt_number, team, pic, eng");
    const byNumber = new Map<string, any>(items.map((i) => [i.wrt_number, i]));
    const progress = await fetchAll(
      supa,
      "wrt_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag",
    );
    const byStage = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const { data: settingRow } = await supa.from("wrt_settings").select("value").eq("key", "delete_guard").maybeSingle();
    const guardPct = Number(settingRow?.value?.pct ?? 5);
    const guardMin = Number(settingRow?.value?.min_count ?? 50);

    const fieldDiff = new Map<string, number>();
    const diffs: WrtRowDiff[] = [];
    const patches: any[] = [];
    let cleared = 0;
    const createdList: string[] = [];
    // allow_deletes=false 는 "값 삭제를 patch 에 담지 않는다" 로 동작한다.
    // (전체 중단이 아니라 갱신분만 반영 — 삭제는 승인 시에만 수행)
    const skipClear = (prev: string | null, next: string | null): boolean =>
      !data.allow_deletes && prev !== null && next === null;

    for (const row of data.rows) {
      const existing = byNumber.get(row.wrt_number);
      const isNew = !existing;
      if (isNew) createdList.push(row.wrt_number);
      const changes: WrtChange[] = [];
      const itemPatch: Record<string, string | null> = {};
      for (const f of ITEM_FIELDS) {
        if (!(f in row.item)) continue; // 컬럼 부재 = 미제공
        const next = s(row.item[f]);
        const prev = isNew ? null : s(existing[f]);
        if (next === prev) continue;
        if (skipClear(prev, next)) continue;
        itemPatch[f] = next;
        changes.push({ target: "item", field: f, previous: prev, next });
        fieldDiff.set(f, (fieldDiff.get(f) ?? 0) + 1);
        if (prev !== null && next === null) cleared += 1;
      }

      const stagePatches: any[] = [];
      for (const st of row.stages) {
        const cur = isNew ? {} : (byStage.get(`${existing.id}|${st.stage_code}`) ?? {});
        const patch: Record<string, string | null> = {};
        for (const f of STAGE_FIELDS) {
          if (!(f in st.fields)) continue; // 컬럼 부재 = 미제공
          const next = s((st.fields as any)[f]);
          // ★ Aconex 축: 빈칸은 기존 값을 덮지 않는다
          if (isAconexNoClear(st.stage_code, f, next)) continue;
          const prev = s((cur as any)[f]);
          if (next === prev) continue;
          if (skipClear(prev, next)) continue;
          patch[f] = next;
          const key = `${st.stage_code}.${f}`;
          changes.push({ target: st.stage_code, field: f, previous: prev, next });
          fieldDiff.set(key, (fieldDiff.get(key) ?? 0) + 1);
          if (prev !== null && next === null) cleared += 1;
        }
        // 파일의 NA 표기 = 해당 없음. 빈칸(미입력)과 구분해 na_flag 로 반영한다.
        const nextNa = st.na === true;
        const prevNa = isNew ? false : (cur as any).na_flag === true;
        let naPatch: Record<string, boolean> | null = null;
        if (nextNa !== prevNa) {
          naPatch = { na_flag: nextNa };
          changes.push({
            target: st.stage_code,
            field: "na_flag",
            previous: prevNa ? "NA" : null,
            next: nextNa ? "NA" : null,
          });
          const nk = `${st.stage_code}.na_flag`;
          fieldDiff.set(nk, (fieldDiff.get(nk) ?? 0) + 1);
        }
        if (Object.keys(patch).length > 0 || naPatch) {
          stagePatches.push({ stage_code: st.stage_code, ...patch, ...(naPatch ?? {}) });
        }
      }

      diffs.push({
        ...pick(row),
        outcome: isNew ? "created" : changes.length > 0 ? "updated" : "unchanged",
        changes,
      });
      if (isNew || changes.length > 0) {
        patches.push({ wrt_number: row.wrt_number, plot: row.plot, item: itemPatch, stages: stagePatches });
      }
    }

    const rowsChanged = diffs.filter((d) => d.outcome === "updated").length;
    const denominator = Math.max(data.rows.length, 1);
    const tripped = cleared > 0 && (cleared >= guardMin || (cleared * 100) / denominator >= guardPct);

    const preview: WrtHdecPreview = {
      total: data.rows.length,
      matched: data.rows.length - createdList.length,
      unmatched: 0,
      unmatched_list: [],
      created: createdList.length,
      created_list: createdList.slice(0, 200),
      rows_changed: rowsChanged,
      cleared_values: cleared,
      field_diff_counts: Array.from(fieldDiff.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      delete_guard: { pct: guardPct, min_count: guardMin, tripped },
      diff_rows: diffs.filter((d) => d.outcome !== "unchanged").slice(0, 300),
    };

    if (!data.apply) {
      return {
        ...preview,
        applied: false,
        batch_id: null,
        items_updated: 0,
        stages_upserted: 0,
        items_created: 0,
        integrity: await readIntegrity(supa),
      };
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
    let itemsCreated = 0;
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
        itemsCreated += Number(res?.items_created ?? 0);
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
      code: d.outcome === "created" ? "created" : d.outcome === "updated" ? "applied" : "unchanged",
      detail:
        d.outcome === "created"
          ? `파일에만 있던 번호 — 신규 생성 (${d.changes.length} field(s))`
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
        note: `rows=${data.rows.length} changed=${rowsChanged} created=${createdList.length} cleared=${cleared} unmatched=0${data.scope_note ? ` ${data.scope_note}` : ""}`,
      })
      .eq("id", batchId);

    return {
      ...preview,
      applied: true,
      batch_id: batchId,
      items_updated: itemsUpdated,
      stages_upserted: stagesUpserted,
      items_created: itemsCreated,
      integrity: await readIntegrity(supa),
    };
  });