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
  worker: string;
  foreman: string;
  supervisor: string;
  imported?: boolean;
  /** TM 에서 찾지 못한 코드 */
  unmatched?: boolean;
  /** 한 줄에 코드가 여럿 — 인원은 첫 코드에만 실린다 */
  multiCode?: boolean;
}

interface TmLike {
  plot: string | null;
  effective_pic: string | null;
}

/** 코드 모양인가 (ME-C-06 · AR-C-T-12 · ME-D-08-06). "Monitoring" 같은 말은 코드가 아니다. */
const CODE_RE = /^[A-Za-z]{1,4}-[A-Za-z0-9]{1,4}(?:-[A-Za-z0-9]{1,4})+$/;
const TOTAL_RE = /(^|[\s_])(total|합계)([\s_]|$)/i;

function splitCodes(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,\n/·|]+/)
    .map((s) => s.trim())
    .filter((s) => CODE_RE.test(s));
}

interface Agg {
  codes: string[];
  count: number;
  system: string;
  contractor: string;
}

/**
 * TM Code 는 반드시 대조한다. 없으면 코드 칸을 비우고 unmatched 로 표시한다.
 * 비슷한 코드로 추측 매칭하지 않는다.
 */
export function buildDmrEntryRowsFromSection(
  section: DmrParsedSection,
  tmByNo: Map<string, TmLike>,
  make: (init: Partial<ImportedRowSeed>) => ImportedRowSeed,
): ImportedRowSeed[] {
  // ① 같은 코드가 두 번 나오면 합친다. 합치지 않으면 UPSERT 에서 뒤엣것이 앞엣것을 덮는다.
  const byCode = new Map<string, Agg>();
  const codeless: Agg[] = [];

  for (const raw of (section.rows ?? []) as unknown as Array<Record<string, unknown>>) {
    const system = String(raw.system ?? '').trim();
    const contractor = String(raw.contractor ?? '').trim();
    // ⑤ 합계 줄은 버린다
    if (TOTAL_RE.test(system) || TOTAL_RE.test(contractor)) continue;

    const count = Math.max(0, Math.round(Number(raw.count ?? 0) || 0));
    if (count <= 0) continue; // '-' · 빈칸 · 0 은 건너뛴다

    // ②③ 코드 모양이 아니거나 아예 없으면 코드 없음으로 다룬다. 인원은 살린다.
    const codes = splitCodes(raw.task_no ?? (raw as { task_nos?: unknown }).task_nos);
    if (codes.length === 0) {
      codeless.push({ codes: [], count, system, contractor });
      continue;
    }
    const key = codes[0];
    const prev = byCode.get(key);
    if (prev) {
      prev.count += count;
      for (const c of codes) if (!prev.codes.includes(c)) prev.codes.push(c);
    } else {
      byCode.set(key, { codes: [...codes], count, system, contractor });
    }
  }

  const out: ImportedRowSeed[] = [];

  const emit = (a: Agg, code: string, count: number, multiCode: boolean) => {
    const tm = code ? tmByNo.get(code) : undefined;
    const unmatched = !!code && !tm;
    out.push(
      make({
        task_no: unmatched ? '' : code,
        system_name: a.system,
        contractor_name: a.contractor,
        // Plot 은 TM 에서 온다. 시트의 열을 보고 고치지 않는다.
        plot: tm?.plot === 'D' ? 'D' : 'C',
        pic_name: tm?.effective_pic ?? '',
        worker: String(count),
        foreman: '0',
        supervisor: '0',
        imported: true,
        unmatched,
        multiCode,
      }),
    );
  };

  for (const a of byCode.values()) {
    // ⑤(§5) 코드가 여럿이면 첫 코드에만 인원을 싣는다. 자동 등분하지 않는다.
    a.codes.forEach((code, i) => emit(a, code, i === 0 ? a.count : 0, a.codes.length > 1));
  }
  for (const a of codeless) emit(a, '', a.count, false);

  return out;
}
