import * as XLSX from "xlsx";

/**
 * 임포트 파일이 어떤 모듈의 원본인지 헤더 지문으로 판정한다.
 * 파일 선택 직후(파싱 이전)에 호출되어 잘못된 모듈 파일을 사전에 차단한다.
 */

/** [F-3-4] SPL/WRT 포함. 두 원본은 머리글이 크게 겹치므로 배타 앵커로만 가른다. */
export type ModuleId = "abd" | "sm" | "tm" | "spl" | "wrt";

export const MODULE_LABELS: Record<ModuleId, string> = {
  abd: "As Built Drawing",
  sm: "Snag Management",
  tm: "Task Management",
  spl: "Spare Parts (SPL)",
  wrt: "Warranty (WRT)",
};

export const MODULE_IMPORT_ROUTES: Record<ModuleId, string> = {
  abd: "/closure/abd/import",
  sm: "/closure/snag-management/import",
  tm: "/closure/task-management/import",
  spl: "/import-log/import?tab=spl",
  wrt: "/import-log/import?tab=warranty",
};

interface ModuleFingerprint {
  /** 하나라도 파일에 존재하면 후보로 인정. 전부 부재 시 하드 블록. */
  anchors: string[];
  /** 유사도 산정용 확장 지문 헤더. */
  signature: string[];
  /** 파일명 힌트(정규식). */
  filenameHints?: RegExp[];
  /** 시트명 힌트. */
  sheetHints?: string[];
}

/**
 * [F-2] 헤더 동의어 사전 — 정규화 이후 치환한다.
 * 원본별 표기 차이(HDEC 'DOCUMENT NUMBER' vs Aconex 'Document No')를 흡수한다.
 * 추가 시 module-fingerprint.test.ts 회귀 테스트를 반드시 갱신할 것.
 */
export const HEADER_SYNONYMS: Record<string, string> = {
  documentnumber: "documentno",
  docnumber: "documentno",
  docno: "documentno",
  abddocumentnumber: "abdnumber",
  abddocumentno: "abdnumber",
  abdno: "abdnumber",
};

/** 대소문자/공백/구두점 제거 정규화 + 동의어 치환. */
function normalizeHeader(s: string): string {
  const base = String(s ?? "")
    .toLowerCase()
    .replace(/[\s_\-().\[\]{}\/\\:;,'"`~!@#$%^&*+=?<>|]/g, "");
  return HEADER_SYNONYMS[base] ?? base;
}

function normSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of list) {
    const n = normalizeHeader(s);
    if (n) out.add(n);
  }
  return out;
}

