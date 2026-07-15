import type { TeamOption } from "@/lib/team/team-master";
import { matchTeamCode, normalizeTeamCode } from "@/lib/team/team-master";

/** rows 배열에서 team 코드를 canonicalize하고 미등록 코드 목록 반환. */
export function canonicalizeTeamOnRows<T>(
  rows: T[],
  teamOptions: TeamOption[],
  getter: (row: T) => string | null | undefined,
  setter: (row: T, code: string | null) => void,
): { unknown: string[]; nullRows: number } {
  const unknown = new Set<string>();
  let nullRows = 0;
  for (const row of rows) {
    const raw = getter(row);
    const norm = normalizeTeamCode(raw);
    if (!norm) {
      nullRows++;
      continue;
    }
    const match = matchTeamCode(norm, teamOptions);
    if (match) {
      setter(row, match.code);
    } else {
      unknown.add(norm);
      setter(row, norm);
    }
  }
  return { unknown: Array.from(unknown).sort(), nullRows };
}

/** 단일 team 코드 후보 목록에서 미등록 항목만 추림. */
export function collectUnknownTeamCodes(
  codes: (string | null | undefined)[],
  teamOptions: TeamOption[],
): string[] {
  const unknown = new Set<string>();
  for (const raw of codes) {
    const norm = normalizeTeamCode(raw);
    if (!norm) continue;
    if (!matchTeamCode(norm, teamOptions)) unknown.add(norm);
  }
  return Array.from(unknown).sort();
}