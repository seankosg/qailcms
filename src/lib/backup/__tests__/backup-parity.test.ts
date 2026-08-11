import { describe, it, expect } from "vitest";
import { evaluateParity, scopeTablesFor } from "../backup-parity";
import { BACKUP_TABLES, MODULE_PRE_IMPORT_TABLES } from "../backup-shared";

const ALL = [...BACKUP_TABLES] as string[];

function base(over: Partial<Parameters<typeof evaluateParity>[0]>) {
  return evaluateParity({
    scope: "global",
    dbTables: ALL,
    codeTables: ALL,
    sortKeyTables: ALL,
    restoreOrderTables: ALL,
    scopeTables: ALL,
    ...over,
  });
}

describe("backup parity", () => {
  it("전체 Backup: 전역 목록 불일치 → 차단", () => {
    const r = base({ dbTables: [...ALL, "spl_document_pages_new"] });
    expect(r.ok).toBe(false);
    expect(r.missingInCode).toContain("spl_document_pages_new");
  });

  it("ABD pre-import: SPL 전용 테이블만 불일치 → ABD 통과", () => {
    const r = base({
      scope: "abd",
      dbTables: ALL.filter((t) => t !== "spl_document_pages"),
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.abd],
      moduleCanonicalTables: [...MODULE_PRE_IMPORT_TABLES.abd],
    });
    expect(r.ok).toBe(true);
  });

  it("SPL pre-import: ABD 전용 테이블만 불일치 → SPL 통과", () => {
    const r = base({
      scope: "spl",
      dbTables: ALL.filter((t) => t !== "abd_ocs_comments"),
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.spl],
      moduleCanonicalTables: [...MODULE_PRE_IMPORT_TABLES.spl],
    });
    expect(r.ok).toBe(true);
  });

  it("ABD 정본 테이블 누락 → ABD 차단", () => {
    const r = base({
      scope: "abd",
      scopeTables: MODULE_PRE_IMPORT_TABLES.abd.filter((t) => t !== "abd_ocs_comments"),
      moduleCanonicalTables: ["abd_ocs_comments"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingModuleCanonical).toEqual(["abd_ocs_comments"]);
  });

  it("SPL 정본 테이블 누락 → SPL 차단", () => {
    const r = base({
      scope: "spl",
      scopeTables: MODULE_PRE_IMPORT_TABLES.spl.filter((t) => t !== "spl_document_pages"),
      moduleCanonicalTables: ["spl_document_pages"],
    });
    expect(r.ok).toBe(false);
    expect(r.missingModuleCanonical).toEqual(["spl_document_pages"]);
  });

  it("선택 모듈 테이블의 sort key 누락 → 차단", () => {
    const r = base({
      scope: "abd",
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.abd],
      sortKeyTables: ALL.filter((t) => t !== "abd_ocs_comments"),
    });
    expect(r.ok).toBe(false);
    expect(r.missingSortKey).toEqual(["abd_ocs_comments"]);
  });

  it("선택 모듈 테이블의 복원 순서 누락 → 차단", () => {
    const r = base({
      scope: "abd",
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.abd],
      restoreOrderTables: ALL.filter((t) => t !== "abd_ocs_attachments"),
    });
    expect(r.ok).toBe(false);
    expect(r.missingRestoreOrder).toEqual(["abd_ocs_attachments"]);
  });

  it("선택 모듈 목록 중복 → 차단", () => {
    const r = base({
      scope: "abd",
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.abd, "abd_ocs_comments"],
    });
    expect(r.ok).toBe(false);
    expect(r.duplicates).toEqual(["abd_ocs_comments"]);
  });

  it("DB에 존재하지 않는 코드 테이블(모듈 범위) → 차단", () => {
    const r = base({
      scope: "abd",
      scopeTables: [...MODULE_PRE_IMPORT_TABLES.abd],
      dbTables: ALL.filter((t) => t !== "abd_ocs_comments"),
    });
    expect(r.ok).toBe(false);
    expect(r.missingInDb).toEqual(["abd_ocs_comments"]);
  });

  it("정상 ABD 목록 → 통과", () => {
    const r = base({
      scope: "abd",
      scopeTables: scopeTablesFor("abd"),
      moduleCanonicalTables: [...MODULE_PRE_IMPORT_TABLES.abd],
    });
    expect(r.ok).toBe(true);
  });

  it("정상 SPL 목록 → 통과", () => {
    const r = base({
      scope: "spl",
      scopeTables: scopeTablesFor("spl"),
      moduleCanonicalTables: [...MODULE_PRE_IMPORT_TABLES.spl],
    });
    expect(r.ok).toBe(true);
  });

  it("정상 전체 목록 → 통과", () => {
    expect(base({}).ok).toBe(true);
  });
});
