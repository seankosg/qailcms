import {
  FAMILY_GENERAL,
  LOCATION_RULES,
  TRADE_RULES,
  WORK_TYPE_RULES,
  isMainTradeInFamily,
  isSubTradeInMain,
  resolveFamily,
  type TradeFamily,
} from "./rules";

export interface ClassifierInput {
  source_issue_no: string;
  type: string | null | undefined;      // defect_type
  item: string | null | undefined;
  description: string | null | undefined;
  category: string | null | undefined;
}

export interface ClassificationResult {
  defect_location?: string;
  main_trade?: string;
  sub_trade?: string;
  work_type?: string;
}

function containsAny(haystack: string, kws: string[]): boolean {
  for (const k of kws) {
    if (haystack.includes(k)) return true;
  }
  return false;
}

function joinLower(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "")).join(" ").toLowerCase();
}

/**
 * 규칙 기반 분류. 매칭되는 필드만 반환한다. (undefined는 LLM 폴백 대상)
 * `only` 로 대상 필드를 제한할 수 있다.
 */
export function classifyByRules(
  input: ClassifierInput,
  only?: readonly ("defect_location" | "main_trade" | "sub_trade" | "work_type")[],
): ClassificationResult {
  const need = new Set(only ?? ["defect_location", "main_trade", "sub_trade", "work_type"]);
  const out: ClassificationResult = {};

  const type = (input.type ?? "").toLowerCase();
  const item = (input.item ?? "").toLowerCase();
  const desc = (input.description ?? "").toLowerCase();
  const combined = joinLower(input.type, input.item, input.description);

  // 1) Main/Sub Trade — Category 로 family 확정, Type→Item→Description 순으로 키워드 매칭
  if (need.has("main_trade") || need.has("sub_trade")) {
    const family = resolveFamily(input.category);
    if (family) {
      const matched = matchTrade(family, [type, item, desc]);
      if (matched) {
        if (need.has("main_trade")) out.main_trade = matched.main_trade;
        if (need.has("sub_trade")) out.sub_trade = matched.sub_trade;
      } else if (family !== "Architectural") {
        // family 는 확정되었으나 세부 규칙 미매칭 → "General <family>"
        const g = FAMILY_GENERAL[family];
        if (need.has("main_trade")) out.main_trade = g.main_trade;
        if (need.has("sub_trade")) out.sub_trade = g.sub_trade;
      }
      // 계층 위반이면 폐기 (방어)
      if (out.main_trade && !isMainTradeInFamily(out.main_trade, family)) delete out.main_trade;
      if (out.main_trade && out.sub_trade && !isSubTradeInMain(out.sub_trade, out.main_trade, family)) {
        delete out.sub_trade;
      }
    }
  }

  // 2) Defect Location — 독립축
  if (need.has("defect_location")) {
    for (const rule of LOCATION_RULES) {
      if (containsAny(combined, rule.keywords)) {
        out.defect_location = rule.value;
        break;
      }
    }
  }

  // 3) Work Type — Item + Description
  if (need.has("work_type")) {
    const wtInput = joinLower(input.item, input.description);
    for (const rule of WORK_TYPE_RULES) {
      if (containsAny(wtInput, rule.keywords)) {
        out.work_type = rule.value;
        break;
      }
    }
  }

  return out;
}

function matchTrade(
  family: TradeFamily,
  sources: string[],
): { main_trade: string; sub_trade: string } | null {
  const rules = TRADE_RULES[family];
  for (const src of sources) {
    if (!src) continue;
    for (const rule of rules) {
      if (containsAny(src, rule.keywords)) {
        return { main_trade: rule.main_trade, sub_trade: rule.sub_trade };
      }
    }
  }
  return null;
}