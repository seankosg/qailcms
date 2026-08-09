// ABD OCS 증분 Wizard — 단계 관문 · 실패 분류 · 최종 성공 판정 (순수 로직).
// 문구 정규식으로 pass/warn/fail 을 추정하지 않는다. 구조화된 blocker 그룹만 사용한다.

export type BlockerGroups = {
  packageBlockers: string[];
  dryRunBlockers: string[];
  assetBlockers: string[];
  snapshotBlockers: string[];
  approvalBlockers: string[];
};

export type GateInput = {
  baselineVerificationImplemented: boolean;
  hasPackage: boolean;
  packageFileBlockers: string[];
  collisionDone: boolean;
  collisionBlockers: string[];
  collisionCounts: { hash_mismatch: number; unresolved: number } | null;
  duplicatePackage: boolean;
  duplicateRecovered: boolean;
  precheck: Record<string, unknown> | null;
  baselineIdentityOk: boolean;
  dry: Record<string, unknown> | null;
  dryIdentityOk: boolean;
  attachmentsUnresolved: number;
  massRetire: boolean;
  allowRetire: boolean;
  retireCount: number;
  uploadFailedCount: number;
  verifyRan: boolean;
  verifyOkCount: number;
  verifyFailureCount: number;
  newAssetTotal: number;
  snapshotId: string | null;
  approved: boolean;
};

export function buildBlockerGroups(i: GateInput): BlockerGroups {
  const packageBlockers: string[] = [];
  const dryRunBlockers: string[] = [];
  const assetBlockers: string[] = [];
  const snapshotBlockers: string[] = [];
  const approvalBlockers: string[] = [];

  if (!i.baselineVerificationImplemented) {
    packageBlockers.push("Baseline 실측 검증(생성·다운로드·내용 대조) 미완료 — 증분 Import 잠금");
  }
  if (!i.hasPackage) packageBlockers.push("증분 ZIP 패키지를 선택하십시오.");
  packageBlockers.push(...i.packageFileBlockers);
  if (i.hasPackage && !i.collisionDone) packageBlockers.push("Storage 충돌 점검 미완료");
  packageBlockers.push(...i.collisionBlockers);
  if (i.collisionCounts) {
    if (i.collisionCounts.hash_mismatch > 0)
      packageBlockers.push(`Storage hash mismatch ${i.collisionCounts.hash_mismatch}건`);
    if (i.collisionCounts.unresolved > 0)
      packageBlockers.push(`Storage unresolved ${i.collisionCounts.unresolved}건`);
  }
  if (i.duplicatePackage) {
    packageBlockers.push(
      i.duplicateRecovered
        ? "이미 반영 및 복구 완료된 패키지입니다. 재실행할 수 없습니다."
        : "동일 패키지 해시가 이미 반영되었습니다.",
    );
  }

  const base = (i.precheck?.["baseline"] ?? {}) as Record<string, unknown>;
  if (i.precheck && base["base_import_run_found"] !== true)
    packageBlockers.push("base_import_run_id 를 정본에서 찾을 수 없습니다.");
  if (i.precheck && base["is_latest"] !== true)
    packageBlockers.push("Baseline 이 최신 정본 Import 가 아닙니다.");
  if (i.precheck && base["core_changed_since_base"] === true && !i.baselineIdentityOk)
    packageBlockers.push("Baseline 이후 OCS 정본이 변경되었습니다.");
  if (i.precheck && i.precheck["base_core_hash_match"] === false)
    packageBlockers.push("manifest.base_core_hash 가 서버 정본 core hash 와 다릅니다.");
  if (i.precheck && i.precheck["baseline_id_match"] === false)
    packageBlockers.push("manifest.base_baseline_id 가 서버 재계산값과 다릅니다.");
  const mismatched = Array.isArray(i.precheck?.["mismatched_core_tables"])
    ? (i.precheck?.["mismatched_core_tables"] as string[])
    : [];
  if (mismatched.length > 0)
    packageBlockers.push(`core 테이블 해시 불일치: ${mismatched.join(", ")}`);
  if (!i.precheck) packageBlockers.push("Precheck 미실행");

  if (!i.dry) dryRunBlockers.push("Dry-run 미실행");
  if (i.dry) {
    if (!i.dryIdentityOk) dryRunBlockers.push("Dry-run 항등식 불일치");
    if (i.attachmentsUnresolved > 0)
      dryRunBlockers.push(`미확인 첨부 ${i.attachmentsUnresolved}건`);
    if (i.massRetire && !i.allowRetire)
      dryRunBlockers.push(`대량 퇴역 미승인 (${i.retireCount}건 · 임계 30% / 100건)`);
  }

  if (i.uploadFailedCount > 0)
    assetBlockers.push(
      `자산 업로드 실패 ${i.uploadFailedCount}건 — 재실행으로 실패분만 다시 업로드하십시오.`,
    );
  if (i.verifyFailureCount > 0) assetBlockers.push(`서버 실측 검증 실패 ${i.verifyFailureCount}건`);
  if (!i.verifyRan) assetBlockers.push("신규 자산 업로드 · 서버 실측 검증 미실행");
  else if (i.verifyOkCount !== i.newAssetTotal)
    assetBlockers.push(`서버 실측 검증 미완료 (${i.verifyOkCount}/${i.newAssetTotal})`);

  if (!i.snapshotId) snapshotBlockers.push("사전 백업 스냅샷 미완료 (Dry-run 이후 생성분만 인정)");
  if (!i.approved) approvalBlockers.push("최종 승인 체크 필요");

  return { packageBlockers, dryRunBlockers, assetBlockers, snapshotBlockers, approvalBlockers };
}