export const MODULE_FINGERPRINTS: Record<ModuleId, ModuleFingerprint> = {
  abd: {
    // [F-3] 앵커 = 모듈 배타 신호만. 일반어(Round/Draft/Submission/Latest Status)는 signature 로만 유지.
    anchors: [
      "ABD NUMBER",
      "ABD OCS No.",
      "DAR Response",
      "Review Status",
      "Date Modified",
      "Document No",
    ],
    signature: [
      "Document No",
      "Doc No",
      "Rev",
      "Revision",
      "Round",
      "Round 1",
      "Round 2",
      "Round 3",
      "Draft",
      "Submission",
      "DAR Response",
      "Latest Status",
      "Discipline",
      "Package",
      "Title",
      "Review Status",
      "Date Modified",
      "Created By",
      "Revision Date",
      "ABD NUMBER",
      "ABD OCS No.",
    ],
    filenameHints: [/abd/i, /as[\s_-]?built/i, /aconex/i, /exportdocs/i],
  },
  sm: {
    anchors: [
      "Issue No",
      "Source Issue No",
      "Punch Category",
      "Raised Date",
      // 스내깅 원본(Dar Export / 내부 View Export) 배타 헤더 — 타 모듈 원본에 등장하지 않음
      "PlanTitle",
      "PlanGroup",
      "LocationReference",
      "Podium area",
      "Snag No",
      "UpdatedStatus",
    ],
    signature: [
      "Issue No",
      "Source Issue No",
      "Punch Category",
      "Location",
      "Raised Date",
      "Closed Date",
      "Assign To",
      "Assigned To",
      "Root Cause",
      "Aconex",
      "Status",
      "Description",
      "PlanTitle",
      "PlanGroup",
      "LocationReference",
      "Classification",
      "Podium area",
      "CreatedBy",
      "CreatedDate",
      "UpdatedStatus",
      "UpdatedDate",
    ],
    filenameHints: [/snag/i, /defect/i, /punch/i, /aconex/i],
  },
  tm: {
    // [F-3-2] 'HDEC PIC'/'HDEC ENG' 는 ABD·SPL·WRT 원본에도 존재하는 전사 공용 헤더 → 앵커에서 제거.
    anchors: [
      "Task No",
      "Main Task No",
      "Sub Task",
      "항목",
      "계획 진도율",
      "실적 진도율",
      "자동 판정",
      "단계별 세부 업무",
      "계획 일수",
    ],
    signature: [
      "Task No",
      "Main Task No",
      "Parent Task No",
      "Sub Task",
      "Task Name",
      "Plan Start",
      "Plan Finish",
      "Plan Days",
      "Actual Start",
      "Actual Finish",
      "Actual Progress",
      "Plan Progress",
      "Forecast End",
      "Data Date",
      "Discipline",
      "Slip Days",
      "계획완료일",
      "실적진도율",
      "항목",
      "계획 시작",
      "계획 완료",
      "계획 일수",
      "실제 시작",
      "실제 완료",
      "계획 진도율",
      "실적 진도율",
      "자동 판정",
      "HDEC PIC",
      "HDEC ENG",
      "단계별 세부 업무",
      "유형",
      "상태",
      "Plot",
      "Category",
      "리스크",
      "담당",
    ],
    filenameHints: [/task/i, /\btm\b/i, /schedule/i],
  },
  spl: {
    // 배타 앵커만. DIS / SERVICE / DOCUMENT TITLE / TEAM / HDEC PIC / HDEC ENG /
    // Submission / Response Received / Latest Status / Approval Status 는 WRT 와 공통이라 앵커 금지.
    anchors: [
      "SPL NUMBER",
      "Physical List",
      "Rec. Letter 2Y",
      "Rec. Letter 5Y",
      "Availability 10Y",
      "RFQ Draft",
      "Issuance of PO",
      "Code B to A",
      // View 양식(화면 표시 그대로) 재임포트 — 단계 헤더가 카탈로그 short_code 로 나온다
      "R-PL",
      "R-2Y",
      "R-5Y",
      "R-10Y",
      "R-OT",
      "D-SB-PS",
      "D-AP-AD",
      "P-PO-PD",
    ],
    signature: [
      "SPL NUMBER",
      "Physical List",
      "Rec. Letter 2Y",
      "Rec. Letter 5Y",
      "Availability 10Y",
      "RFQ Draft",
      "Issuance of PO",
      "Code B to A",
      "DIS",
      "SERVICE",
      "DOCUMENT TITLE",
      "TEAM",
      "HDEC PIC",
      "HDEC ENG",
      "Submission",
      "Response Received",
      "Latest Status",
      "Approval Status",
      "SUPPLIER",
      "PIC PO",
      "ENG PO",
      "R-PL",
      "R-2Y",
      "R-5Y",
      "R-10Y",
      "R-OT",
      "D-SB-PS",
      "D-AP-AD",
      "P-PO-PD",
    ],
    filenameHints: [/spl/i, /spare/i],
  },
  wrt: {
    anchors: [
      "WRT NUMBER",
      "Response by dar",
      "Subcon Stamp",
      "Final Submission",
      "Negotiation",
    ],
    signature: [
      "WRT NUMBER",
      "Response by dar",
      "Subcon Stamp",
      "Final Submission",
      "Negotiation",
      "DIS",
      "SERVICE",
      "DOCUMENT TITLE",
      "TEAM",
      "HDEC PIC",
      "HDEC ENG",
      "Submission",
      "Response Received",
      "Latest Status",
      "Approval Status",
    ],
    filenameHints: [/wrt/i, /warranty/i],
  },
};

export interface DetectionResult {
  top: ModuleId;
  scores: Record<ModuleId, number>;
  anchorsHit: Record<ModuleId, number>;
  confidenceGap: number;
  totalHeaders: number;
}

