export function normalizeHeader(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * source_issue_no 는 defect_items_raw 의 유니크 키다.
 * 허용되는 원본 헤더는 두 가지뿐이다.
 *  - "id"              : LetsBuild 원본 엑셀의 ID 컬럼
 *  - "source_issue_no" : 시스템 재수출 파일의 source_issue_no 컬럼
 * 그 외 헤더가 이 필드로 매핑되면 시스템 UUID가 유니크 키로 오염되어
 * defect_items_raw 전체 데이터 일관성이 무너진다.
 */
export const SOURCE_ISSUE_NO_ALLOWED_HEADERS = new Set(["id", "source_issue_no"]);

export function isSourceIssueNoHeaderAllowed(rawHeader: string): boolean {
  const norm = normalizeHeader(rawHeader).replace(/\s+/g, "");
  return SOURCE_ISSUE_NO_ALLOWED_HEADERS.has(norm);
}

export function validateSourceIssueNoMapping(
  rawHeader: string,
): { ok: true } | { ok: false; error: string } {
  if (isSourceIssueNoHeaderAllowed(rawHeader)) return { ok: true };
  return {
    ok: false,
    error:
      'target_field="source_issue_no" 매핑에는 "ID" 또는 "source_issue_no" 헤더만 허용됩니다. 시스템 UUID 오염을 방지하기 위해 다른 헤더는 저장할 수 없습니다.',
  };
}

export interface HeaderMappingLike {
  id: string;
  source_header: string;
  target_field: string;
  is_active: boolean;
}

export interface ValidateResult {
  ok: boolean;
  trimmed: string;
  normalized: string;
  error?: string;
  warnings: string[];
  conflict?: HeaderMappingLike;
  noop?: boolean;
}

export function validateSourceHeaderEdit(
  rows: HeaderMappingLike[],
  id: string,
  newValue: string,
  activeTargetFields: Set<string>,
): ValidateResult {
  const warnings: string[] = [];
  const trimmed = newValue.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed) {
    return { ok: false, trimmed, normalized, error: "빈 값은 저장할 수 없습니다.", warnings };
  }

  const current = rows.find((r) => r.id === id);
  if (!current) {
    return { ok: false, trimmed, normalized, error: "대상 매핑을 찾을 수 없습니다.", warnings };
  }

  if (normalizeHeader(current.source_header) === normalized && current.source_header === trimmed) {
    return { ok: true, trimmed, normalized, warnings, noop: true };
  }

  const conflict = rows.find((r) => r.id !== id && normalizeHeader(r.source_header) === normalized);
  if (conflict) {
    return {
      ok: false,
      trimmed,
      normalized,
      error: `이미 동일한 원본 헤더가 존재합니다 (→ ${conflict.target_field}${conflict.is_active ? "" : ", 비활성"}).`,
      warnings,
      conflict,
    };
  }

  if (current.target_field === "source_issue_no") {
    const v = validateSourceIssueNoMapping(trimmed);
    if (!v.ok) return { ok: false, trimmed, normalized, error: v.error, warnings };
  }

  if (!activeTargetFields.has(current.target_field)) {
    warnings.push(`대상 필드 "${current.target_field}" 가 활성 필드 목록에 없습니다 — 매칭되어도 Import 시 무시될 수 있습니다.`);
  }
  if (normalizeHeader(trimmed) !== trimmed.toLowerCase() || trimmed !== newValue) {
    warnings.push("공백/개행이 정규화되어 저장됩니다.");
  }
  if (!current.is_active) {
    warnings.push("이 매핑은 비활성 상태입니다 — 활성화 전까지 매칭에 사용되지 않습니다.");
  }

  return { ok: true, trimmed, normalized, warnings };
}

export interface ValidateTargetResult {
  ok: boolean;
  next: string;
  error?: string;
  warnings: string[];
  noop?: boolean;
}

export function validateTargetFieldEdit(
  rows: HeaderMappingLike[],
  id: string,
  newTarget: string,
  activeTargetFields: Set<string>,
): ValidateTargetResult {
  const warnings: string[] = [];
  const next = (newTarget ?? "").trim();

  if (!next) {
    return { ok: false, next, error: "대상 필드를 선택하세요.", warnings };
  }
  const current = rows.find((r) => r.id === id);
  if (!current) {
    return { ok: false, next, error: "대상 매핑을 찾을 수 없습니다.", warnings };
  }
  if (current.target_field === next) {
    return { ok: true, next, warnings, noop: true };
  }
  if (next === "source_issue_no") {
    const v = validateSourceIssueNoMapping(current.source_header);
    if (!v.ok) return { ok: false, next, error: v.error, warnings };
  }
  const norm = normalizeHeader(current.source_header);
  const conflict = rows.find(
    (r) => r.id !== id && normalizeHeader(r.source_header) === norm && r.target_field === next,
  );
  if (conflict) {
    return {
      ok: false,
      next,
      error: `이미 동일한 (source_header → ${next}) 매핑이 존재합니다${conflict.is_active ? "" : " (비활성)"}.`,
      warnings,
    };
  }
  if (!activeTargetFields.has(next)) {
    warnings.push(`대상 필드 "${next}" 가 활성 필드 목록에 없습니다 — 매칭되어도 Import 시 무시될 수 있습니다.`);
  }
  return { ok: true, next, warnings };
}