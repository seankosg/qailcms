// ABD OCS 브라우저 로컬 교정 — 순수 로직. 원본 패키지를 덮어쓰지 않는다.
// 교정 허용 범위는 ABD Number 매핑 1종뿐이다 (그 외는 원본 Excel 수정 후 재생성).
import { canonicalJson } from "@/lib/abd/ocs-canonical-json";
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import type { V3StageComment } from "@/lib/abd/ocs-v3-parser";

export const CORRECTIONS_SCHEMA = "ocs-corrections/1";

/** 교정 대상 고정자 — 배열 index 로 대상을 찾지 않는다. */
export type CorrectionLocator = {
  source_file_hash: string;
  source_file_name: string;
  sheet_name: string | null;
  source_row: number | null;
  sn: string | null;
  atomic_item_no: number | null;
};

export type CorrectionItem = CorrectionLocator & {
  field: "abd_number";
  before: string;
  after: string;
  after_abd_item_id: string;
  reason: "user_selected_canonical_mapping";
};

export type CorrectionsDoc = {
  schema_version: string;
  original_package_id: string;
  original_package_sha256: string;
  base_baseline_id: string;
  generated_at: string;
  items: CorrectionItem[];
};

export const locatorKey = (l: CorrectionLocator): string =>
  [
    l.source_file_hash,
    l.source_file_name,
    l.sheet_name ?? "",
    l.source_row ?? "",
    l.sn ?? "",
    l.atomic_item_no ?? "",
  ].join("|");

/** 코멘트 → locator. source_comment_id 를 S/N 대용 정본 키로 함께 쓴다. */
export function commentLocator(
  c: V3StageComment,
  sourceFileHashByName: Map<string, string>,
): CorrectionLocator {
  const name = c.source_file_name ?? "";
  return {
    source_file_hash: sourceFileHashByName.get(name) ?? "",
    source_file_name: name,
    sheet_name: c.source_sheet_name,
    source_row: c.source_row_index,
    sn: c.source_comment_id,
    atomic_item_no: c.atomic_item_no,
  };
}

export function makeCorrectionsDoc(
  originalPackageId: string,
  originalPackageSha256: string,
  baseBaselineId: string,
  items: CorrectionItem[],
  generatedAt = new Date().toISOString(),
): CorrectionsDoc {
  return {
    schema_version: CORRECTIONS_SCHEMA,
    original_package_id: originalPackageId,
    original_package_sha256: originalPackageSha256,
    base_baseline_id: baseBaselineId,
    generated_at: generatedAt,
    items: [...items].sort((a, b) =>
      `${locatorKey(a)}|${a.before}`.localeCompare(`${locatorKey(b)}|${b.before}`),
    ),
  };
}

export const correctionsSha256 = (doc: CorrectionsDoc): Promise<string> =>
  sha256Hex(canonicalJson(doc));

/**
 * 교정을 atomic 코멘트 배열에 적용한다 (abd_numbers 만 치환).
 * before 값이 실제 행에 없으면 적용하지 않고 실패로 보고한다 (조용한 무시 금지).
 */
export function applyCorrections(
  comments: V3StageComment[],
  doc: CorrectionsDoc,
  sourceFileHashByName: Map<string, string>,
): { comments: V3StageComment[]; applied: number; failures: string[] } {
  const byKey = new Map<string, CorrectionItem[]>();
  for (const it of doc.items) {
    const list = byKey.get(locatorKey(it)) ?? [];
    list.push(it);
    byKey.set(locatorKey(it), list);
  }
  const used = new Set<string>();
  let applied = 0;
  const failures: string[] = [];

  const out = comments.map((c) => {
    const key = locatorKey(commentLocator(c, sourceFileHashByName));
    const items = byKey.get(key);
    if (!items || items.length === 0) return c;
    used.add(key);
    let numbers = [...c.abd_numbers];
    for (const it of items) {
      const idx = numbers.indexOf(it.before);
      if (idx < 0) {
        failures.push(
          `교정 before 값이 대상 행에 없습니다: ${it.source_file_name} / row ${it.source_row ?? "?"} / ${it.before}`,
        );
        continue;
      }
      numbers[idx] = it.after;
      applied += 1;
    }
    numbers = [...new Set(numbers)];
    return { ...c, abd_numbers: numbers };
  });

  for (const [key, items] of byKey) {
    if (!used.has(key)) {
      failures.push(
        `교정 대상 행을 패키지에서 찾을 수 없습니다: ${items[0]?.source_file_name ?? key}`,
      );
    }
  }
  return { comments: out, applied, failures };
}
