import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TM_EDITABLE_FIELDS } from "./columns";
import { canEditRawRow } from "@/lib/auth/roles";
import { ROLE_RANK, type AppRole } from "@/types/enums";

// task_no 는 columns.ts 의 편집 목록엔 없지만 admin/d_superuser 전용으로 별도 허용.
const ALLOWED_FIELDS = new Set<string>([...TM_EDITABLE_FIELDS, "task_no", "team", "data_date"]);

// 배포 검증용 마커 — published 번들에서 grep 으로 확인.
export const TM_OWNER_MUTATIONS_MARKER = "TM_OWNER_MUTATIONS_V2_2026_07_28";

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

    // Raw Data / Detail 공용 canEditRawRow 규칙을 서버에서 재검증한다.
    const [{ data: profile }, { data: roleRows }, { data: row }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("task_management_raw").select("*").eq("id", data.id).maybeSingle(),
    ]);
    if (!row) throw new Error("대상 행을 찾을 수 없습니다.");
    const roles = ((roleRows ?? []) as any[]).map((r) => r.role as string);
    const rank = roles.reduce((m, r) => Math.max(m, ROLE_RANK[r as AppRole] ?? 0), 0);
    const userLike = {
      roles: roles as (AppRole | string)[],
      rank,
      team: (profile as any)?.team ?? null,
      hdec_pic_name: (profile as any)?.hdec_pic_name ?? null,
      hdec_eng_name: (profile as any)?.hdec_eng_name ?? null,
      subcontractor_name: (profile as any)?.subcontractor_name ?? null,
      subsub_name: (profile as any)?.subsub_name ?? null,
    };
    let allowed = canEditRawRow(userLike, "task_management_raw", row as any);
    // task_no 는 admin 또는 d_superuser 만 편집 가능
    if (allowed && data.field === "task_no") {
      allowed = roles.includes("admin") || roles.includes("superuser") || roles.includes("d_superuser");
    }
    if (!allowed) {
      throw new Error("권한 없음: 이 행/필드를 편집할 권한이 없습니다.");
    }

    // 3) 값 정규화
    let value: unknown = data.value;
    if (typeof value === "string" && value.trim() === "") value = null;
    if (data.field === "team" && value != null) value = String(value).toUpperCase().trim();

    const patch: Record<string, unknown> = {
      [data.field]: value,
      updated_by: context.userId,
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