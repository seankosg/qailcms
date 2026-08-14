import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";
import { normalizeSplFlagValue, SPL_FLAG_UNKNOWN } from "@/lib/spl/flag-value";

/**
 * SPL HDEC 임포트 (왕복 임포트).
 * - 매칭 키: spl_number (Aconex 시딩본이 그대로 돌아오므로 전건 매칭이 정상 상태)
 * - 빈값 규약: 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도
 * - 삭제 규모 가드: spl_settings.delete_guard (pct, min_count) 초과 시 중단 → 사용자 승인 필요
 * - 권위 모델(2026-08-05 변경): Aconex 축(APPROVAL_DATE actual)은 **값이 있을 때만** 반영한다.
 *   빈칸은 기존 값을 지우지 않는다.
 * - 미매칭 아이템은 신규 생성한다 (HDEC 파일이 마스터).
 */

const STAGE_FIELDS = ["plan_start", "actual_start", "plan_finish", "actual_finish", "flag_value"] as const;
const ITEM_FIELDS = ["team", "pic", "eng", "pic_po", "eng_po", "supplier", "plot"] as const;
/** Aconex 권위 단계 — actual 은 값이 있을 때만 반영 (빈칸 무시) */
const ACONEX_STAGES = new Set(["APPROVAL_DATE"]);

function isAconexNoClear(stageCode: string, field: string, next: string | null): boolean {
  return next === null && ACONEX_STAGES.has(stageCode) && (field === "actual_start" || field === "actual_finish");
}

const RowSchema = z.object({
  spl_number: z.string().min(1),
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
  outcome: "updated" | "unchanged" | "created";
  changes: SplChange[];
};

export type SplHdecPreview = {
  total: number;
  matched: number;
  unmatched: number;
  unmatched_list: string[];
  created: number;
  created_list: string[];
  ocs_excluded: number;
  rows_changed: number;
  cleared_values: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  delete_guard: { pct: number; min_count: number; tripped: boolean };
  diff_rows: SplRowDiff[];
  /** A-5: Aconex 단계 계획일(plan) 공란 건수 — 비면 그 단계 지연이 판정되지 않는다 */
  aconex_plan_missing: Array<{ stage_code: string; short_code: string; label: string; missing: number; total: number }>;
};

export type SplHdecResult = SplHdecPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
  items_created: number;
  /** C-3: 쓰기 가드에 걸려 거부된 행 (message 는 DB 원문 그대로) */
  rejected: Array<{ key: string; reason_code: string; message: string }>;
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

    // ★ Required Document 어휘 관문: 사전에 없는 값이 하나라도 있으면 저장하지 않는다(추측 금지).
    assertKnownFlagValues(data.file_name, data.rows);

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

    const items = await fetchAll(supa, "spl_items", "id, spl_number, plot, team, pic, eng, pic_po, eng_po, supplier");
    const byNumber = new Map<string, any>(items.map((i) => [i.spl_number, i]));
    const progress = await fetchAll(
      supa,
      "spl_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, flag_value, na_flag",
    );
    const byStage = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const { data: settingRow } = await supa.from("spl_settings").select("value").eq("key", "delete_guard").maybeSingle();
    const guardPct = Number(settingRow?.value?.pct ?? 5);
    const guardMin = Number(settingRow?.value?.min_count ?? 50);

    const fieldDiff = new Map<string, number>();
    const diffs: SplRowDiff[] = [];
    const patches: any[] = [];
    let cleared = 0;
    const createdList: string[] = [];
    // A-5: Aconex 단계 계획일 공란 집계 (반영 후 상태 기준)
    const planSeen = new Map<string, number>();
    const planMissing = new Map<string, number>();
    // allow_deletes=false 는 "값 삭제를 patch 에 담지 않는다" 로 동작한다.
    // (전체 중단이 아니라 갱신분만 반영 — 삭제는 승인 시에만 수행)
    const skipClear = (prev: string | null, next: string | null): boolean =>
      !data.allow_deletes && prev !== null && next === null;

    for (const row of data.rows) {
      const existing = byNumber.get(row.spl_number);
      const isNew = !existing;
      if (isNew) createdList.push(row.spl_number);
      const changes: SplChange[] = [];
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
        if (ACONEX_STAGES.has(st.stage_code)) {
          const resolvedPlan =
            "plan_start" in st.fields ? s((st.fields as any).plan_start) : s((cur as any).plan_start);
          planSeen.set(st.stage_code, (planSeen.get(st.stage_code) ?? 0) + 1);
          if (resolvedPlan === null) planMissing.set(st.stage_code, (planMissing.get(st.stage_code) ?? 0) + 1);
        }
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
        patches.push({
          spl_number: row.spl_number,
          plot: row.plot,
          item: itemPatch,
          stages: stagePatches,
        });
      }
    }

    const rowsChanged = diffs.filter((d) => d.outcome === "updated").length;
    const denominator = Math.max(data.rows.length, 1);
    const tripped = cleared > 0 && (cleared >= guardMin || (cleared * 100) / denominator >= guardPct);

    const { data: catRows } = await supa
      .from("spl_stage_catalog")
      .select("stage_code, short_code, label, sort_order")
      .order("sort_order");
    const aconexPlanMissing = ((catRows ?? []) as any[])
      .filter((c) => ACONEX_STAGES.has(c.stage_code))
      .map((c) => ({
        stage_code: c.stage_code as string,
        short_code: c.short_code as string,
        label: c.label as string,
        missing: planMissing.get(c.stage_code) ?? 0,
        total: planSeen.get(c.stage_code) ?? 0,
      }));

    const preview: SplHdecPreview = {
      total: data.rows.length,
      matched: data.rows.length - createdList.length,
      unmatched: 0,
      unmatched_list: [],
      created: createdList.length,
      created_list: createdList.slice(0, 200),
      ocs_excluded: data.ocs_excluded,
      rows_changed: rowsChanged,
      cleared_values: cleared,
      field_diff_counts: Array.from(fieldDiff.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      delete_guard: { pct: guardPct, min_count: guardMin, tripped },
      diff_rows: diffs.filter((d) => d.outcome !== "unchanged").slice(0, 300),
      aconex_plan_missing: aconexPlanMissing,
    };

    if (!data.apply) {
      return {
        ...preview,
        applied: false,
        batch_id: null,
        items_updated: 0,
        stages_upserted: 0,
        items_created: 0,
        rejected: [],
      };
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
    let itemsCreated = 0;
    const rejected: Array<{ key: string; reason_code: string; message: string }> = [];
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
        itemsCreated += Number(res?.items_created ?? 0);
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
      code: d.outcome === "created" ? "created" : d.outcome === "updated" ? "applied" : "unchanged",
      detail:
        d.outcome === "created"
          ? `파일에만 있던 번호 — 신규 생성 (${d.changes.length} field(s))`
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
        note: `rows=${data.rows.length} changed=${rowsChanged} created=${createdList.length} cleared=${cleared} unmatched=0 rejected=${rejected.length} ocs_excluded=${data.ocs_excluded}${data.scope_note ? ` ${data.scope_note}` : ""}`,
      })
      .eq("id", batchId);

    return {
      ...preview,
      applied: true,
      batch_id: batchId,
      items_updated: itemsUpdated,
      stages_upserted: stagesUpserted,
      items_created: itemsCreated,
      rejected,
    };
  });

