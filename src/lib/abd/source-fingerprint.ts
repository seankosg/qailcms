import { extractHeadersFromFile } from "@/lib/import/module-fingerprint";

/**
 * ABD 임포트 소스 판정기 — HDEC 원본 vs Aconex Export.
 *
 * 1차: 상호배타 확정 규칙 (신호 명시적으로 존재/부재)
 *   - HDEC   = ABD NUMBER 헤더 + ROUND 밴드 헤더
 *   - Aconex = Document No 헤더 + (Review Status | Date Modified) + ABD NUMBER 부재
 * 2차: 점수제 — 1차 확정 실패 시 unknown 판별 보조로만 사용.
 *
 * 배포 마커: ABD_SOURCE_GUARD_V2_2026_08_01
 */

export const ABD_SOURCE_GUARD_MARKER = "ABD_SOURCE_GUARD_V2_2026_08_01";

export type AbdSource = "hdec" | "aconex" | "unknown";

export interface FingerprintSignals {
  hasAbdNumber: boolean;
  hasSlNo: boolean;
  hasRoundBand: boolean;
  hasPlanActualBand: boolean;
  hasDocumentNo: boolean;
  hasReviewStatus: boolean;
  hasDateModified: boolean;
  hasCreatedBy: boolean;
  hasHdecPicOrEng: boolean;
  hasBatchOrAx: boolean;
  filenameHdec: boolean;
  filenameAconex: boolean;
}

export interface AbdSourceResult {
  source: AbdSource;
  confidence: "high" | "low";
  reasons: string[];
  signals: FingerprintSignals;
  scores: { hdec: number; aconex: number };
}

