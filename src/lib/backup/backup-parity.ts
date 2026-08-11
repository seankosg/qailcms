import { BACKUP_TABLES, MODULE_PRE_IMPORT_TABLES, type PreImportModule } from "./backup-shared";

export type ParityScope = "global" | PreImportModule;

export type ParityInput = {
  scope: ParityScope;
  /** DB 정본 목록(get_backup_tables) */
  dbTables: string[];
  /** 코드 백업 목록(BACKUP_TABLES) — 전체 검사 기준 */
  codeTables: string[];
  /** 정렬키가 정의된 테이블 */
  sortKeyTables: string[];
  /** 복원 순서가 정의된 테이블 */
  restoreOrderTables: string[];
  /** 모듈 검사에서 사용할 대상 목록(MODULE_PRE_IMPORT_TABLES[module]) */
  scopeTables: string[];
  /** DB 에서 유도한 해당 모듈의 영구 정본 테이블(get_module_backup_tables) */
  moduleCanonicalTables?: string[];
};

export type ParityResult = {
  scope: ParityScope;
  ok: boolean;
  /** DB 에만 있고 코드 목록에 없는 테이블 (전체 검사 전용) */
  missingInCode: string[];
  /** 코드 목록에 있으나 DB 에 존재하지 않는 테이블 */
  missingInDb: string[];
  /** 정렬키 누락 */
  missingSortKey: string[];
  /** 복원 순서 누락 */
  missingRestoreOrder: string[];
  /** 모듈 정본 테이블 누락 */
  missingModuleCanonical: string[];
  /** 검사 대상 목록 내 중복 테이블명 */
  duplicates: string[];
};

function dup(list: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const t of list) {
    if (seen.has(t)) out.add(t);
    seen.add(t);
  }
  return [...out];
}

/**
 * 백업 목록 정합성 평가(순수 함수).
 * - scope="global": 전역 목록(DB ↔ BACKUP_TABLES ↔ 정렬키 ↔ 복원순서) 전체 대조
 * - scope=모듈: 해당 모듈 목록만 대조. 다른 모듈 전용 테이블의 불일치는 무시한다.
 */
export function evaluateParity(input: ParityInput): ParityResult {
  const dbSet = new Set(input.dbTables.filter(Boolean));
  const sortKeySet = new Set(input.sortKeyTables);
  const restoreSet = new Set(input.restoreOrderTables);
  const isGlobal = input.scope === "global";
  const target = isGlobal ? input.codeTables : input.scopeTables;

  const missingInCode = isGlobal ? [...dbSet].filter((t) => !new Set(input.codeTables).has(t)) : [];
  const missingInDb = target.filter((t) => !dbSet.has(t));
  const missingSortKey = target.filter((t) => !sortKeySet.has(t));
  const missingRestoreOrder = target.filter((t) => !restoreSet.has(t));
  const duplicates = dup(target);
  const missingModuleCanonical = isGlobal
    ? []
    : (input.moduleCanonicalTables ?? []).filter((t) => !new Set(target).has(t));

  const ok =
    missingInCode.length === 0 &&
    missingInDb.length === 0 &&
    missingSortKey.length === 0 &&
    missingRestoreOrder.length === 0 &&
    missingModuleCanonical.length === 0 &&
    duplicates.length === 0;

  return {
    scope: input.scope,
    ok,
    missingInCode,
    missingInDb,
    missingSortKey,
    missingRestoreOrder,
    missingModuleCanonical,
    duplicates,
  };
}

export function parityErrorMessage(r: ParityResult): string {
  const label = r.scope === "global" ? "전체 백업" : `${r.scope.toUpperCase()} 사전 백업`;
  const parts: string[] = [];
  if (r.missingInCode.length) parts.push(`DB에만 있음: [${r.missingInCode.join(", ")}]`);
  if (r.missingInDb.length) parts.push(`DB에 없음: [${r.missingInDb.join(", ")}]`);
  if (r.missingSortKey.length) parts.push(`정렬키 누락: [${r.missingSortKey.join(", ")}]`);
  if (r.missingRestoreOrder.length)
    parts.push(`복원 순서 누락: [${r.missingRestoreOrder.join(", ")}]`);
  if (r.missingModuleCanonical.length)
    parts.push(`모듈 정본 테이블 누락: [${r.missingModuleCanonical.join(", ")}]`);
  if (r.duplicates.length) parts.push(`중복 테이블: [${r.duplicates.join(", ")}]`);
  return `${label} 목록 불일치 — ${parts.join(" / ")}`;
}

export function scopeTablesFor(scope: ParityScope): string[] {
  return scope === "global" ? [...BACKUP_TABLES] : [...MODULE_PRE_IMPORT_TABLES[scope]];
}
