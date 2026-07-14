import { classifyByRules, type ClassifierInput } from "./rule-classify";
import { CLASSIFIER_FIELDS, TBD, isFieldEmpty, isMainTradeInFamily, isSubTradeInMain, resolveFamily, type ClassifierField } from "./rules";

export interface ExistingValues {
  defect_location?: string | null;
  main_trade?: string | null;
  sub_trade?: string | null;
  work_type?: string | null;
}

export interface LlmClassifyItem {
  source_issue_no: string;
  defect_location: string | null;
  main_trade: string | null;
  sub_trade: string | null;
  work_type: string | null;
}

export interface ClassifyRequestItem extends ClassifierInput {
  /** 재분류가 필요한 필드 목록 (빈 값인 필드만 포함). */
  targets: ClassifierField[];
}

/**
 * 파싱된/기존 값을 조합해 각 행별 "재분류 필요 필드"를 계산.
 * incoming = 원본에서 새로 들어온 값(임포트 경로), 없으면 undefined
 * existing = DB 기존 행의 값(재실행 경로에서만 존재)
 */
export function computeTargets(
  incoming: Partial<ExistingValues>,
  existing: Partial<ExistingValues> | undefined,
): ClassifierField[] {
  const targets: ClassifierField[] = [];
  for (const f of CLASSIFIER_FIELDS) {
    const inc = (incoming as any)[f];
    const exi = existing ? (existing as any)[f] : undefined;
    // 원본에 값이 있으면 스킵 (증분 처리)
    if (!isFieldEmpty(inc)) continue;
    // 원본 비었고 DB 값도 이미 있으면 스킵 (DB 존중)
    if (existing && !isFieldEmpty(exi)) continue;
    targets.push(f);
  }
  return targets;
}

/**
 * 규칙+LLM 결과를 병합·계층 검증 후 최종 patch 반환.
 * targets 에 포함된 필드만 patch 에 담기며, 위반값은 폐기.
 * targets 에 있으나 어떤 방법으로도 못 채운 필드는 TBD 로 채운다.
 */
export function mergeClassification(params: {
  input: ClassifierInput;
  targets: ClassifierField[];
  ruleResult: Partial<Record<ClassifierField, string>>;
  llmResult?: Partial<Record<ClassifierField, string | null>>;
}): Partial<Record<ClassifierField, string>> {
  const { input, targets, ruleResult, llmResult } = params;
  const family = resolveFamily(input.category);
  const out: Partial<Record<ClassifierField, string>> = {};

  for (const f of targets) {
    const fromRule = ruleResult[f];
    const fromLlm = llmResult?.[f] ?? undefined;
    let v: string | undefined = fromRule || (fromLlm && String(fromLlm).trim()) || undefined;
    if (!v) v = TBD;
    out[f] = v;
  }

  // 계층 검증
  if (family) {
    if (out.main_trade && out.main_trade !== TBD && !isMainTradeInFamily(out.main_trade, family)) {
      out.main_trade = TBD;
    }
    if (out.sub_trade && out.sub_trade !== TBD) {
      const mt = out.main_trade;
      if (!mt || mt === TBD || !isSubTradeInMain(out.sub_trade, mt, family)) {
        out.sub_trade = TBD;
      }
    }
  } else {
    // family 판별 불가 → trade 계열은 TBD 로 강제
    if (out.main_trade) out.main_trade = TBD;
    if (out.sub_trade) out.sub_trade = TBD;
  }

  return out;
}

/**
 * targets 있는 행들에 대해 규칙 분류를 실행하고,
 * 규칙으로 다 채우지 못한 행만 LLM 큐에 남겨 반환.
 */
export function runRuleStage(rows: ClassifyRequestItem[]): {
  ruleResults: Map<string, Partial<Record<ClassifierField, string>>>;
  needsLlm: ClassifyRequestItem[];
} {
  const ruleResults = new Map<string, Partial<Record<ClassifierField, string>>>();
  const needsLlm: ClassifyRequestItem[] = [];
  for (const r of rows) {
    const only = r.targets;
    const rr = classifyByRules(r, only);
    ruleResults.set(r.source_issue_no, rr);
    // 아직 못 채운 target 이 있으면 LLM 큐
    const remaining = only.filter((f) => !rr[f as keyof typeof rr]);
    if (remaining.length > 0) {
      needsLlm.push({ ...r, targets: remaining });
    }
  }
  return { ruleResults, needsLlm };
}