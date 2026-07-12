export function normalizeHeader(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
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