export function detectModule(
  headers: string[],
  sheetNames: string[] = [],
  filename?: string,
): DetectionResult {
  const headerSet = normSet(headers);
  const sheetSet = normSet(sheetNames);
  const fname = (filename ?? "").toLowerCase();

  const scores: Record<ModuleId, number> = {
    abd: 0,
    sm: 0,
    tm: 0,
    spl: 0,
    wrt: 0,
  };
  const anchorsHit: Record<ModuleId, number> = {
    abd: 0,
    sm: 0,
    tm: 0,
    spl: 0,
    wrt: 0,
  };

  (Object.keys(MODULE_FINGERPRINTS) as ModuleId[]).forEach((mod) => {
    const fp = MODULE_FINGERPRINTS[mod];
    const sigSet = normSet(fp.signature);
    const anchorSet = normSet(fp.anchors);
    // 자카드 유사도
    let inter = 0;
    for (const h of headerSet) if (sigSet.has(h)) inter++;
    const union = headerSet.size + sigSet.size - inter;
    const jaccard = union > 0 ? inter / union : 0;
    // 앵커 히트 수 가산(각 히트당 +0.05)
    let anchorMatches = 0;
    for (const a of anchorSet) if (headerSet.has(a)) anchorMatches++;
    anchorsHit[mod] = anchorMatches;
    let score = jaccard + anchorMatches * 0.05;
    // [F-4-3] 파일명 가산점 제거 — 헤더만으로 판정한다.
    // 시트명 힌트 가산점
    if (fp.sheetHints) {
      const hintSet = normSet(fp.sheetHints);
      for (const s of sheetSet) if (hintSet.has(s)) score += 0.02;
    }
    scores[mod] = score;
  });

  const sorted = (Object.keys(scores) as ModuleId[]).sort(
    (a, b) => scores[b] - scores[a],
  );
  const top = sorted[0];
  const runnerUp = sorted[1];
  return {
    top,
    scores,
    anchorsHit,
    confidenceGap: scores[top] - scores[runnerUp],
    totalHeaders: headerSet.size,
  };
}

export type Verdict = "ok" | "ambiguous" | "block";

export interface Evaluation {
  verdict: Verdict;
  target: ModuleId;
  detected: ModuleId;
  detection: DetectionResult;
  reason: string;
  hint?: string;
}

/**
 * 임포트 화면(target)에 업로드된 파일의 헤더를 판정한다.
 * - block: 파일의 target 앵커가 하나도 없거나, 다른 모듈이 확실히 우세할 때
 * - ambiguous: target 이 top 이 아니지만 confidenceGap 이 작을 때
 * - ok: target 이 top 이거나 앵커 히트가 충분할 때
 */
export function evaluateImport(
  target: ModuleId,
  headers: string[],
  sheetNames: string[] = [],
  filename?: string,
): Evaluation {
  const detection = detectModule(headers, sheetNames, filename);
  const targetAnchors = detection.anchorsHit[target];
  const topAnchors = detection.anchorsHit[detection.top];
  const targetScore = detection.scores[target];
  const topScore = detection.scores[detection.top];

  // [F-4-2] A. target 앵커 히트가 0이면 무조건 하드 블록 (앵커가 배타 신호이므로 안전)
  const targetFp = MODULE_FINGERPRINTS[target];
  const fnameLower = (filename ?? "").toLowerCase();
  const filenameMatch = !!(
    targetFp.filenameHints &&
    fnameLower &&
    targetFp.filenameHints.some((re) => re.test(fnameLower))
  );
  if (targetAnchors === 0) {
    return {
      verdict: "block",
      target,
      detected: detection.top,
      detection,
      reason: `이 파일에는 ${MODULE_LABELS[target]} 임포트에 필요한 필수 헤더(앵커)가 없습니다.`,
      hint:
        topAnchors > 0
          ? `${MODULE_LABELS[detection.top]} 원본 파일로 보입니다. ${MODULE_LABELS[detection.top]} 임포트 페이지에서 다시 시도하세요.`
          : filenameMatch
            ? "파일명은 일치하지만 헤더에서 형식을 확인할 수 없습니다."
            : "형식을 확인할 수 없는 파일입니다.",
    };
  }

  // B. Top 모듈이 target 이 아닌 경우
  if (detection.top !== target) {
    const gap = topScore - targetScore;
    // 확실히 다른 모듈이 앞선 경우(격차 ≥ 0.25)
    if (gap >= 0.25) {
      return {
        verdict: "block",
        target,
        detected: detection.top,
        detection,
        reason: `이 파일은 ${MODULE_LABELS[detection.top]} 형식으로 감지되었습니다.`,
        hint: `${MODULE_LABELS[detection.top]} 임포트 페이지로 이동해 업로드하세요.`,
      };
    }
    // 모호한 경우
    return {
      verdict: "ambiguous",
      target,
      detected: detection.top,
      detection,
      reason: `${MODULE_LABELS[target]} 형식이 확실하지 않습니다. 감지된 후보: ${MODULE_LABELS[detection.top]}.`,
      hint: "그래도 계속 진행하려면 확인 후 업로드하세요.",
    };
  }

  return {
    verdict: "ok",
    target,
    detected: detection.top,
    detection,
    reason: `${MODULE_LABELS[target]} 형식으로 확인되었습니다.`,
  };
}

