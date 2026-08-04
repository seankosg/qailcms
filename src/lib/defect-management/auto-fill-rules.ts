/**
 * SM Import Auto-fill Rules
 * - Subcon rule: Plot + Room Group + Trade 키워드 매칭
 *
 * 원본 엑셀 값 또는 기존 DB 값이 있으면 덮어쓰지 않음.
 *
 * (2026-08-04) HDEC PIC/ENG 자동 채움 규칙은 폐지되었다.
 * 담당자 값은 임포트 파일 또는 명부 정본만을 소스로 한다.
 */

export interface SubconRule {
  id: string;
  plot: string;
  room_group: string;
  trade_keywords: string[];
  subcontractor_name: string;
  sort_order: number;
  is_active: boolean;
}

const norm = (v: unknown): string =>
  (v == null ? "" : String(v)).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * plan_group 문자열 → 'C' | 'D' | null
 * - "Plot D" 포함 or "Tower 4" → D
 * - "Plot C" 포함 or "Tower 3" → C
 */
export function resolvePlotFromPlanGroup(planGroup: string | null | undefined): "C" | "D" | null {
  const s = norm(planGroup);
  if (!s) return null;
  if (s.includes("plot d") || s.includes("tower 4")) return "D";
  if (s.includes("plot c") || s.includes("tower 3")) return "C";
  return null;
}

/**
 * Subcon 결정.
 * (1) main_trade/sub_trade 가 trade_keywords 중 하나와 정확 일치하면 hit.
 * (2) 없으면 description 에 trade_keywords 중 하나라도 substring 포함이면 hit.
 * room_group 은 plan_group OR room_group 매칭.
 */
export function resolveSubcon(
  rules: SubconRule[],
  plot: "C" | "D",
  planGroup: string | null | undefined,
  roomGroup: string | null | undefined,
  mainTrade: string | null | undefined,
  subTrade: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const nPlan = norm(planGroup);
  const nRoom = norm(roomGroup);
  const nMain = norm(mainTrade);
  const nSub = norm(subTrade);
  const nDesc = norm(description);

  // Pass 1: trade 정확 일치
  for (const r of rules) {
    if (!r.is_active) continue;
    if (r.plot !== plot) continue;
    const nRuleRoom = norm(r.room_group);
    if (!nRuleRoom || (nRuleRoom !== nPlan && nRuleRoom !== nRoom)) continue;
    for (const kw of r.trade_keywords ?? []) {
      const nkw = norm(kw);
      if (!nkw) continue;
      if (nkw === nMain || nkw === nSub) return r.subcontractor_name;
    }
  }

  // Pass 2: description 부분 일치
  if (nDesc) {
    for (const r of rules) {
      if (!r.is_active) continue;
      if (r.plot !== plot) continue;
      const nRuleRoom = norm(r.room_group);
      if (!nRuleRoom || (nRuleRoom !== nPlan && nRuleRoom !== nRoom)) continue;
      for (const kw of r.trade_keywords ?? []) {
        const nkw = norm(kw);
        if (!nkw) continue;
        if (nDesc.includes(nkw)) return r.subcontractor_name;
      }
    }
  }

  return null;
}