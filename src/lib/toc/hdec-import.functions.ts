import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertImportScope } from "@/lib/import/rcl-import-gate";
import { normalizeTocCode } from "@/lib/toc/code-value";

/**
 * TOC(Handover) 왕복 임포트 서버 처리.
 * - 매칭 키: item_key (원천 Item No 는 그룹별 번호라 중복이므로 키가 될 수 없다)
 * - 빈값 규약: 컬럼 부재 = 미제공(무시) / 셀 공란 = 삭제 의도
 * - 삭제 규모 가드: toc_settings.delete_guard (pct, min_count) 초과 시 사용자 승인 필요
 * - 권위 모델: IFM·CMS 축(TOC_RESPONSE / HANDED_OVER / 교육)은 값이 있을 때만 반영한다.
 * - 권한 근거는 `rcl_grants('TOC','import')` 뿐이며, 행 스코프는 서버에서 다시 판정한다.
 * - 상태 규약: 반영 행수 = 파싱 행수 → success / 반영 0 → failed / 그 외 제외·거부 존재 → partial
 */

const STAGE_FIELDS = ["plan_start", "actual_start", "plan_finish", "actual_finish", "code_value"] as const;
const ITEM_FIELDS = [
  "plot",
  "item_no",
  "main_system",
  "sub_system",
  "location",
  "team",
  "team_raw",
  "supplier",
  "pic",
  "eng",
  "toc_ref",
  "expected_ho_date",
  "tac_qty_total",
  "tac_qty_issued",
  "abd_qty_total",
  "abd_qty_code_a",
] as const;

/** IFM·CMS 권위 단계 — 실적/코드는 값이 있을 때만 반영 (빈칸이 기존 값을 지우지 않는다) */
const EXTERNAL_STAGES = new Set(["TOC_RESPONSE", "HANDED_OVER", "TRN_CONDUCTED", "TRN_EVAL_FORM"]);
/** 교육 밴드는 세션 표가 정본 — 임포트로 쓰지 않는다 */
const READONLY_STAGES = new Set(["TRN_CONDUCTED", "TRN_EVAL_FORM"]);

function isExternalNoClear(stageCode: string, field: string, next: string | null): boolean {
  return next === null && EXTERNAL_STAGES.has(stageCode) && field !== "plan_start" && field !== "plan_finish";
}

const RowSchema = z.object({
  item_key: z.string().min(1),
  sheet_name: z.string(),
  plot: z.enum(["C", "D"]),
  excel_row: z.number(),
  item: z.record(z.string(), z.string().nullable()),
  stages: z.array(
    z.object({
      stage_code: z.string(),
      fields: z.partialRecord(z.enum(STAGE_FIELDS), z.string().nullable()),
    }),
  ),
});

const InputSchema = z.object({
  file_name: z.string(),
  sheet_names: z.array(z.string()).default([]),
  rows: z.array(RowSchema).max(20000),
  apply: z.boolean().default(false),
  allow_deletes: z.boolean().default(false),
  /** 미매핑·강등 컬럼을 사용자가 확인하고 진행에 동의했는지 (로그에 남는다) */
  accepted_unmapped: z.array(z.string()).default([]),
  scope_note: z.string().optional(),
  allowed_keys: z.array(z.string()).max(20000).optional(),
});

export type TocChange = { target: string; field: string; previous: string | null; next: string | null };

export type TocRowDiff = {
  item_key: string;
  sheet_name: string;
  excel_row: number;
  outcome: "updated" | "unchanged" | "created";
  changes: TocChange[];
};

export type TocHdecPreview = {
  total: number;
  matched: number;
  created: number;
  created_list: string[];
  rows_changed: number;
  cleared_values: number;
  field_diff_counts: Array<{ field: string; changed: number }>;
  delete_guard: { pct: number; min_count: number; tripped: boolean };
  diff_rows: TocRowDiff[];
  /** 정본이 달라 무시한 단계 셀 수 (교육 롤업) */
  readonly_skipped: number;
};

export type TocHdecResult = TocHdecPreview & {
  applied: boolean;
  batch_id: string | null;
  items_updated: number;
  stages_upserted: number;
  items_created: number;
  rejected: Array<{ key: string; reason_code: string; message: string }>;
  /** 항등식: 파싱 = 반영 + 변경없음 + 거부 + 미분류 */
  identity: { parsed: number; applied_rows: number; unchanged: number; rejected: number; unclassified: number };
  status: "success" | "partial" | "failed" | "preview";
};