/**
 * 파일에서 헤더 문자열을 추출한다.
 * 각 시트의 상단 30행 내에서 non-empty 셀이 가장 많은 행을 헤더로 간주하고,
 * 모든 시트에서 수집된 헤더를 합쳐서 반환한다.
 */
export async function extractHeadersFromFile(
  file: File,
): Promise<{ headers: string[]; sheetNames: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetNames = wb.SheetNames ?? [];
  const collected: string[] = [];
  // 전 모듈 앵커 정규화 집합 — 헤더 행 우선 판정에 사용
  const allAnchorSet = new Set<string>();
  (Object.keys(MODULE_FINGERPRINTS) as ModuleId[]).forEach((mod) => {
    for (const a of MODULE_FINGERPRINTS[mod].anchors) {
      const n = normalizeHeader(a);
      if (n) allAnchorSet.add(n);
    }
  });
  for (const name of sheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const ref = ws["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const scanEndRow = Math.min(range.s.r + 30, range.e.r);
    // 각 행의 (앵커 매칭 수, non-empty 수) 를 계산
    let bestRow = range.s.r;
    let bestAnchor = -1;
    let bestCount = 0;
    const rowValues: Record<number, string[]> = {};
    for (let r = range.s.r; r <= scanEndRow; r++) {
      const vals: string[] = [];
      let anchorHits = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cell?.v;
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          const s = String(v).trim();
          vals.push(s);
          if (allAnchorSet.has(normalizeHeader(s))) anchorHits++;
        }
      }
      rowValues[r] = vals;
      // 앵커 매칭 우선, 동률이면 non-empty 최대 행
      if (
        anchorHits > bestAnchor ||
        (anchorHits === bestAnchor && vals.length > bestCount)
      ) {
        bestAnchor = anchorHits;
        bestCount = vals.length;
        bestRow = r;
      }
    }
    // [F-1-2] 최적 헤더행까지의 상단 블록 전체를 합집합으로 수집한다.
    // (다단 헤더에서 상위 밴드 행의 판정 신호가 버려지는 것을 방지)
    // 데이터 행(bestRow 초과)은 수집하지 않는다.
    for (let r = range.s.r; r <= bestRow; r++) {
      const vals = rowValues[r] ?? [];
      for (const s of vals) collected.push(s);
    }
  }
  return { headers: collected, sheetNames };
}

export interface FileEvaluation {
  file: File;
  evaluation: Evaluation;
}

/** 여러 파일을 헤더 지문으로 평가한다. .xlsx/.xls 만 검사, 그 외 확장자는 ok 로 통과. */
export async function evaluateFilesForModule(
  target: ModuleId,
  files: File[],
): Promise<FileEvaluation[]> {
  const results: FileEvaluation[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const isExcel = /\.(xlsx|xls|xlsm|xlsb)$/i.test(lower);
    if (!isExcel) {
      // 지원하지 않는 확장자는 기존 파서가 판정하도록 통과
      results.push({
        file,
        evaluation: {
          verdict: "ok",
          target,
          detected: target,
          detection: {
            top: target,
            scores: { abd: 0, sm: 0, tm: 0, spl: 0, wrt: 0 },
            anchorsHit: { abd: 0, sm: 0, tm: 0, spl: 0, wrt: 0 },
            confidenceGap: 0,
            totalHeaders: 0,
          },
          reason: "Excel 이 아닌 파일은 지문 검사를 건너뜁니다.",
        },
      });
      continue;
    }
    try {
      const { headers, sheetNames } = await extractHeadersFromFile(file);
      const evalResult = evaluateImport(target, headers, sheetNames, file.name);
      results.push({ file, evaluation: evalResult });
    } catch (err) {
      // 파일 파싱 실패는 여기서 차단하지 않고 파서에게 위임
      results.push({
        file,
        evaluation: {
          verdict: "ok",
          target,
          detected: target,
          detection: {
            top: target,
            scores: { abd: 0, sm: 0, tm: 0, spl: 0, wrt: 0 },
            anchorsHit: { abd: 0, sm: 0, tm: 0, spl: 0, wrt: 0 },
            confidenceGap: 0,
            totalHeaders: 0,
          },
          reason: `헤더 지문 검사를 건너뜁니다: ${(err as Error).message ?? String(err)}`,
        },
      });
    }
  }
  return results;
}