export function flattenBlockers(g: BlockerGroups): string[] {
  return [
    ...g.packageBlockers,
    ...g.dryRunBlockers,
    ...g.assetBlockers,
    ...g.snapshotBlockers,
    ...g.approvalBlockers,
  ];
}

/** Step 4 완료 — ZIP 계약·Precheck·Dry-run·항등식·blocker 0·중복 아님 */
export function isStep4Complete(g: BlockerGroups, i: GateInput): boolean {
  return (
    i.hasPackage &&
    !!i.precheck &&
    !!i.dry &&
    !i.duplicatePackage &&
    !i.duplicateRecovered &&
    g.packageBlockers.length === 0 &&
    g.dryRunBlockers.length === 0
  );
}

/** Step 5 완료 — 업로드 실패 0 · 서버 검증 = 대상 전체 · hash mismatch 0 · unresolved 0 */
export function isStep5Complete(i: GateInput): boolean {
  return (
    i.verifyRan &&
    i.uploadFailedCount === 0 &&
    i.verifyFailureCount === 0 &&
    i.newAssetTotal >= 0 &&
    i.verifyOkCount === i.newAssetTotal &&
    (i.collisionCounts?.hash_mismatch ?? 0) === 0 &&
    (i.collisionCounts?.unresolved ?? 0) === 0
  );
}

export function isStep6Complete(i: GateInput): boolean {
  return !!i.snapshotId;
}

export type WizardGates = {
  groups: BlockerGroups;
  blockers: string[];
  step4Complete: boolean;
  step5Unlocked: boolean;
  step5Complete: boolean;
  step6Unlocked: boolean;
  step6Complete: boolean;
  step7Unlocked: boolean;
  packageStatus: "pass" | "warn" | "fail";
};

export function evaluateGates(i: GateInput, warningCount = 0): WizardGates {
  const groups = buildBlockerGroups(i);
  const step4Complete = isStep4Complete(groups, i);
  const step5Complete = isStep5Complete(i);
  const step6Complete = isStep6Complete(i);
  const packageStatus: "pass" | "warn" | "fail" = !i.dry
    ? "warn"
    : groups.packageBlockers.length > 0 || groups.dryRunBlockers.length > 0
      ? "fail"
      : warningCount > 0
        ? "warn"
        : "pass";
  return {
    groups,
    blockers: flattenBlockers(groups),
    step4Complete,
    step5Unlocked: step4Complete,
    step5Complete,
    step6Unlocked: step4Complete && step5Complete,
    step6Complete,
    step7Unlocked: step4Complete && step5Complete && step6Complete,
    packageStatus,
  };
}

// ───────────────────────── Import 실패 분류 ─────────────────────────

export type ImportFailureKind = "confirmed_rollback" | "partial_or_post_verify_failure" | "unknown";

export type ImportFailureState = {
  kind: ImportFailureKind;
  stage: string | null;
  message: string;
  retryAllowed: boolean;
  title: string;
  affected: string;
  nextStep: string;
};

const STAGE_RE = /OCS_IMPORT_STAGE\[([a-z_]+)\]/i;