async function assertEditor(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("rcl_grants", { _module: "TOC", _action: "import" });
  if (error) throw new Error(`권한 조회 실패: ${error.message}`);
  const g = data as { role: string | null; own: boolean; own_team: boolean; other_team: boolean } | null;
  if (!g?.role || !(g.own || g.own_team || g.other_team)) {
    throw new Error("권한 없음: TOC 임포트 권한이 없습니다");
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

export const importTocHdecBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => InputSchema.parse(v))
  .handler(async ({ data, context }): Promise<TocHdecResult> => {
    await assertEditor(context);
    const supa = context.supabase as any;

    assertKnownCodeValues(data.file_name, data.rows);

    await assertImportScope(
      supa,
      "TOC",
      "item_key",
      ["team", "pic", "eng"],
      data.rows,
      (r) => r.item_key,
      data.allowed_keys ?? null,
    );

    const items = await fetchAll(
      supa,
      "toc_items",
      "id, item_key, plot, item_no, main_system, sub_system, location, team, team_raw, supplier, pic, eng, toc_ref, expected_ho_date, tac_qty_total, tac_qty_issued, abd_qty_total, abd_qty_code_a",
    );
    const byKey = new Map<string, any>(items.map((i) => [i.item_key, i]));
    const progress = await fetchAll(
      supa,
      "toc_stage_progress",
      "item_id, stage_code, plan_start, actual_start, plan_finish, actual_finish, code_value",
    );
    const byStage = new Map<string, any>(progress.map((p) => [`${p.item_id}|${p.stage_code}`, p]));

    const { data: settingRow } = await supa.from("toc_settings").select("value").eq("key", "delete_guard").maybeSingle();
    const guardPct = Number(settingRow?.value?.pct ?? 5);
    const guardMin = Number(settingRow?.value?.min_count ?? 50);

    const fieldDiff = new Map<string, number>();
    const diffs: TocRowDiff[] = [];
    const patches: any[] = [];
    let cleared = 0;
    let readonlySkipped = 0;
    const createdList: string[] = [];
    const skipClear = (prev: string | null, next: string | null): boolean =>
      !data.allow_deletes && prev !== null && next === null;

    for (const row of data.rows) {
      const existing = byKey.get(row.item_key);
      const isNew = !existing;
      if (isNew) createdList.push(row.item_key);
      const changes: TocChange[] = [];
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
        if (READONLY_STAGES.has(st.stage_code)) {
          readonlySkipped += Object.keys(st.fields).length;
          continue;
        }
        const cur = isNew ? {} : (byStage.get(`${existing.id}|${st.stage_code}`) ?? {});
        const patch: Record<string, string | null> = {};
        for (const f of STAGE_FIELDS) {
          if (!(f in st.fields)) continue;
          const next = s((st.fields as any)[f]);
          if (isExternalNoClear(st.stage_code, f, next)) continue;
          const prev = s((cur as any)[f]);
          if (next === prev) continue;
          if (skipClear(prev, next)) continue;
          patch[f] = next;
          const key = `${st.stage_code}.${f}`;
          changes.push({ target: st.stage_code, field: f, previous: prev, next });
          fieldDiff.set(key, (fieldDiff.get(key) ?? 0) + 1);
          if (prev !== null && next === null) cleared += 1;
        }
        if (Object.keys(patch).length > 0) stagePatches.push({ stage_code: st.stage_code, ...patch });
      }

      diffs.push({
        item_key: row.item_key,
        sheet_name: row.sheet_name,
        excel_row: row.excel_row,
        outcome: isNew ? "created" : changes.length > 0 ? "updated" : "unchanged",
        changes,
      });
      if (isNew || changes.length > 0) {
        patches.push({ item_key: row.item_key, plot: row.plot, item: itemPatch, stages: stagePatches });
      }
    }

    const rowsChanged = diffs.filter((d) => d.outcome === "updated").length;
    const denominator = Math.max(data.rows.length, 1);
    const tripped = cleared > 0 && (cleared >= guardMin || (cleared * 100) / denominator >= guardPct);

    const preview: TocHdecPreview = {
      total: data.rows.length,
      matched: data.rows.length - createdList.length,
      created: createdList.length,
      created_list: createdList.slice(0, 200),
      rows_changed: rowsChanged,
      cleared_values: cleared,
      field_diff_counts: Array.from(fieldDiff.entries())
        .map(([field, changed]) => ({ field, changed }))
        .sort((a, b) => b.changed - a.changed),
      delete_guard: { pct: guardPct, min_count: guardMin, tripped },
      diff_rows: diffs.filter((d) => d.outcome !== "unchanged").slice(0, 300),
      readonly_skipped: readonlySkipped,
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
        identity: {
          parsed: data.rows.length,
          applied_rows: 0,
          unchanged: data.rows.length - rowsChanged - createdList.length,
          rejected: 0,
          unclassified: 0,
        },
        status: "preview",
      };
    }
    if (tripped && !data.allow_deletes) {
      throw new Error(
        `삭제 규모 가드 작동: 값 삭제 ${cleared}건 (임계 ${guardPct}% 또는 ${guardMin}건). 승인 후 다시 실행하세요.`,
      );
    }

    const nowIso = new Date().toISOString();
    const { data: logRow, error: logErr } = await supa
      .from("toc_import_logs")
      .insert({
        file_name: data.file_name,
        sheet_names: data.sheet_names,
        total_rows: data.rows.length,
        matched: preview.matched,
        unmatched: 0,
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
        const { data: res, error } = await supa.rpc("toc_hdec_apply", {
          _batch_id: batchId,
          _patches: patches.slice(i, i + CHUNK),
          _allow_deletes: true, // 가드는 위에서 이미 판정·승인 처리했다
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
        .from("toc_import_logs")
        .update({ status: "failed", note: `TOC HDEC import FAILED — ${msg}`, finished_at: new Date().toISOString() })
        .eq("id", batchId);
      throw new Error(msg);
    }

    const rejectedKeys = new Set(rejected.map((r) => r.key));
    const unchanged = diffs.filter((d) => d.outcome === "unchanged").length;
    const appliedRows = diffs.filter((d) => d.outcome !== "unchanged" && !rejectedKeys.has(d.item_key)).length;
    const unclassified = data.rows.length - (appliedRows + unchanged + rejectedKeys.size);
    const status: "success" | "partial" | "failed" =
      appliedRows + unchanged === data.rows.length && rejected.length === 0
        ? "success"
        : appliedRows === 0 && rowsChanged + createdList.length > 0
          ? "failed"
          : "partial";

    const rowLogs = diffs.map((d) => ({
      batch_id: batchId,
      sheet_name: d.sheet_name,
      excel_row: d.excel_row,
      item_key: d.item_key,
      outcome: rejectedKeys.has(d.item_key) ? "rejected" : d.outcome,
      code: rejectedKeys.has(d.item_key)
        ? "rejected"
        : d.outcome === "created"
          ? "created"
          : d.outcome === "updated"
            ? "applied"
            : "unchanged",
      detail: rejectedKeys.has(d.item_key)
        ? (rejected.find((r) => r.key === d.item_key)?.message ?? "rejected")
        : `${d.changes.length} field(s) changed`,
      changes: d.changes,
    }));
    for (let i = 0; i < rowLogs.length; i += 500) {
      const { error } = await supa.from("toc_import_row_logs").insert(rowLogs.slice(i, i + 500));
      if (error) console.warn("[toc row logs]", error.message);
    }

    await supa
      .from("toc_import_logs")
      .update({
        items_updated: itemsUpdated,
        stages_upserted: stagesUpserted,
        status,
        finished_at: new Date().toISOString(),
        note: `rows=${data.rows.length} changed=${rowsChanged} created=${createdList.length} cleared=${cleared} rejected=${rejected.length} unchanged=${unchanged} unclassified=${unclassified} readonly_skipped=${readonlySkipped}${
          data.accepted_unmapped.length > 0 ? ` accepted_unmapped=[${data.accepted_unmapped.join("; ")}]` : ""
        }${data.scope_note ? ` ${data.scope_note}` : ""}`,
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
      identity: { parsed: data.rows.length, applied_rows: appliedRows, unchanged, rejected: rejected.length, unclassified },
      status,
    };
  });

/** 사전이 있는 단계에서 미등록 상태 코드가 오면 값·건수·예시와 함께 저장을 거부한다 (추측 금지). */
function assertKnownCodeValues(
  fileName: string,
  rows: Array<{ item_key: string; sheet_name: string; excel_row: number; stages: Array<{ stage_code: string; fields: any }> }>,
) {
  const buckets = new Map<string, { count: number; samples: string[] }>();
  for (const row of rows) {
    for (const st of row.stages) {
      if (!("code_value" in st.fields)) continue;
      const raw = st.fields.code_value;
      if (raw == null || String(raw).trim() === "") continue;
      const res = normalizeTocCode(st.stage_code, raw);
      if (!res.invalid) continue;
      const key = `${st.stage_code} / "${res.invalid}"`;
      const b = buckets.get(key) ?? { count: 0, samples: [] };
      b.count += 1;
      if (b.samples.length < 3) b.samples.push(`${row.item_key} (${fileName} / ${row.sheet_name} / ${row.excel_row}행)`);
      buckets.set(key, b);
    }
  }
  if (buckets.size === 0) return;
  const lines = Array.from(buckets.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([k, b]) => `· ${k} ${b.count}건 — 예: ${b.samples.join(" / ")}`);
  throw new Error(["상태 코드 값이 사전에 없어 저장을 중단했습니다. 파일 값을 고친 뒤 다시 실행하세요.", ...lines].join("\n"));
}
