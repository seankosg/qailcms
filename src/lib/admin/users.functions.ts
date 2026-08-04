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

/** admin 단독 검사 (superuser 불통과). admin 등급 부여 등 잠금 경로 전용. */
async function assertStrictAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("이 작업은 Admin 계정만 수행할 수 있습니다.");
}

/** 화면과 서버 판정 기준을 맞추기 위한 등급 서열 (DB rcl_highest_role 과 동일). */
const ROLE_RANK_SRV: Record<string, number> = {
  admin: 100, superuser: 90, d_superuser: 80, senior_user: 70,
  user: 50, super_guest: 30, guest: 10,
};

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
    // 이름은 사용자 식별 정본 키 — 필수 + 전역 유일.
    const name = (data.name ?? "").trim();
    if (!name) throw new Error("이름은 필수입니다. (사용자 식별 정본 키)");
    // public.hdec_name_norm(name) 과 동일 규칙: 공백류 축약 → trim → 대문자
    const nameNorm = name.replace(/\s+/g, " ").trim().toUpperCase();
    const { data: dup } = await supabaseAdmin
      .from("profiles")
      .select("id,name")
      .eq("name_norm" as any, nameNorm)
      .maybeSingle();
    if (dup) throw new Error(`이름 '${name}' 은(는) 이미 사용 중입니다. 이름은 중복될 수 없습니다.`);
    const email = `${loginId}@${DUMMY_EMAIL_DOMAIN}`;
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.temp_password,
      email_confirm: true,
      user_metadata: {
        login_id: loginId,
        display_name: data.display_name,
        name,
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
      patch.name = name;
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
  // (아래 updateUserRole 정의는 그대로)
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; role: AppRole }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // §2 admin 승격은 admin 만. superuser 가 admin 계정 수를 늘리지 못하게 한다.
    if (data.role === "admin") {
      await assertStrictAdmin(context.supabase, context.userId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: curRows } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", data.user_id);
    const current = (curRows ?? []).map((r: any) => String(r.role));
    const currentRank = current.reduce((m, r) => Math.max(m, ROLE_RANK_SRV[r] ?? 0), 0);
    const nextRank = ROLE_RANK_SRV[data.role] ?? 0;
    // §3 본인 계정의 등급 하향 금지 (상향은 허용).
    if (data.user_id === context.userId && nextRank < currentRank) {
      throw new Error("본인 계정의 등급은 낮출 수 없습니다.");
    }
    // §4 마지막 admin 제거 금지.
    if (current.includes("admin") && data.role !== "admin") {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("마지막 Admin 계정의 등급은 변경할 수 없습니다. 다른 Admin 을 먼저 지정하세요.");
      }
    }
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
    if (payload.name !== undefined) {
      const nm = String(payload.name ?? "").trim();
      if (!nm) throw new Error("이름은 필수입니다. (사용자 식별 정본 키)");
      const nmNorm = nm.replace(/\s+/g, " ").toUpperCase();
      const { data: dup } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("name_norm" as any, nmNorm)
        .neq("id", user_id)
        .maybeSingle();
      if (dup) throw new Error(`이름 '${nm}' 은(는) 이미 사용 중입니다. 이름은 중복될 수 없습니다.`);
      payload.name = nm;
    }
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
    // 명부(hdec_*_name_master) 등에서 linked_user_id 참조가 남아 있으면 삭제가 실패한다.
    for (const t of ["hdec_pic_name_master", "hdec_eng_name_master"]) {
      await (supabaseAdmin as any).from(t).update({ linked_user_id: null }).eq("linked_user_id", data.user_id);
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      const detail =
        error.message ||
        (error as any).error_description ||
        (error as any).code ||
        JSON.stringify(error);
      throw new Error(`계정 삭제 실패: ${detail}`);
    }
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
// ---- 명부 일괄 계정 생성 (2026-08-04) ----

/** 이름 → login_id 기본 규칙: 소문자화 후 공백·마침표 제거, 허용문자 외 제거. */
export function baseLoginIdFromName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[\s.]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

/** 이름 목록 → 충돌 회피된 login_id 제안. 기존 profiles.login_id 와 목록 내 중복을 모두 검사. */
export const suggestLoginIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { names: string[] }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin.from("profiles").select("login_id");
    const taken = new Set<string>((existing ?? []).map((r: any) => String(r.login_id ?? "").toLowerCase()));
    const out: { name: string; login_id: string; suffix: number; conflicted: boolean; needs_edit: boolean }[] = [];
    for (const name of data.names) {
      const base = baseLoginIdFromName(name);
      const needsEdit = base.length === 0;
      let candidate = needsEdit ? "user" : base;
      let suffix = 0;
      while (taken.has(candidate)) {
        suffix = suffix === 0 ? 2 : suffix + 1;
        candidate = `${needsEdit ? "user" : base}${suffix}`;
      }
      taken.add(candidate);
      out.push({ name, login_id: candidate, suffix, conflicted: suffix > 0, needs_edit: needsEdit });
    }
    return out;
  });

