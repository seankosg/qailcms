// ABD OCS Import/관리 화면 접근 권한 헬퍼.
// admin 또는 HDEC PIC 중 Team DESN 사용자에게 개방.

type LooseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => any;
};

export interface CanAccessAbdOcsInput {
  userType?: string | null;
  team?: string | null;
  isStrictAdmin?: boolean;
}

/** 브라우저 측 권한 판정 */
export function canAccessAbdOcs(input: CanAccessAbdOcsInput): boolean {
  if (input.isStrictAdmin) return true;
  return input.userType === "hdec_pic" && input.team === "DESN";
}

/** 서버 함수 내 권한 판정 */
export async function assertAbdOcsAccess(supabase: unknown, userId: string): Promise<void> {
  const client = supabase as LooseClient;

  const { data: isAdmin, error: adminErr } = await client.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (adminErr) throw new Error(adminErr.message);
  if (isAdmin) return;

  const { data: profile, error: profErr } = await client
    .from("profiles")
    .select("user_type, team")
    .eq("id", userId)
    .maybeSingle();
  if (profErr) throw new Error(profErr.message);

  if (profile?.user_type === "hdec_pic" && profile?.team === "DESN") return;

  throw new Error("ABD OCS 접근 권한이 없습니다. (admin 또는 HDEC PIC-DESN 팀)");
}
