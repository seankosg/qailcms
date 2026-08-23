/**
 * ABD Aconex — Termination(`is_terminated`) 정본 전환 로직.
 *
 * 배경: Terminated 사건은 `is_terminated=true` 를 기록하지만, 이후 재제출/회신 사건이
 * 들어와도 해제하는 전환이 없어 Dashboard `Resubmit by TM` 에 잔류한다.
 * (Cancelled 는 `is_active=false` 라는 별도 축이며 여기서 자동 복구하지 않는다.)
 *
 * 이 모듈은 순수 함수만 둔다 — 서버 함수 파일(`aconex-import.functions.ts`)에서 import.
 */

export type AconexSemantic =
  | "DAR_APPROVED_A"
  | "DAR_APPROVED_B"
  | "DAR_REJECTED"
  | "SUBMITTED"
  | "EXCLUDED_TERMINATED"
  | "EXCLUDED_CANCELLED"
  | "UNKNOWN";

/** Termination 해제 근거로 인정하는 후속 정상 사건 (D-code 는 호출부에서 별도 배제). */
export const TERMINATION_CLEAR_SEMANTICS: ReadonlySet<string> = new Set([
  "SUBMITTED",
  "DAR_APPROVED_A",
  "DAR_APPROVED_B",
  "DAR_REJECTED",
]);

export const TERMINATION_CLEAR_REASON = "termination_cleared_by_newer_aconex_event";
export const TERMINATION_SAME_DATE_DETAIL = "same_date_unambiguous_transition";

export interface BatchRowLike {
  document_no: string;
  date_modified?: string | null;
  semantic?: AconexSemantic | string | null;
  status_code?: string | null;
  excel_row?: number | null;
}

export function isDCodeRow(r: { status_code?: string | null }): boolean {
  return String(r.status_code ?? "").toUpperCase() === "D";
}

/** YYYY-MM-DD 형태로 정규화. 유효하지 않으면 null. */
export function normDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : iso;
}

export interface BatchBlocker {
  document_no: string;
  date_modified: string | null;
  semantics: string[];
}

export interface NormalizedBatch<T extends BatchRowLike> {
  /** 문서당 1행으로 축약된 처리 대상. blocker 문서는 제외된다. */
  rows: T[];
  /** 동일 문서 + 동일 날짜 + 상충 semantic → 자동 판정 금지 */
  blockers: BatchBlocker[];
  /** 문서별 "최신 날짜 사건이 단일 semantic 으로 확정됨" 여부 */
  unambiguous: Map<string, boolean>;
  /** 결정론적 축약으로 제거된 중복 행수 */
  collapsedDuplicates: number;
}

/**
 * §3.1 입력 배치 결정론.
 *  1) 날짜가 다르면 최신 날짜 행 사용
 *  2) 동일 날짜 + 동일 semantic → 결정론적 축약(excel_row 최소 → 그다음 원본 인덱스)
 *  3) 동일 날짜 + 상충 semantic → blocker (자동 우선순위 금지)
 *  4) 파일 행 순서에 의존하지 않음
 * 날짜가 없는 행은 날짜 있는 행보다 항상 후순위이며, 전부 날짜가 없으면 그들끼리 위 규칙 적용.
 */
export function normalizeAconexBatch<T extends BatchRowLike>(rows: T[]): NormalizedBatch<T> {
  const groups = new Map<string, Array<{ row: T; idx: number }>>();
  rows.forEach((row, idx) => {
    const key = row.document_no;
    const arr = groups.get(key);
    if (arr) arr.push({ row, idx });
    else groups.set(key, [{ row, idx }]);
  });

  const out: T[] = [];
  const blockers: BatchBlocker[] = [];
  const unambiguous = new Map<string, boolean>();
  let collapsedDuplicates = 0;

  for (const [doc, entries] of groups) {
    // 1) 최신 날짜 선별 (날짜 없음 = 최하위)
    let best: string | null = null;
    let hasDated = false;
    for (const e of entries) {
      const d = normDate(e.row.date_modified);
      if (d == null) continue;
      hasDated = true;
      if (best == null || d > best) best = d;
    }
    const top = entries.filter((e) => {
      const d = normDate(e.row.date_modified);
      return hasDated ? d === best : d == null;
    });

    // 2) semantic 유일성 판정
    const semantics = Array.from(new Set(top.map((e) => String(e.row.semantic ?? "UNKNOWN")))).sort();
    if (semantics.length > 1) {
      blockers.push({ document_no: doc, date_modified: best, semantics });
      unambiguous.set(doc, false);
      continue;
    }
    unambiguous.set(doc, true);

    // 3) 결정론적 대표 행 선택
    const sorted = [...top].sort((a, b) => {
      const ar = a.row.excel_row ?? Number.MAX_SAFE_INTEGER;
      const br = b.row.excel_row ?? Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return a.idx - b.idx;
    });
    out.push(sorted[0].row);
    collapsedDuplicates += entries.length - 1;
  }

  // 결과 순서도 결정론적으로 (문서번호 사전순)
  out.sort((a, b) => a.document_no.localeCompare(b.document_no));
  blockers.sort((a, b) => a.document_no.localeCompare(b.document_no));
  return { rows: out, blockers, unambiguous, collapsedDuplicates };
}