/** 명부 이름 다중 선택 → 계정 일괄 생성. 부분 실패 허용(전량 롤백 없음). */
export const bulkCreateAppUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    kind: "pic" | "eng";
    rows: { name: string; login_id: string; team?: string | null }[];
    temp_password: string;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // 임시 비밀번호는 호출부가 준 값 하나를 전원에게 사용한다(생성 경로 단일화).
    const sharedPw = String(data.temp_password ?? "");
    if (!/^(?=.*[A-Za-z])(?=.*\d).{6,}$/.test(sharedPw)) {
      throw new Error("임시 비밀번호는 영문+숫자 포함 6자 이상이어야 합니다.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userType = data.kind === "pic" ? "hdec_pic" : "hdec_eng";
    const masterTable = data.kind === "pic" ? "hdec_pic_name_master" : "hdec_eng_name_master";

    const results: {
      name: string;
      login_id: string;
      team: string | null;
      temp_password: string | null;
      ok: boolean;
      error: string | null;
      recalc: Record<string, number>;
      recalc_total: number;
    }[] = [];

    for (const row of data.rows) {
      const name = String(row.name ?? "").trim();
      const loginId = String(row.login_id ?? "").trim().toLowerCase();
      const team = row.team ? String(row.team).trim() : null;
      const tempPw = sharedPw;
      const base = {
        name,
        login_id: loginId,
        team,
        temp_password: null as string | null,
        ok: false,
        error: null as string | null,
        recalc: {} as Record<string, number>,
        recalc_total: 0,
      };
      try {
        if (!name) throw new Error("이름이 비어 있습니다.");
        if (!/^[a-z0-9._-]+$/.test(loginId)) throw new Error("Login ID 형식 오류 (영문 소문자·숫자·. _ - 만 사용)");
        const nameNorm = name.replace(/\s+/g, " ").trim().toUpperCase();

        const { data: dupName } = await supabaseAdmin
          .from("profiles").select("id").eq("name_norm" as any, nameNorm).maybeSingle();
        if (dupName) throw new Error(`이름 '${name}' 은(는) 이미 계정이 있습니다.`);
        const { data: dupLogin } = await supabaseAdmin
          .from("profiles").select("id").eq("login_id", loginId).maybeSingle();
        if (dupLogin) throw new Error(`Login ID '${loginId}' 중복`);

        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email: `${loginId}@${DUMMY_EMAIL_DOMAIN}`,
          password: tempPw,
          email_confirm: true,
          user_metadata: {
            login_id: loginId,
            display_name: name,
            name,
            user_type: userType,
            team,
            role: "user",
            must_change_password: true,
          },
        });
        if (error) throw new Error(error.message);
        const uid = created?.user?.id;
        if (!uid) throw new Error("계정 생성 응답이 비어 있습니다.");

        await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
        await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "user" });
        await supabaseAdmin.from("profiles").update({
          name, display_name: name, login_id: loginId, team,
          user_type: userType, must_change_password: true,
        } as any).eq("id", uid);

        // 명부 연결 — PIC·ENG 양쪽 명부에 name_norm 기준으로 모두 연결한다(§2-2).
        // 같은 이름이 양쪽에 존재해도 계정은 하나이므로 두 행 모두 같은 uid 를 가리켜야 한다.
        for (const t of ["hdec_pic_name_master", "hdec_eng_name_master"]) {
          await (supabaseAdmin as any).from(t)
            .update({ linked_user_id: uid }).eq("name_norm", nameNorm);
        }

        // 소유권 재계산 — hdec_assert_admin() 이 auth.uid() 를 보므로
        // service_role(supabaseAdmin) 이 아니라 호출자 세션(context.supabase)으로 실행한다.
        const { data: recalc, error: recalcErr } = await (context.supabase as any).rpc(
          "hdec_recalc_owner_for_user",
          { _user_id: uid, _reason: "bulk_account_create" },
        );
        if (recalcErr) throw new Error(`계정은 생성되었으나 소유권 재계산 실패: ${recalcErr.message}`);
        const rc: Record<string, number> = {};
        for (const m of ((recalc as any)?.modules ?? []) as any[]) {
          rc[String(m.table)] = Number(m.updated ?? 0);
        }
        const total = Number((recalc as any)?.total ?? 0);
        results.push({ ...base, temp_password: tempPw, ok: true, recalc: rc, recalc_total: total });
      } catch (e: any) {
        results.push({ ...base, error: e?.message ?? String(e) });
      }
    }
    return results;
  });
