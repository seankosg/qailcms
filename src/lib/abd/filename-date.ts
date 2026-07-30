import { todayInDoha } from "@/lib/time/doha";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * 파일명에서 Data Date 후보를 추출한다 (TZ 계산 없이 순수 숫자 파싱).
 * 지원 포맷: YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD / YYYYMMDD
 *          DD-MMM-YYYY / DDMMMYYYY / MMM-DD-YYYY
 *          DD-MM-YYYY / DD.MM.YYYY
 * 미래 날짜(Doha 오늘 이후)는 무시한다. 없으면 null.
 */
export function parseDataDateFromFileName(name: string): string | null {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const today = todayInDoha();
  const candidates: string[] = [];

  const push = (s: string | null) => {
    if (s && s <= today) candidates.push(s);
  };

  // YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD
  for (const m of base.matchAll(/(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})/g)) {
    push(valid(+m[1], +m[2], +m[3]));
  }
  // YYYYMMDD
  for (const m of base.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)) {
    push(valid(+m[1], +m[2], +m[3]));
  }
  // DD-MMM-YYYY / DDMMMYYYY
  for (const m of base.matchAll(/(?<!\d)(\d{1,2})[-_. ]?([A-Za-z]{3,4})[-_. ]?(20\d{2})/g)) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) push(valid(+m[3], mo, +m[1]));
  }
  // MMM-DD-YYYY
  for (const m of base.matchAll(/([A-Za-z]{3,4})[-_. ]?(\d{1,2})[-_. ,]+(20\d{2})/g)) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) push(valid(+m[3], mo, +m[2]));
  }
  // DD-MM-YYYY / DD.MM.YYYY
  for (const m of base.matchAll(/(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/g)) {
    push(valid(+m[3], +m[2], +m[1]));
  }

  if (candidates.length === 0) return null;
  // 가장 늦은(최신) 후보 채택
  candidates.sort();
  return candidates[candidates.length - 1];
}