export type TerminationAction =
  | { kind: "set" } // Terminated 사건 → true
  | { kind: "clear"; sameDate: boolean } // 후속 정상 사건 → false
  | { kind: "none"; warning?: "missing_date" };

export interface TerminationInput {
  row: BatchRowLike;
  existing: {
    is_terminated?: boolean | null;
    is_active?: boolean | null;
    aconex_date_modified?: string | null;
  } | null
  | undefined;
  /** 배치에서 해당 문서의 최신 날짜 사건이 단일 semantic 으로 확정됐는지 */
  sameDateUnambiguous: boolean;
}

/**
 * §3.2 / §3.3 — `allowed` preset 과 무관하게 "이 배치가 is_terminated 를 건드리는가"를 판정.
 * preset 누락 blocker(§3.4) 판정에도 동일 함수를 사용한다.
 */
export function resolveTerminationAction({
  row,
  existing,
  sameDateUnambiguous,
}: TerminationInput): TerminationAction {
  const semantic = String(row.semantic ?? "UNKNOWN");
  const incoming = normDate(row.date_modified);
  const current = normDate(existing?.aconex_date_modified);

  // Cancelled(is_active=false) 는 어느 방향으로도 자동 변경하지 않는다.
  if (existing?.is_active === false) return { kind: "none" };

  // ---- 설정 경로 (§3.1/§3.2) — 과거 Terminated 파일이 최신 상태를 되돌리지 못하게 한다.
  if (semantic === "EXCLUDED_TERMINATED") {
    if (incoming == null) return { kind: "none", warning: "missing_date" };
    if (current == null) return { kind: "set" }; // 비교 기준 없음 = 최초 사건
    if (incoming > current) return { kind: "set" };
    if (incoming === current) {
      // 같은 날짜에 다른 semantic 이 섞여 있으면 순서를 알 수 없다 → 설정 금지(blocker 처리).
      if (!sameDateUnambiguous) return { kind: "none" };
      return { kind: "set" }; // 기존이 이미 true 면 멱등 no-op
    }
    return { kind: "none" }; // 과거 사건
  }
  if (semantic === "EXCLUDED_CANCELLED") return { kind: "none" };

  // ---- 해제 경로 (§3.3)
  if (existing?.is_terminated !== true) return { kind: "none" };
  if (!TERMINATION_CLEAR_SEMANTICS.has(semantic)) return { kind: "none" };
  if (isDCodeRow(row)) return { kind: "none" };
  if (incoming == null || current == null) return { kind: "none", warning: "missing_date" };

  if (incoming > current) return { kind: "clear", sameDate: false };
  if (incoming === current) {
    return sameDateUnambiguous ? { kind: "clear", sameDate: true } : { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * Termination 관련 preset 필드는 원자적 필수 묶음이다.
 * 플래그만 바뀌고 최신 날짜/원문 상태가 갱신되지 않는 부분 반영을 금지한다.
 */
export const TERMINATION_REQUIRED_FIELDS = [
  "is_terminated",
  "aconex_date_modified",
  "aconex_status_raw",
  "aconex_review_status_raw",
] as const;

export function assertTerminationFieldsAllowed(
  touchingDocs: string[],
  allowed: ReadonlySet<string>,
): void {
  if (touchingDocs.length === 0) return;
  const missing = TERMINATION_REQUIRED_FIELDS.filter((f) => !allowed.has(f));
  if (missing.length === 0) return;
  throw new Error(
    `TERMINATION_FIELDS_NOT_ALLOWED: Termination 설정/해제 사건 ${touchingDocs.length}행이 있으나 ` +
      `임포트 대상 필드에서 누락됨: ${missing.join(", ")}. ` +
      `필요한 필드 전체: ${TERMINATION_REQUIRED_FIELDS.join(", ")}. ` +
      `표본: ${touchingDocs.slice(0, 5).join(", ")}`,
  );
}


/**
 * §2.3 apply 최종 관문 — 동일 날짜 상충 사건이 하나라도 있으면
 * Import log 생성/UPDATE 이전에 전체를 차단한다(부분 반영 금지).
 */
export function assertNoSameDateConflict(blockers: BatchBlocker[]): void {
  if (blockers.length === 0) return;
  const sample = blockers
    .slice(0, 5)
    .map((b) => `${b.document_no}(${b.date_modified ?? "no-date"}: ${b.semantics.join("/")})`)
    .join(", ");
  throw new Error(
    `ACONEX_SAME_DATE_SEMANTIC_CONFLICT: 같은 도면·같은 날짜에 서로 다른 Aconex 상태가 ` +
      `${blockers.length}건 있습니다. 순서를 확정할 수 없어 Import 를 차단했습니다. 표본: ${sample}`,
  );
}
