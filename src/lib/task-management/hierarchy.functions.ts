import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DISCIPLINES = ["ARCH", "ELEC", "MECH", "DESN", "PRJC"] as const;

const AddChildSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  parent_task_no: z.string().min(1),
  task_name: z.string().min(1).max(500),
  sub_task_desc: z.string().max(2000).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  pic: z.string().max(200).nullable().optional(),
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
  if (!isAdmin && !isSuper) throw new Error("권한 없음: 관리자만 하위 태스크를 추가할 수 있습니다");
}

/**
 * 부모 task 아래에 새 자식 task를 추가한다.
 * - task_no: parent_task_no + "-NN" (자동 채번, 2자리)
 * - 부모가 leaf였다면 level='parent'로 승격
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
      .eq("task_no", data.parent_task_no)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!parent) throw new Error(`부모 태스크 '${data.parent_task_no}'을(를) 찾을 수 없습니다`);

    // 2) 채번: DB advisory lock 기반 RPC (경합 안전)
    const { data: allocated, error: allocErr } = await admin.rpc("allocate_task_no", {
      _discipline: data.discipline,
      _parent_task_no: parent.task_no,
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
    if (parent.level !== "parent") {
      const { error: upErr } = await admin
        .from("task_management_raw")
        .update({ level: "parent" })
        .eq("id", parent.id);
      if (upErr) throw new Error(upErr.message);
    }

    // 5) 자식 삽입
    const payload: Record<string, unknown> = {
      discipline: data.discipline,
      task_no: newTaskNo,
      parent_task_no: parent.task_no,
      level: "child",
      sort_order: insertSort,
      task_name: data.task_name,
      sub_task_desc: data.sub_task_desc ?? null,
      category: data.category ?? parent.category ?? null,
      plot: parent.plot ?? null,
      team: parent.team ?? null,
      risk: data.risk ?? parent.risk ?? null,
      pic: data.pic ?? null,
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