import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TM_EDITABLE_FIELDS } from "./columns";

// task_no 는 columns.ts 의 편집 목록엔 없지만 admin/d_superuser 전용으로 별도 허용.
const ALLOWED_FIELDS = new Set<string>([
  ...TM_EDITABLE_FIELDS,
  "task_no",
  "team",
  "data_date",
  "milestone",
]);

// 배포 검증용 마커 — published 번들에서 grep 으로 확인.
export const TM_OWNER_MUTATIONS_MARKER = "TM_OWNER_MUTATIONS_V3_RCL_2026_08_04";

/** RCL 정본 판정. 판정 규칙은 DB `rcl_can` 하나뿐이며 여기서 재구현하지 않는다. */
async function assertRcl(
  supa: any,
  userId: string,
  rowId: string,
  action: "write" | "delete" = "write",
) {
  const { data, error } = await supa.rpc("rcl_can", {
    _user_id: userId,
    _module: "TM",
    _row_id: rowId,
    _action: action,
  });
  if (error) throw new Error(`권한 판정 실패: ${error.message}`);
  if (data !== true) throw new Error("권한 없음: 이 행/필드를 편집할 권한이 없습니다.");
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1),
  value: z.any().nullable(),
});

export const updateTaskOwnerField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!ALLOWED_FIELDS.has(data.field)) {
      throw new Error(`Field '${data.field}' 은 이 경로로 편집할 수 없습니다.`);
    }

    // 판정 정본: DB `rcl_can` 단일 경로.
    const { data: row } = await context.supabase
      .from("task_management_raw")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("대상 행을 찾을 수 없습니다.");
    await assertRcl(context.supabase, context.userId, data.id, "write");

    // ⛔ 임시 조치(2026-08-06, 원복 예정): Milestone 은 admin 등급만 수정 가능.
    if (data.field === "milestone") {
      const { data: isAdmin, error: rErr } = await (context.supabase as any).rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (rErr) throw new Error(`권한 판정 실패: ${rErr.message}`);
      if (isAdmin !== true) {
        throw new Error("권한 없음: Milestone 은 현재 관리자만 수정할 수 있습니다(임시 조치).");
      }
    }

    // task_no 는 모듈 전체 범위(other_team) 편집권 보유자만 변경 가능.
    // 근거: task_no 는 TM 모듈 전역 식별자(계층 부모-자식 매칭 · 임포트 업서트 키 · 외부 참조)라
    // 본인/자기팀 범위 판정으로는 변경의 영향 범위를 그 범위 안에 가둘 수 없다.
    // 따라서 "다른 팀 권한을 요구"하는 것이 아니라 "모듈 전 범위 편집권(other_team=Y) 보유"를
    // 요건으로 둔 것이며, 기존 admin/superuser/d_superuser 한정 정책을 RCL 격자로 옮긴 등가 조건이다.
    if (data.field === "task_no") {
      const { data: g, error: gErr } = await (context.supabase as any).rpc("rcl_grants", {
        _module: "TM",
        _action: "write",
      });
      if (gErr) throw new Error(`권한 판정 실패: ${gErr.message}`);
      if (!g || g.other_team !== true) {
        throw new Error("권한 없음: 과업코드(task_no)는 모듈 전체 편집 권한이 필요합니다.");
      }
    }

    // 3) 값 정규화
    let value: unknown = data.value;
    if (typeof value === "string" && value.trim() === "") value = null;
    if (data.field === "team" && value != null) value = String(value).toUpperCase().trim();

    const patch: Record<string, unknown> = {
      [data.field]: value,
      updated_at: new Date().toISOString(),
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("task_management_raw")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** R2-6(b): 날짜를 고치지 않고 '확인'만으로 actual_finish_source := 'user' 전환. */
export const confirmActualFinishSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("task_management_raw")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("대상 행을 찾을 수 없습니다.");
    await assertRcl(context.supabase, context.userId, data.id, "write");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("task_management_raw")
      .update({ actual_finish_source: "user", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });