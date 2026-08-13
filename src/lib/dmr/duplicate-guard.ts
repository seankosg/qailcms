/**
 * 같은 표를 다른 날짜로 다시 넣는 사고를 막는다.
 *
 * 배경(2026-08-13 사고): ELEC 08-01~08-12 열흘치가 업체/시스템 구성과
 * 인원(2,828명)까지 완전히 동일한 복제본이었다. 저장 경로에 "이 표를 이미
 * 다른 날에 넣었다"를 알아보는 장치가 없었다.
 */
export interface FingerprintRow {
  system_name: string;
  contractor_name: string;
  plot: string;
  actual_manpower: number;
}

/** 행 구성 + 인원 다중집합의 지문. 행 순서에 영향받지 않는다. */
export function dmrPayloadFingerprint(rows: FingerprintRow[]): string {
  return rows
    .map((r) =>
      [
        String(r.system_name ?? '').trim().toUpperCase(),
        String(r.contractor_name ?? '').trim().toUpperCase(),
        String(r.plot ?? '').trim().toUpperCase(),
        Math.round(Number(r.actual_manpower) || 0),
      ].join('\u0001'),
    )
    .sort()
    .join('\u0002');
}

export function totalActual(rows: FingerprintRow[]): number {
  return rows.reduce((s, r) => s + (Math.round(Number(r.actual_manpower) || 0)), 0);
}