function norm(s: string): string {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isAbdNumberHeader(n: string): boolean {
  return (
    n === "ABD NUMBER" ||
    n === "ABDNUMBER" ||
    n === "ABD NO" ||
    n === "ABD NUM" ||
    n === "ABD DOC NO" ||
    n === "ABD DOCUMENT NO" ||
    n === "ABD DOCUMENT NUMBER"
  );
}

export function detectAbdSourceFromHeaders(
  headers: string[],
  filename?: string,
): AbdSourceResult {
  const set = new Set(headers.map(norm));
  const list = Array.from(set);
  const fname = (filename ?? "").toLowerCase();

  const signals: FingerprintSignals = {
    hasAbdNumber: list.some(isAbdNumberHeader),
    hasSlNo: set.has("SL.NO") || set.has("SL NO") || set.has("SLNO"),
    hasRoundBand: list.some((h) => /^ROUND\s*\d$/.test(h)),
    hasPlanActualBand: set.has("PLAN") && set.has("ACTUAL"),
    hasDocumentNo:
      set.has("DOCUMENT NO") || set.has("DOC NO") || set.has("DOCUMENT NUMBER"),
    hasReviewStatus: set.has("REVIEW STATUS"),
    hasDateModified: set.has("DATE MODIFIED") || set.has("MODIFIED DATE"),
    hasCreatedBy: set.has("CREATED BY"),
    hasHdecPicOrEng:
      set.has("HDEC PIC") ||
      set.has("HDEC ENG") ||
      set.has("HDEC_PIC") ||
      set.has("HDEC_ENG"),
    hasBatchOrAx:
      set.has("AX") ||
      set.has("AXX") ||
      set.has("BATCH NO.") ||
      set.has("BATCH NO") ||
      set.has("BATCH NUMBER") ||
      set.has("BATCH"),
    filenameHdec: /설비|전기|건축|\bmech\b|\belec\b|\barch\b/i.test(fname),
    filenameAconex: /aconex|exportdocs|docs\s*export/i.test(fname),
  };

  // ── 1차: 상호배타 확정 규칙 ─────────────────────────────
  if (signals.hasAbdNumber && signals.hasRoundBand) {
    return {
      source: "hdec",
      confidence: "high",
      reasons: [
        "ABD NUMBER 헤더 감지",
        "ROUND 밴드 헤더 감지 (다단 헤더 구조)",
      ],
      signals,
      scores: { hdec: 999, aconex: 0 },
    };
  }
  if (
    signals.hasDocumentNo &&
    (signals.hasReviewStatus || signals.hasDateModified) &&
    !signals.hasAbdNumber
  ) {
    return {
      source: "aconex",
      confidence: "high",
      reasons: [
        "Document No 헤더 감지",
        signals.hasReviewStatus
          ? "Review Status 헤더 감지"
          : "Date Modified 헤더 감지",
        "ABD NUMBER 헤더 부재",
      ],
      signals,
      scores: { hdec: 0, aconex: 999 },
    };
  }

  // ── 2차: 점수제 (unknown 판별 보조) ────────────────────
  let hdec = 0;
  let aconex = 0;
  const reasons: string[] = [];
  if (signals.hasAbdNumber) { hdec += 2; reasons.push("HDEC: ABD NUMBER"); }
  if (signals.hasSlNo) { hdec += 1; reasons.push("HDEC: Sl.No"); }
  if (signals.hasRoundBand) { hdec += 2; reasons.push("HDEC: ROUND 밴드"); }
  if (signals.hasPlanActualBand) { hdec += 1; reasons.push("HDEC: PLAN/ACTUAL"); }
  if (signals.hasHdecPicOrEng) { hdec += 1; reasons.push("HDEC: HDEC PIC/ENG"); }
  if (signals.hasBatchOrAx) { hdec += 1; reasons.push("HDEC: AX/AXX/Batch"); }
  if (signals.filenameHdec) { hdec += 1; reasons.push("HDEC: 파일명 힌트"); }

  if (signals.hasDocumentNo) { aconex += 2; reasons.push("Aconex: Document No"); }
  if (signals.hasReviewStatus) { aconex += 2; reasons.push("Aconex: Review Status"); }
  if (signals.hasDateModified) { aconex += 2; reasons.push("Aconex: Date Modified"); }
  if (signals.hasCreatedBy) { aconex += 1; reasons.push("Aconex: Created By"); }
  if (signals.filenameAconex) { aconex += 1; reasons.push("Aconex: 파일명 힌트"); }

  const diff = Math.abs(hdec - aconex);
  if (diff >= 3) {
    return {
      source: hdec > aconex ? "hdec" : "aconex",
      confidence: "low",
      reasons,
      signals,
      scores: { hdec, aconex },
    };
  }
  return {
    source: "unknown",
    confidence: "low",
    reasons: reasons.length > 0 ? reasons : ["판정 신호 부족"],
    signals,
    scores: { hdec, aconex },
  };
}

export interface AbdSourceFileEval {
  file: File;
  result: AbdSourceResult;
}

/** 여러 파일을 헤더 지문으로 평가한다. Excel 이 아닌 파일은 unknown 으로 표시. */
export async function evaluateAbdSourceFiles(
  files: File[],
): Promise<AbdSourceFileEval[]> {
  const out: AbdSourceFileEval[] = [];
  for (const file of files) {
    const isExcel = /\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name.toLowerCase());
    if (!isExcel) {
      out.push({
        file,
        result: {
          source: "unknown",
          confidence: "low",
          reasons: ["Excel 이 아닌 파일 — 지문 검사 불가"],
          signals: {
            hasAbdNumber: false,
            hasSlNo: false,
            hasRoundBand: false,
            hasPlanActualBand: false,
            hasDocumentNo: false,
            hasReviewStatus: false,
            hasDateModified: false,
            hasCreatedBy: false,
            hasHdecPicOrEng: false,
            hasBatchOrAx: false,
            filenameHdec: false,
            filenameAconex: false,
          },
          scores: { hdec: 0, aconex: 0 },
        },
      });
      continue;
    }
    try {
      const { headers } = await extractHeadersFromFile(file);
      out.push({ file, result: detectAbdSourceFromHeaders(headers, file.name) });
    } catch (err) {
      out.push({
        file,
        result: {
          source: "unknown",
          confidence: "low",
          reasons: [`헤더 지문 검사 실패: ${(err as Error).message ?? String(err)}`],
          signals: {
            hasAbdNumber: false,
            hasSlNo: false,
            hasRoundBand: false,
            hasPlanActualBand: false,
            hasDocumentNo: false,
            hasReviewStatus: false,
            hasDateModified: false,
            hasCreatedBy: false,
            hasHdecPicOrEng: false,
            hasBatchOrAx: false,
            filenameHdec: false,
            filenameAconex: false,
          },
          scores: { hdec: 0, aconex: 0 },
        },
      });
    }
  }
  return out;
}