function pick(row: { spl_number: string; sheet_name: string; excel_row: number }) {
  return { spl_number: row.spl_number, sheet_name: row.sheet_name, excel_row: row.excel_row };
}

/**
 * 사전(flag-value.ts)에 없는 Required Document 값을 값·건수·예시와 함께 보고하고 저장을 거부한다.
 * 자동 추측은 하지 않는다 — 모르면 막는 것이 정책이다.
 */
function assertKnownFlagValues(
  fileName: string,
  rows: Array<{ spl_number: string; sheet_name: string; excel_row: number; stages: Array<{ stage_code: string; fields: any }> }>,
) {
  const buckets = new Map<string, { count: number; samples: string[] }>();
  for (const row of rows) {
    for (const st of row.stages) {
      if (!("flag_value" in st.fields)) continue;
      const raw = st.fields.flag_value;
      if (normalizeSplFlagValue(raw) !== SPL_FLAG_UNKNOWN) continue;
      const key = String(raw);
      const b = buckets.get(key) ?? { count: 0, samples: [] };
      b.count += 1;
      if (b.samples.length < 3) {
        b.samples.push(`${row.spl_number} (${fileName} / ${row.sheet_name} / ${row.excel_row}행, ${st.stage_code})`);
      }
      buckets.set(key, b);
    }
  }
  if (buckets.size === 0) return;
  const lines = Array.from(buckets.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([value, b]) => `· "${value}" ${b.count}건 — 예: ${b.samples.join(" / ")}`);
  throw new Error(
    [
      "Required Document 값이 사전에 없어 저장을 중단했습니다. 파일에서 값을 고친 뒤 다시 실행하세요.",
      "허용 값: REQUIRED 계열(REQUIRED, O, yes, Not yet, 지정 서술 4종) / N/A 계열(N/A, X, 0) / 빈 칸",
      ...lines,
    ].join("\n"),
  );
}