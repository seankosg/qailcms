import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DISCIPLINES = ["ARCH", "ELEC", "MECH", "DESN", "PRJC"] as const;

const AddChildSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  main_task_no: z.string().min(1),
  task_name: z.string().min(1).max(500),
  sub_task_desc: z.string().max(2000).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  hdec_pic_name: z.string().max(200).nullable().optional(),
  hdec_eng_name: z.string().max(200).nullable().optional(),
  floor_level: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  row_type: z.string().max(50).nullable().optional(),
  status_manual: z.string().max(50).nullable().optional(),
  risk: z.string().max(50).nullable().optional(),
  plan_start: z.string().nullable().optional(),
  plan_end: z.string().nullable().optional(),
});

/** RCL 정본 — 부모 행에 대한 write 판정. 규칙은 DB `rcl_can` 하나뿐이다. */
async function assertRclRow(
  context: { supabase: any; userId: string },
  rowId: string,
  action: "write" | "delete" = "write",
) {
  const { data, error } = await context.supabase.rpc("rcl_can", {
    _user_id: context.userId,
    _module: "TM",
    _row_id: rowId,
    _action: action,
  });
  if (error) throw new Error(`권한 판정 실패: ${error.message}`);
  if (data !== true) throw new Error("권한 없음: 이 과업에 하위 태스크를 추가할 수 없습니다");
}

/** RCL 정본 — 생성될 행의 값(담당자·팀)에 대한 판정. */
/**
 * ⛔ 임시 조치: Work Type(row_type) 신규 값 생성은 admin 만 가능.
 * 비관리자는 이미 존재하는 값만 지정할 수 있다.
 */
async function assertWorkTypeAllowed(
  context: { supabase: any; userId: string },
  values: (string | null | undefined)[],
) {
  const wanted = Array.from(
    new Set(values.map((v) => (v ?? "").trim()).filter((v) => v.length > 0)),
  );
  if (wanted.length === 0) return;
  const { data: isAdmin, error: rErr } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (rErr) throw new Error(`권한 판정 실패: ${rErr.message}`);
  if (isAdmin === true) return;
  const { data: rows, error } = await context.supabase
    .from("task_management_raw")
    .select("row_type")
    .in("row_type", wanted);
  if (error) throw new Error(error.message);
  const existing = new Set(((rows ?? []) as any[]).map((r) => String(r.row_type)));
  const invalid = wanted.filter((v) => !existing.has(v));
  if (invalid.length > 0) {
    throw new Error(
      `권한 없음: Work Type 신규 값은 현재 관리자만 등록할 수 있습니다(임시 조치) — ${invalid.join(", ")}`,
    );
  }
}

async function assertRclValues(
  context: { supabase: any; userId: string },
  values: Record<string, unknown>,
  action: "write" = "write",
  message = "권한 없음: 지정한 담당자/팀 범위에는 등록할 수 없습니다",
) {
  const { data, error } = await context.supabase.rpc("rcl_can_values", {
    _module: "TM",
    _values: values,
    _action: action,
  });
  if (error) throw new Error(`권한 판정 실패: ${error.message}`);
  if (data !== true) throw new Error(message);
}

/**
 * 부모 task 아래에 새 자식 task를 추가한다.
 * - task_no: main_task_no + "-NN" (자동 채번, 2자리)
 * - 부모가 leaf였다면 level='main'로 승격
 * - sort_order는 부모 가족(부모 + 자식들)의 max 다음으로 삽입, 이후 행은 +1 shift
 */
