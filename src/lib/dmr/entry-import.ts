import type { DmrParsedSection } from './types';
import type { DmrHeadcountKind } from './task-link';

/**
 * 엑셀·스크린샷 → 작성 표의 행. 저장하지 않는다.
 * 새 파서를 만들지 않는다 — 시트를 CSV 텍스트로 펴서 기존 파서(dmr-parse.functions)에 태운다.
 */
export type ParseSource = { kind: 'text'; content: string } | { kind: 'image' };

const SHEET_EXT = /\.(xlsx|xls|csv)$/i;

export async function fileToParseSource(file: File): Promise<ParseSource> {
  if (!SHEET_EXT.test(file.name)) return { kind: 'image' };
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const parts = wb.SheetNames.map((n) => `### SHEET: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`);
  return { kind: 'text', content: parts.join('\n\n').slice(0, 190_000) };
}

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
  unmatched?: boolean;
}

interface TmLike {
  plot: string | null;
  effective_pic: string | null;
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
  const out: ImportedRowSeed[] = [];
  for (const raw of section.rows ?? []) {
    const r = raw as typeof raw & {
      task_nos?: string[];
      pic_name?: string;
      headcount_kind?: DmrHeadcountKind;
    };
    const kind: DmrHeadcountKind = r.headcount_kind ?? 'worker';
    const codes = (r.task_nos ?? []).map((c) => String(c).trim()).filter(Boolean);
    const codeList = codes.length > 0 ? codes : [''];
    for (const code of codeList) {
      const tm = code ? tmByNo.get(code) : undefined;
      const unmatched = !!code && !tm;
      for (const plot of ['C', 'D'] as const) {
        const count = Math.max(0, Math.round(Number(r.values?.actual?.[plot] ?? 0)));
        if (count <= 0) continue;
        out.push(
          make({
            task_no: unmatched ? '' : code,
            system_name: String(r.system ?? '').trim(),
            contractor_name: String(r.contractor ?? '').trim(),
            // 인원 수는 시트의 Plot 열에서 왔다. TM Plot 과 다르면 행에서 경고로 드러난다.
            plot,
            pic_name: tm?.effective_pic ?? (r.pic_name ?? '').trim(),
            worker: kind === 'worker' ? String(count) : '0',
            foreman: kind === 'foreman' ? String(count) : '0',
            supervisor: kind === 'supervisor' ? String(count) : '0',
            imported: true,
            unmatched,
          }),
        );
      }
    }
  }
  return out;
}
