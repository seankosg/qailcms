import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DUMMY_EMAIL_DOMAIN = "qail.local";
/** @deprecated Phase 2 이후 DEFAULT_PASSWORD 사용. 하위호환용 유지. */
export const DEFAULT_INITIAL_PASSWORD = "Qail@2026!";

type MasterKind = "subcontractor" | "subsub" | "team" | "hdec_pic" | "hdec_eng";

function tableForKind(kind: MasterKind): string {
  switch (kind) {
    case "subcontractor":
    case "subsub":
      return "subcontractor_master";
    case "team":
      return "team_master";
    case "hdec_pic":
      return "hdec_pic_name_master";
    case "hdec_eng":
      return "hdec_eng_name_master";
  }
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["admin", "superuser"],
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("관리자 권한이 필요합니다.");
}

type UserType = "subcontractor" | "hdec" | "hdec_pic" | "hdec_eng" | "pm_pd" | "admin" | "subsub" | "guest";
type AppRole =
  | "admin"
  | "superuser"
  | "senior_user"
  | "user"
  | "super_guest"
  | "guest"
  | "d_superuser";

export const listAppUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id,email,display_name,name,login_id,user_type,team,subcontractor_name,subsub_name,hdec_pic_name,hdec_eng_name,must_change_password,is_active,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role");
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p: any) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    login_id: string;
    display_name: string;
    user_type: UserType;
    role: AppRole;
    temp_password: string;
    name?: string | null;
    team?: string | null;
    subcontractor_name?: string | null;
    subsub_name?: string | null;
    hdec_pic_name?: string | null;
    hdec_eng_name?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loginId = data.login_id.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(loginId)) {
      throw new Error("Login ID는 영문 소문자, 숫자, . _ - 만 사용할 수 있습니다.");
    }
    const email = `${loginId}@${DUMMY_EMAIL_DOMAIN}`;
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.temp_password,
      email_confirm: true,
      user_metadata: {
        login_id: loginId,
        display_name: data.display_name,
        name: data.name ?? data.display_name ?? null,
        user_type: data.user_type,
        team: data.team ?? null,
        subcontractor_name: data.subcontractor_name ?? null,
        subsub_name: data.subsub_name ?? null,
        hdec_pic_name: data.hdec_pic_name ?? null,
        hdec_eng_name: data.hdec_eng_name ?? null,
        role: data.role,
        must_change_password: true,
      },
    });
    if (error) throw new Error(error.message);
    // 트리거가 role을 반영하지만, 첫 사용자 예외를 회피하기 위해 재확정
    if (created?.user) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
      await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: data.role });
      // metadata → profiles 반영이 신규 컬럼을 커버하지 않을 수 있어 명시적으로 보강.
      const patch: Record<string, any> = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.team !== undefined) patch.team = data.team;
      if (data.subsub_name !== undefined) patch.subsub_name = data.subsub_name;
      if (data.hdec_eng_name !== undefined) patch.hdec_eng_name = data.hdec_eng_name;
      if (Object.keys(patch).length) {
        await supabaseAdmin.from("profiles").update(patch as any).eq("id", created.user.id);
      }
    }
    return { id: created?.user?.id };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; temp_password: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.temp_password,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("profiles").update({ must_change_password: true }).eq("id", data.user_id);
    return { ok: true };
  });

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; role: AppRole }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLoginId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; login_id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const loginId = data.login_id.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(loginId)) {
      throw new Error("Login ID는 영문 소문자, 숫자, . _ - 만 사용할 수 있습니다.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = `${loginId}@${DUMMY_EMAIL_DOMAIN}`;
    // 이메일과 login_id 를 동시에 갱신
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { email });
    if (authErr) throw new Error(authErr.message);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ login_id: loginId, email } as any)
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateUserProfileFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    user_id: string;
    display_name?: string;
    name?: string | null;
    user_type?: UserType;
    team?: string | null;
    subcontractor_name?: string | null;
    subsub_name?: string | null;
    hdec_pic_name?: string | null;
    hdec_eng_name?: string | null;
    is_active?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { user_id, ...rest } = data;
    const payload: any = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) payload[k] = v;
    if (Object.keys(payload).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("profiles").update(payload).eq("id", user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("본인 계정은 삭제할 수 없습니다.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markPasswordChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Master 관리 ----
export const addMasterName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    kind: MasterKind;
    name: string;
    // team-only
    code?: string;
    sort_order?: number;
    aliases?: string[];
    // subcontractor / subsub
    parent_id?: string | null;
    owner_code?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const table = tableForKind(data.kind);
    const name = data.name.trim();
    if (!name) throw new Error("이름을 입력하세요.");
    let payload: any = { name };
    if (data.kind === "team") {
      const code = (data.code ?? name).trim().toUpperCase();
      if (!code) throw new Error("Team 코드를 입력하세요.");
      const aliases = Array.from(new Set(
        (data.aliases ?? [])
          .map((a) => String(a).trim())
          .filter((a) => a && a.toUpperCase() !== code),
      ));
      payload = { code, name: name.toUpperCase(), sort_order: data.sort_order ?? 0, aliases };
    } else if (data.kind === "subcontractor") {
      payload = { name, type: "sub", owner_code: data.owner_code ?? null };
    } else if (data.kind === "subsub") {
      if (!data.parent_id) throw new Error("상위 협력사를 선택하세요.");
      payload = { name, type: "subsub", parent_subcontractor_id: data.parent_id, owner_code: data.owner_code ?? null };
    } else if (data.kind === "hdec_pic" || data.kind === "hdec_eng") {
      payload = { name, is_active: true };
    }
    const { error } = await (context.supabase as any).from(table).insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleMasterActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: MasterKind; id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const table = tableForKind(data.kind);
    const { error } = await (context.supabase as any)
      .from(table)
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMasterName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: MasterKind; id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const table = tableForKind(data.kind);
    const { error } = await (context.supabase as any).from(table).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMasterFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    kind: MasterKind;
    id: string;
    name?: string;
    code?: string;
    sort_order?: number;
    aliases?: string[];
    parent_id?: string | null;
    owner_code?: string | null;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const table = tableForKind(data.kind);
    const patch: any = {};
    if (data.name !== undefined) patch.name = data.kind === "team" ? data.name.trim().toUpperCase() : data.name.trim();
    if (data.code !== undefined && data.kind === "team") patch.code = data.code.trim().toUpperCase();
    if (data.sort_order !== undefined && data.kind === "team") patch.sort_order = data.sort_order;
    if (data.aliases !== undefined && data.kind === "team") {
      const selfCode = (data.code ?? "").trim().toUpperCase();
      patch.aliases = Array.from(new Set(
        data.aliases
          .map((a) => String(a).trim())
          .filter((a) => a && (!selfCode || a.toUpperCase() !== selfCode)),
      ));
    }
    if (data.parent_id !== undefined && (data.kind === "subcontractor" || data.kind === "subsub")) {
      patch.parent_subcontractor_id = data.parent_id;
    }
    if (data.owner_code !== undefined && (data.kind === "subcontractor" || data.kind === "subsub")) {
      patch.owner_code = data.owner_code;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await (context.supabase as any).from(table).update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });