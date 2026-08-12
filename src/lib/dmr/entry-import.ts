import type { DmrParsedSection } from './types';

/**
 * 스크린샷 파싱 결과 → 작성 표의 행. 저장하지 않는다.
 * 양식에서 읽는 것은 넷뿐이다 — TM Code · Today(인원) · System · Contractor.
 * Plot · 담당자 · Work Type · 계획/실적% 는 전부 TM 에서 온다.
 */

export interface ImportedRowSeed {
  key: string;
  task_no: string;
  system_name: string;
  contractor_name: string;
  plot: 'C' | 'D';
  pic_name: string;
  manpower: string;
  imported?: boolean;
  /** TM 에서 찾지 못한 코드 */
  unmatched?: boolean;
  /** 한 줄에 코드가 여럿 — 코드마다 같은 인원이 실린다 */
  multiCode?: boolean;
  /** 스크린샷 내 원래 행 순서 */
  importIndex?: number;
}

interface TmLike {
  plot: string | null;
  effective_pic: string | null;
}

/** 코드 모양인가 (ME-C-06 · AR-C-T-12 · ME-D-08-06). "Monitoring" 같은 말은 코드가 아니다. */
const CODE_RE = /^[A-Za-z]{1,4}-[A-Za-z0-9]{1,4}(?:-[A-Za-z0-9]{1,4})+$/;
const TOTAL_RE = /(^|[\s_])(total|합계)([\s_]|$)/i;

/**
 * OCR 은 하이픈을 en-dash·minus 로 읽고 앞뒤에 공백·제로폭 문자를 섞는다.
 * 대조 전에 그 흔들림을 없앤다. 글자 자체를 바꾸지는 않는다.
 */
export function normalizeTaskCode(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFF0D\u30FC\u2043]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim()
    .toUpperCase();
}

function splitCodes(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,\n/·|]+/)
    .map((s) => normalizeTaskCode(s))
    .filter((s) => CODE_RE.test(s));
}

interface Agg {
  codes: string[];
  count: number;
  system: string;
  contractor: string;
  importIndex: number;
}

/**
 * TM Code 는 반드시 대조한다. 없으면 코드 칸을 비우고 unmatched 로 표시한다.
 * 비슷한 코드로 추측 매칭하지 않는다.
 */
export function buildDmrEntryRowsFromSection(
  section: DmrParsedSection,
  tmByNo: Map<string, TmLike>,
  make: (init: Partial<ImportedRowSeed>) => ImportedRowSeed,
  baseIndex = 0,
): ImportedRowSeed[] {
  // TM 코드도 같은 규칙으로 접어 대조한다 (대소문자·대시 모양 차이 흡수).
  const tmNorm = new Map<string, { code: string; tm: TmLike }>();
  for (const [code, tm] of tmByNo) {
    const k = normalizeTaskCode(code);
    if (!tmNorm.has(k)) tmNorm.set(k, { code, tm });
  }

  // ① 같은 코드 묶음이 두 번 나오면 합친다. 합치지 않으면 UPSERT 에서 뒤엣것이 앞엣것을 덮는다.
  const byCode = new Map<string, Agg>();
  const codeless: Agg[] = [];

  const sectionRows = (section.rows ?? []) as unknown as Array<Record<string, unknown>>;
  for (let idx = 0; idx < sectionRows.length; idx++) {
    const raw = sectionRows[idx];
    const system = String(raw.system ?? '').trim();
    const contractor = String(raw.contractor ?? '').trim();
    // ⑤ 합계 줄은 버린다
    if (TOTAL_RE.test(system) || TOTAL_RE.test(contractor)) continue;

    const count = Math.max(0, Math.round(Number(raw.count ?? 0) || 0));
    if (count <= 0) continue; // '-' · 빈칸 · 0 은 건너뛴다

    const importIndex = baseIndex + idx;

    // ②③ 코드 모양이 아니거나 아예 없으면 코드 없음으로 다룬다. 인원은 살린다.
    const codes = splitCodes(raw.task_no ?? (raw as { task_nos?: unknown }).task_nos);
    if (codes.length === 0) {
      codeless.push({ codes: [], count, system, contractor, importIndex });
      continue;
    }
    const key = codes.join('+');
    const prev = byCode.get(key);
    if (prev) {
      prev.count += count;
    } else {
      byCode.set(key, { codes: [...codes], count, system, contractor, importIndex });
    }
  }

  const out: ImportedRowSeed[] = [];

  const emit = (a: Agg, code: string, count: number, multiCode: boolean) => {
    const hit = code ? tmNorm.get(normalizeTaskCode(code)) : undefined;
    const tm = hit?.tm;
    const unmatched = !!code && !hit;
    out.push(
      make({
        task_no: unmatched ? '' : (hit?.code ?? code),
        system_name: a.system,
        contractor_name: a.contractor,
        // Plot 은 TM 에서 온다. 시트의 열을 보고 고치지 않는다.
        plot: tm?.plot === 'D' ? 'D' : 'C',
        pic_name: tm?.effective_pic ?? '',
        manpower: String(count),
        imported: true,
        unmatched,
        multiCode,
        importIndex: a.importIndex,
      }),
    );
  };

  for (const a of byCode.values()) {
    // 한 줄에 코드가 여럿이면 코드마다 같은 인원을 싣는다. 나누지 않는다.
    a.codes.forEach((code) => emit(a, code, a.count, a.codes.length > 1));
  }
  for (const a of codeless) emit(a, '', a.count, false);

  return out;
}
