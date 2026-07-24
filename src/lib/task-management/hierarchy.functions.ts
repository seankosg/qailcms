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

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  const { data: isSuper } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "superuser",
  });
  if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 Sub Task를 추가할 수 있습니다");
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
    await assertAdmin(context);
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

async function assertCanCreateMain(context: { supabase: any; userId: string }, disc: string) {
  const roleCheck = async (role: string) => {
    const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
    return !!data;
  };
  const [isAdmin, isSuper, isSenior, isDSuper, isUser] = await Promise.all([
    roleCheck("admin"), roleCheck("superuser"), roleCheck("senior_user"),
    roleCheck("d_superuser"), roleCheck("user"),
  ]);
  if (!isAdmin && !isSuper && !isSenior && !isDSuper && !isUser) {
    throw new Error("권한 없음: Task를 추가할 수 없습니다");
  }
  return { isAdmin, isSuper, isSenior, isDSuper, isUser };
}

/** Main Task 1개 + Sub Task N개(>=1) 원자적 생성 후 롤업. */
export const addMainTaskWithSubs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => AddMainSchema.parse(v))
  .handler(async ({ data, context }) => {
    const perms = await assertCanCreateMain(context, data.discipline);

    // user / d_superuser: HDEC PIC 또는 팀 강제 확인 (profiles.hdec_pic_name / team)
    if (!perms.isAdmin && !perms.isSuper && !perms.isSenior) {
      const { data: prof } = await context.supabase
        .from("profiles").select("hdec_pic_name, team").eq("id", context.userId).maybeSingle();
      const myPic = (prof?.hdec_pic_name ?? "").trim();
      const myTeam = (prof?.team ?? "").trim();
      if (perms.isUser && myPic && data.main.hdec_pic_name.trim() !== myPic) {
        throw new Error("권한: HDEC PIC는 본인 이름으로만 등록 가능합니다");
      }
      if ((perms.isUser || perms.isDSuper) && myTeam && data.main.team.trim() !== myTeam) {
        throw new Error("권한: Team은 본인 소속으로만 등록 가능합니다");
      }
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