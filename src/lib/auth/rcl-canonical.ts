/**
 * RCL 정본 표 (2026-08-04 지시자 확정).
 *
 * 검사 기준 (ㄷ): 격자 덤프를 이 표와 **칸 단위로 기계 대조**한다.
 * (ㄱ) delete=Y & write=N, (ㄴ) 역할 간 역전 검사는 격자 "안"만 보므로
 * 정본과 다른 칸을 잡지 못한다 → 이 표가 세 번째 기준이다.
 *
 * guest · super_guest 는 정본 미확정(계정 0명, BACKLOG #0804) → 대조 대상에서 제외.
 */
export type RclCanonRole = "user" | "senior_user" | "d_superuser" | "superuser";
export type RclCanonScope = "own" | "own_team" | "other_team";
export type RclCanonAction = "read" | "write" | "delete" | "import" | "export";

/** 값 순서 = read, write, delete, import, export */
export const RCL_CANONICAL: Record<RclCanonRole, Record<RclCanonScope, boolean[]>> = {
  user: {
    own:        [true, true, true, true, true],
    own_team:   [true, false, false, false, false],
    other_team: [false, false, false, false, false],
  },
  senior_user: {
    own:        [true, true, true, true, true],
    own_team:   [true, true, false, true, true],
    other_team: [true, false, false, false, false],
  },
  d_superuser: {
    own:        [true, true, true, true, true],
    own_team:   [true, true, true, true, true],
    other_team: [true, true, false, true, true],
  },
  superuser: {
    own:        [true, true, true, true, true],
    own_team:   [true, true, true, true, true],
    other_team: [true, true, true, true, true],
  },
};

export const RCL_CANON_ACTIONS: RclCanonAction[] = ["read", "write", "delete", "import", "export"];
export const RCL_CANON_ROLES = Object.keys(RCL_CANONICAL) as RclCanonRole[];
/** 대조 모집단 = 4역할 × 3범위 × 5동작 */
export const RCL_CANON_CELL_COUNT = RCL_CANON_ROLES.length * 3 * RCL_CANON_ACTIONS.length;

export function canonicalAllowed(role: string, scope: string, action: string): boolean | null {
  const r = RCL_CANONICAL[role as RclCanonRole];
  if (!r) return null;
  const row = r[scope as RclCanonScope];
  if (!row) return null;
  const i = RCL_CANON_ACTIONS.indexOf(action as RclCanonAction);
  return i < 0 ? null : row[i]!;
}

/** live 격자와 정본 표를 기계 대조. 반환 = 어긋난 칸 목록. */
export function diffAgainstCanonical(
  live: { role: string; scope: string; action: string; allowed: boolean }[],
): { role: string; scope: string; action: string; live: boolean; canon: boolean }[] {
  const out: { role: string; scope: string; action: string; live: boolean; canon: boolean }[] = [];
  for (const c of live) {
    const canon = canonicalAllowed(c.role, c.scope, c.action);
    if (canon === null) continue; // 정본 미확정(guest 계열)
    if (canon !== c.allowed) out.push({ ...c, live: c.allowed, canon });
  }
  return out;
}