/** 서버가 표시한 실행 단계만 사용한다. 단계가 없으면 반영 여부를 확정하지 않는다. */
export function classifyImportFailure(err: unknown): ImportFailureState {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const stage = STAGE_RE.exec(message)?.[1]?.toLowerCase() ?? null;
  const clean = message.replace(STAGE_RE, "").replace(/^[:\s]+/, "");

  if (
    stage === "precheck" ||
    stage === "final_validation" ||
    stage === "asset_collision" ||
    stage === "import_log_insert" ||
    stage === "transactional_import"
  ) {
    return {
      kind: "confirmed_rollback",
      stage,
      message: clean,
      retryAllowed: true,
      title: "Import failed — no production changes were applied",
      affected:
        "서버가 운영 정본 무변경 또는 트랜잭션 롤백을 확인했습니다. 업로드된 자산과 사전 스냅샷은 보존됩니다.",
      nextStep: "Import 단계만 다시 실행하십시오. 파일 재업로드나 백업 재생성은 필요하지 않습니다.",
    };
  }
  if (stage === "post_import_verify" || stage === "import_log_finalize") {
    return {
      kind: "partial_or_post_verify_failure",
      stage,
      message: clean,
      retryAllowed: false,
      title: "Import may be partially applied",
      affected:
        "본체 반영 이후 사후 검증 또는 로그 마감 단계에서 실패했습니다. 운영 정본이 이미 변경되었을 수 있습니다.",
      nextStep: "Do not retry. Administrator investigation or recovery is required.",
    };
  }
  return {
    kind: "unknown",
    stage,
    message: clean,
    retryAllowed: false,
    title: "Import result could not be confirmed",
    affected: "네트워크 오류·timeout·응답 유실 등으로 반영 여부를 확정하지 못했습니다.",
    nextStep: "Do not retry. run ID 로 Import log 와 운영 정본 반영 여부를 먼저 확인하십시오.",
  };
}

// ───────────────────────── 최종 성공 판정 ─────────────────────────

export type ImportSuccessEvaluation = { complete: boolean; reasons: string[] };

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** result 객체 존재만으로 완료 처리하지 않는다. 서버 로그·verify·항등식을 모두 확인한다. */
export function evaluateImportSuccess(
  payload: Record<string, unknown> | null,
): ImportSuccessEvaluation {
  const reasons: string[] = [];
  if (!payload) return { complete: false, reasons: ["Import 결과가 없습니다."] };

  if (payload["import_log_status"] !== "success")
    reasons.push(
      `서버 Import log status 가 success 가 아닙니다 (${String(payload["import_log_status"] ?? "unknown")}).`,
    );

  const verify = payload["verify"];
  if (!verify || typeof verify !== "object") reasons.push("post-import verify 결과가 없습니다.");
  else {
    const v = verify as Record<string, unknown>;
    if (n(v["cache_mismatch_items"]) !== 0)
      reasons.push(`cache mismatch ${n(v["cache_mismatch_items"])}건`);
    if (n(v["attachment_dup_pairs"]) !== 0)
      reasons.push(`중복 첨부 링크 ${n(v["attachment_dup_pairs"])}건`);
    if (n(v["attachments_unresolved"]) !== 0)
      reasons.push(`unresolved 첨부 ${n(v["attachments_unresolved"])}건`);
    if (n(v["compliance_user_lost"]) !== 0)
      reasons.push(`사용자 Complied 유실 ${n(v["compliance_user_lost"])}건`);
  }

  const result = (payload["result"] ?? {}) as Record<string, unknown>;
  const pairs: [string, string, string][] = [
    ["outside_scope_comment_hash_before", "outside_scope_comment_hash_after", "범위 밖 comments"],
    ["outside_scope_link_hash_before", "outside_scope_link_hash_after", "범위 밖 links"],
  ];
  for (const [a, b, label] of pairs) {
    if (result[a] === undefined || result[b] === undefined) {
      reasons.push(`${label} 보호 해시를 확인하지 못했습니다.`);
    } else if (String(result[a]) !== String(result[b])) {
      reasons.push(`${label} 보호 해시가 변경되었습니다.`);
    }
  }

  for (const id of collectIdentities(result)) {
    if (id.ok !== true) reasons.push(`항등식 실패: ${id.name}`);
  }

  return { complete: reasons.length === 0, reasons };
}

/** 서버가 반환한 identities 객체(중첩 포함)를 모두 모은다. */
function collectIdentities(root: unknown, depth = 0): { name: string; ok: boolean }[] {
  if (!root || typeof root !== "object" || depth > 4) return [];
  const out: { name: string; ok: boolean }[] = [];
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    if (k === "identities" && v && typeof v === "object") {
      for (const [name, ok] of Object.entries(v as Record<string, unknown>)) {
        out.push({ name, ok: ok === true });
      }
    } else if (v && typeof v === "object") {
      out.push(...collectIdentities(v, depth + 1));
    }
  }
  return out;
}
