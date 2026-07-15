/**
 * Import 파이프라인의 마스터 이름 검증/치환 유틸.
 *
 * 각 도메인 rows 에서 마스터 이름 필드(예: subcontractor_name, hdec_pic_name)를
 * 수집 → 활성 마스터 옵션에 대해 matchMasterName 실행 → 미해결 후보를 반환.
 * 다이얼로그에서 사용자가 결정한 매핑(action="map"|"register"|"skip") 을 다시
 * rows 에 적용할 때는 applyNameDecisions 를 사용.
 */
import type { MasterKind, MasterOption } from "@/hooks/useMasterOptions";
import {
  matchMasterName,
  normalizeName,
  type MasterCandidate,
} from "./fuzzy-master-match";

export interface NameFieldSpec<Row> {
  /** 다이얼로그 표시용 라벨 (예: "Subcontractor") */
  fieldLabel: string;
  /** 매핑 대상 마스터 종류 */
  masterKind: MasterKind;
  /** row 에서 이름 문자열을 꺼내는 접근자. null/공백은 무시됨. */
  read: (row: Row) => string | null | undefined;
  /** row 에 새 이름을 쓰는 세터. skip 시엔 호출되지 않음. */
  write: (row: Row, next: string) => void;
}

export interface UnresolvedNameEntry {
  /** `${masterKind}::${normalized(rawName)}` — 안정 키 */
  key: string;
  fieldLabel: string;
  masterKind: MasterKind;
  rawName: string;
  candidates: MasterCandidate[];
  occurrences: number;
}

/**
 * rows 를 훑어 각 필드별로 정확 일치를 통과시키고, 유사 후보/미매칭을 모아 반환.
 * - 정확 일치는 반환 목록에 포함되지 않음(사용자 결정 불필요).
 * - `matchMasterName` 이 후보 0개를 반환한 경우도 목록에 포함 (관리자 신규 등록 유도).
 */
export function collectUnresolvedNames<Row>(
  rows: readonly Row[],
  specs: readonly NameFieldSpec<Row>[],
  optionsByKind: Record<MasterKind, readonly MasterOption[]>,
  opts: { threshold?: number } = {},
): UnresolvedNameEntry[] {
  const threshold = opts.threshold ?? 0.85;
  const byKey = new Map<string, UnresolvedNameEntry>();
  for (const row of rows) {
    for (const spec of specs) {
      const raw = spec.read(row);
      const trimmed = raw == null ? "" : String(raw).trim();
      if (!trimmed) continue;
      const norm = normalizeName(trimmed);
      if (!norm) continue;
      const options = optionsByKind[spec.masterKind] ?? [];
      const result = matchMasterName(trimmed, options, { threshold });
      if (result.exact) continue;
      const key = `${spec.masterKind}::${norm}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.occurrences += 1;
      } else {
        byKey.set(key, {
          key,
          fieldLabel: spec.fieldLabel,
          masterKind: spec.masterKind,
          rawName: trimmed,
          candidates: result.candidates,
          occurrences: 1,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.occurrences - a.occurrences);
}

export type NameDecisionAction = "map" | "register" | "skip";

export interface NameDecision {
  action: NameDecisionAction;
  /** action="map" 이면 canonical 마스터 이름, "register" 이면 새로 등록할 이름(=rawName). */
  mappedName?: string;
}

/**
 * rows 를 순회하며 원본 이름의 정규화 키가 decisions 에 있으면 매핑된 이름으로 교체.
 * skip 결정은 원본을 그대로 둠. rows 는 in-place 로 수정됨.
 */
export function applyNameDecisions<Row>(
  rows: Row[],
  specs: readonly NameFieldSpec<Row>[],
  decisions: Map<string, NameDecision>,
): void {
  for (const row of rows) {
    for (const spec of specs) {
      const raw = spec.read(row);
      const trimmed = raw == null ? "" : String(raw).trim();
      if (!trimmed) continue;
      const key = `${spec.masterKind}::${normalizeName(trimmed)}`;
      const d = decisions.get(key);
      if (!d) continue;
      if (d.action === "skip") continue;
      if (d.mappedName && d.mappedName !== trimmed) {
        spec.write(row, d.mappedName);
      }
    }
  }
}