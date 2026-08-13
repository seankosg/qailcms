import { todayInDoha } from '@/lib/time/doha';

/**
 * DMR 보고일 정규화 — 날짜 오적재 재발 방지의 유일한 근거.
 *
 * 배경(2026-08-13 사고): 양식의 "11/8/26"(=2026-08-11)이
 * `new Date(s)` 폴백으로 넘어가 미국식 월-우선(11월 8일)으로 읽혔고,
 * 284행이 2026-11-08 로 적재됐다. 그래서 이 함수는
 *   ① 항상 일(day) 우선으로 읽고,
 *   ② 두 자리 연도(YY)를 명시적으로 지원하며,
 *   ③ 어떤 경우에도 `new Date(문자열)` 폴백을 쓰지 않는다.
 * 모양을 모르면 던진다. 추측하지 않는다.
 */
export function normalizeDmrReportDate(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!s) throw new Error('보고일이 비어 있습니다');

  const pad = (v: string) => v.padStart(2, '0');
  const y4 = (v: string) => (v.length === 4 ? v : `20${pad(v)}`);

  const MONTHS: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
  };

  let iso: string | null = null;

  // 1) YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD (연도 우선 → 월-일 순)
  const mY = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (mY) iso = `${mY[1]}-${pad(mY[2])}-${pad(mY[3])}`;

  // 2) D/M/YY(YY) — 이 양식은 항상 일 우선이다.
  if (!iso) {
    const mD = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
    if (mD) iso = `${y4(mD[3])}-${pad(mD[2])}-${pad(mD[1])}`;
  }

  // 3) D/Mon/YY(YY) — "11/Aug/26"
  if (!iso) {
    const mM = s.match(/^(\d{1,2})[.\-/\s]([A-Za-z]{3,4})[.\-/\s](\d{2}|\d{4})$/);
    if (mM) {
      const mon = MONTHS[mM[2].toLowerCase()];
      if (mon) iso = `${y4(mM[3])}-${mon}-${pad(mM[1])}`;
    }
  }

  if (!iso) throw new Error(`보고일 형식을 알 수 없습니다: "${s}" (예: 11/8/26 · 11/Aug/26 · 2026-08-11)`);

  const [yy, mm, dd] = iso.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    throw new Error(`보고일 값이 달력 범위를 벗어납니다: "${s}" → ${iso}`);
  }
  const probe = new Date(Date.UTC(yy, mm - 1, dd));
  if (probe.getUTCMonth() + 1 !== mm || probe.getUTCDate() !== dd) {
    throw new Error(`존재하지 않는 날짜입니다: "${s}" → ${iso}`);
  }
  return iso;
}

/** 미래 보고일은 없다 — 오적재의 가장 흔한 신호다. */
export function assertNotFutureReportDate(iso: string, today = todayInDoha()): void {
  if (iso > today) {
    throw new Error(`미래 날짜는 저장할 수 없습니다: ${iso} (오늘 ${today}, 도하 기준)`);
  }
}