export const addChildTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => AddChildSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    // 1) 부모 확인
    const { data: parent, error: pErr } = await admin
      .from("task_management_raw")
      .select("id, task_no, discipline, level, sort_order, category, plot, task_name, risk, data_date, source_file, team")
      .eq("discipline", data.discipline)
      .eq("task_no", data.main_task_no)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent) throw new Error(`Main Task '${data.main_task_no}'을(를) 찾을 수 없습니다`);

    // 1-1) 권한: 부모 행 write + 생성될 자식의 담당자/팀 범위
    await assertRclRow(context, parent.id as string, "write");
    await assertRclValues(context, {
      hdec_pic_name: data.hdec_pic_name ?? null,
      hdec_eng_name: data.hdec_eng_name ?? null,
      team: parent.team ?? null,
    });

    // 2) 채번: DB advisory lock 기반 RPC (경합 안전)
    const { data: allocated, error: allocErr } = await admin.rpc("allocate_task_no", {
      _discipline: data.discipline,
      _main_task_no: parent.task_no,
    });
    if (allocErr) throw new Error(allocErr.message);
    const newTaskNo = String(allocated);

    // sort_order shift 계산용 max값
    const { data: siblings } = await admin
      .from("task_management_raw")
      .select("sort_order")
      .eq("discipline", data.discipline)
      .like("task_no", `${parent.task_no}-%`);
    let maxSort = Number(parent.sort_order ?? 0);
    for (const s of siblings ?? []) {
      const so = Number(s.sort_order ?? 0);
      if (so > maxSort) maxSort = so;
    }

    // 3) 뒤 행들 sort_order shift (충돌 방지) — 큰 값부터 내려가며 +1
    const insertSort = maxSort + 1;
    const { data: toShift, error: fetchErr } = await admin
      .from("task_management_raw")
      .select("id, sort_order")
      .eq("discipline", data.discipline)
      .gt("sort_order", maxSort)
      .order("sort_order", { ascending: false });
    if (fetchErr) throw new Error(fetchErr.message);
    for (const row of toShift ?? []) {
      const { error: uErr } = await admin
        .from("task_management_raw")
        .update({ sort_order: Number(row.sort_order) + 1 })
        .eq("id", row.id);
      if (uErr) throw new Error(uErr.message);
    }

    // 4) 부모 level 승격
    if (parent.level !== "main") {
      const { error: upErr } = await admin
        .from("task_management_raw")
        .update({ level: "main" })
        .eq("id", parent.id);
      if (upErr) throw new Error(upErr.message);
    }

    // 5) 자식 삽입
    const payload: Record<string, unknown> = {
      discipline: data.discipline,
      task_no: newTaskNo,
      main_task_no: parent.task_no,
      level: "sub",
      sort_order: insertSort,
      task_name: data.task_name,
      sub_task_desc: data.sub_task_desc ?? null,
      category: data.category ?? parent.category ?? null,
      plot: parent.plot ?? null,
      team: parent.team ?? null,
      risk: data.risk ?? parent.risk ?? null,
      hdec_pic_name: data.hdec_pic_name ?? null,
      hdec_eng_name: data.hdec_eng_name ?? null,
      floor_level: data.floor_level ?? null,
      location: data.location ?? null,
      row_type: data.row_type ?? null,
      status_manual: data.status_manual ?? "예정",
      plan_start: data.plan_start ?? null,
      plan_end: data.plan_end ?? null,
      data_date: parent.data_date ?? null,
      source_file: parent.source_file ?? null,
    };
    const { data: inserted, error: insErr } = await admin
      .from("task_management_raw")
      .insert(payload)
      .select("id, task_no")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { id: inserted.id as string, task_no: inserted.task_no as string };
  });

// ---------------------------------------------------------------------------
// Main Task + Sub Tasks 원자적 신규 생성
// ---------------------------------------------------------------------------

const MainSchema = z.object({
  task_no: z.string().max(100).nullable().optional(),
  task_name: z.string().min(1).max(500),
  team: z.string().min(1).max(100),
  category: z.string().min(1).max(200),
  hdec_pic_name: z.string().min(1).max(200),
  risk: z.string().min(1).max(50),
  hdec_eng_name: z.string().max(200).nullable().optional(),
  floor_level: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  plot: z.string().max(50).nullable().optional(),
  row_type: z.string().max(50).nullable().optional(),
});

const SubSchema = z.object({
  task_name: z.string().min(1).max(500),
  sub_task_desc: z.string().min(1).max(2000),
  row_type: z.string().min(1).max(50),
  risk: z.string().min(1).max(50),
  hdec_pic_name: z.string().min(1).max(200),
  category: z.string().min(1).max(200),
  plan_start: z.string().min(1),
  plan_end: z.string().min(1),
  hdec_eng_name: z.string().max(200).nullable().optional(),
  floor_level: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status_manual: z.string().max(50).nullable().optional(),
});

const AddMainSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  main: MainSchema,
  subs: z.array(SubSchema).min(1),
});

/** Main Task 1개 + Sub Task N개(>=1) 원자적 생성 후 롤업. */
export const addMainTaskWithSubs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => AddMainSchema.parse(v))
  .handler(async ({ data, context }) => {
    // 판정 정본: DB `rcl_can_values` 단일 경로 (Main + 모든 Sub 의 담당자/팀 범위).
    await assertRclValues(
      context,
      {
        hdec_pic_name: data.main.hdec_pic_name,
        hdec_eng_name: data.main.hdec_eng_name ?? null,
        team: data.main.team,
      },
      "write",
      "권한 없음: 지정한 담당자/팀 범위에는 Main Task를 등록할 수 없습니다",
    );
    for (const s of data.subs) {
      await assertRclValues(
        context,
        {
          hdec_pic_name: s.hdec_pic_name,
          hdec_eng_name: s.hdec_eng_name ?? null,
          team: data.main.team,
        },
        "write",
        `권한 없음: Sub Task 담당자 '${s.hdec_pic_name}' 는 등록 범위를 벗어납니다`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: res, error } = await admin.rpc("create_main_with_subs", {
      _discipline: data.discipline,
      _main: data.main,
      _subs: data.subs,
    });
    if (error) throw new Error(error.message);
    const out = res as { main_task_no: string; sub_task_nos: string[] };
    return out;
  });

/** 채번 미리보기용 (다이얼로그 오픈 시 프리필) */
export const allocateMainTaskNo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ discipline: z.enum(DISCIPLINES) }).parse(v))
  .handler(async ({ data, context }) => {
    const { data: next, error } = await context.supabase.rpc("allocate_main_task_no", {
      _discipline: data.discipline,
    });
    if (error) throw new Error(error.message);
    return { next: String(next) };
  });