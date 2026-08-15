// ABD OCS 증분 패키지 — 브라우저 로컬 검증 엔진 (순수 로직 · 서버/DB/Storage 접근 없음).
// UI 와 corrected ZIP 재검증이 이 모듈 하나를 공유한다. 검증식을 UI 에 중복 작성하지 않는다.
import { canonicalJson } from "@/lib/abd/ocs-canonical-json";
import { sha256Hex } from "@/lib/abd/ocs-db-parser";
import { BASELINE_CORE_TABLES } from "@/lib/abd/ocs-baseline-shared";
import { normalizeAbdNumber } from "@/lib/abd/ocs-number-normalize";
import type { BaselineRead } from "@/lib/abd/ocs-baseline-reader";
import type { IncrementPackage } from "@/lib/abd/ocs-increment-package";
import type { V3StageComment } from "@/lib/abd/ocs-v3-parser";
import {
  applyCorrections,
  commentLocator,
  correctionsSha256,
  type CorrectionsDoc,
} from "@/lib/abd/ocs-local-corrections";
import {
  computeStagingPayloadDigest,
  PAYLOAD_DIGEST_VERSION,
  type StagingPayloadCounts,
} from "@/lib/abd/ocs-payload-digest";

export const LOCAL_VALIDATION_SCHEMA = "ocs-local-validation/1";
export const VALIDATOR_VERSION = "ocs-local-validator/1.0.0";
/** 영수증 파일명 — 계약상 이 이름 하나만 사용한다. */
export const LOCAL_RECEIPT_PATH = "local_validation_receipt.json";
/** payload digest 대상과 canonical 순서 — 코드 상수로 고정한다(영수증 자체는 제외). */
export const PAYLOAD_DIGEST_PARTS = [
  "manifest",
  "atomic",
  "response_mapping",
  "policy",
  "corrections",
] as const;
/** v1 Baseline 안내 — 문구 고정 */
export const BASELINE_V1_NOTICE =
  "이 Baseline 에는 브라우저 검증 인덱스가 없습니다. Latest OCS Baseline 을 새로 생성·다운로드하십시오.";

/**
 * digest 대상 manifest canonical view — 영수증 entry 를 files 목록에서 제외해 digest 순환을 끊는다.
 */
export function manifestPayloadView(manifest: unknown): unknown {
  const m = { ...((manifest ?? {}) as Record<string, unknown>) };
  if (Array.isArray(m["files"])) {
    m["files"] = (m["files"] as Record<string, unknown>[]).filter(
      (f) => String(f["relative_path"]) !== LOCAL_RECEIPT_PATH,
    );
  }
  return m;
}

export type LocalValidationIssue = {
  severity: "blocker" | "warning";
  code: string;
  source_file: string | null;
  sheet_name: string | null;
  source_row: number | null;
  sn: string | null;
  atomic_item_no: number | null;
  field: string;
  original_value: string | null;
  normalized_value: string | null;
  message: string;
  candidates: Array<{ abd_item_id: string; abd_number: string }>;
  correction_mode: "inline_mapping" | "source_excel_required" | "none";
};

export type LocalValidationResult = {
  schema_version: string;
  validator_version: string;
  validated_at: string;
  package_id: string;
  package_sha256: string;
  baseline_id: string;
  baseline_core_hash: string;
  counts: {
    comments: number;
    groups: number;
    attachments: number;
    source_files: number;
    images: number;
    response_segments: number;
  };
  /** 교정 검산용 파생치 */
  abd_link_associations: number;
  distinct_linked_abd: number;
  active_comments: number;
  single_linked_comments: number;
  multi_linked_comments: number;
  unmatched_comments: number;
  /** v2 Baseline(ABD 인덱스 보유) 여부 — false 면 로컬 ABD 검증 불가 */
  baseline_supports_local_validation: boolean;
  blocker_count: number;
  warning_count: number;
  unresolved_abd_count: number;
  duplicate_identity_count: number;
  duplicate_pair_count: number;
  identities: { comments_active_plus_inactive_equals_total: boolean };
  correction_count: number;
  issues: LocalValidationIssue[];
  clean: boolean;
};

export type LocalValidationReceipt = {
  schema_version: string;
  package_id: string;
  payload_sha256: string;
  /** staging 재현 digest 규칙 버전 */
  digest_version: string;
  /** ZIP 전체(manifest·policy·corrections 포함) canonical digest — 영수증 변조 감지용 */
  package_payload_sha256: string;
  /** payload_sha256 대상 dataset 행수 */
  staging_counts: StagingPayloadCounts;
  baseline_id: string;
  baseline_core_hash: string;
  validator_version: string;
  validated_at: string;
  clean: boolean;
  blocker_count: number;
  warning_count: number;
  contract_hash: string;
  payload_parts: readonly string[];
};

const issue = (p: Partial<LocalValidationIssue> & Pick<LocalValidationIssue, "code" | "message">) =>
  ({
    severity: "blocker",
    source_file: null,
    sheet_name: null,
    source_row: null,
    sn: null,
    atomic_item_no: null,
    field: "",
    original_value: null,
    normalized_value: null,
    candidates: [],
    correction_mode: "none",
    ...p,
  }) as LocalValidationIssue;

export type ValidateInput = {
  pkg: IncrementPackage;
  baseline: BaselineRead;
  corrections?: CorrectionsDoc | null;
  now?: string;
};

export function sourceHashByName(pkg: IncrementPackage): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of pkg.sourceFiles) {
    m.set(f.relative_path.replace(/^source\//, ""), f.sha256);
  }
  return m;
}

/** 브라우저 전체 로컬 검증. blocker 0 일 때만 clean=true. */
export function validateIncrementLocally(input: ValidateInput): LocalValidationResult {
  const { pkg, baseline } = input;
  const issues: LocalValidationIssue[] = [];
  const nameToHash = sourceHashByName(pkg);

  // 0) ZIP/manifest 계약 — readIncrementPackage 의 판정을 그대로 승계한다 (재구현 금지).
  for (const b of pkg.blockers) {
    issues.push(issue({ code: "PACKAGE_CONTRACT", message: b, field: "package" }));
  }
  for (const b of baseline.blockers) {
    issues.push(issue({ code: "BASELINE_CONTRACT", message: b, field: "baseline" }));
  }

  // 1) Baseline identity — 다른 Baseline 과 임의 조합 금지
  if (baseline.baseline_id && pkg.manifest.base_baseline_id !== baseline.baseline_id) {
    issues.push(
      issue({
        code: "BASELINE_ID_MISMATCH",
        field: "base_baseline_id",
        original_value: pkg.manifest.base_baseline_id,
        message: `This package was built from a different Baseline. Package Baseline: ${pkg.manifest.base_baseline_id} / Selected Baseline: ${baseline.baseline_id}`,
      }),
    );
  }
  if (baseline.core_hash && pkg.manifest.base_core_hash !== baseline.core_hash) {
    issues.push(
      issue({
        code: "BASELINE_CORE_HASH_MISMATCH",
        field: "base_core_hash",
        original_value: pkg.manifest.base_core_hash,
        message: `Baseline core hash 가 다릅니다 (package ${pkg.manifest.base_core_hash.slice(0, 16)} ≠ baseline ${baseline.core_hash.slice(0, 16)}).`,
      }),
    );
  }
  if (baseline.base_import_run_id && pkg.manifest.base_import_run_id !== baseline.base_import_run_id) {
    issues.push(
      issue({
        code: "BASELINE_RUN_MISMATCH",
        field: "base_import_run_id",
        original_value: pkg.manifest.base_import_run_id,
        message: "패키지의 base_import_run_id 가 선택한 Baseline 과 다릅니다.",
      }),
    );
  }
  for (const [t, h] of Object.entries(baseline.core_table_hashes ?? {})) {
    const claimed = pkg.manifest.base_core_table_hashes?.[t];
    if (claimed !== undefined && String(claimed).toLowerCase() !== String(h).toLowerCase()) {
      issues.push(
        issue({
          code: "BASELINE_TABLE_HASH_MISMATCH",
          field: t,
          message: `core 테이블 해시 불일치: ${t}`,
        }),
      );
    }
  }

  // 1-1) manifest 정적 계약 — core 8개 테이블 해시 전수 (서버에서 브라우저로 이관)
  {
    const keys = Object.keys(pkg.manifest.base_core_table_hashes ?? {});
    const missing = BASELINE_CORE_TABLES.filter((t) => !keys.includes(t));
    const extra = keys.filter((k) => !(BASELINE_CORE_TABLES as readonly string[]).includes(k));
    const blank = BASELINE_CORE_TABLES.filter(
      (t) => !String(pkg.manifest.base_core_table_hashes?.[t] ?? "").trim(),
    );
    if (missing.length || extra.length || blank.length) {
      issues.push(
        issue({
          code: "MANIFEST_CORE_TABLE_CONTRACT",
          field: "base_core_table_hashes",
          message: `core table hashes 계약 위반 (누락 ${missing.join(",") || "없음"} / 추가 ${
            extra.join(",") || "없음"
          } / 공백 ${blank.join(",") || "없음"})`,
        }),
      );
    }
  }

  // 2) 교정 적용
  let comments: V3StageComment[] = pkg.atomic.comments;
  let correctionCount = 0;
  if (input.corrections) {
    if (input.corrections.original_package_id !== pkg.manifest.package_id) {
      // corrected 패키지에서는 package_id 가 바뀌므로 supersedes 로 대조한다.
      const supersedes = (pkg.manifest as unknown as Record<string, unknown>)[
        "supersedes_package_id"
      ];
      if (supersedes !== input.corrections.original_package_id) {
        issues.push(
          issue({
            code: "CORRECTIONS_PACKAGE_MISMATCH",
            field: "corrections",
            message: "corrections.json 의 original_package_id 가 패키지와 연결되지 않습니다.",
          }),
        );
      }
    }
    const applied = applyCorrections(comments, input.corrections, nameToHash);
    comments = applied.comments;
    correctionCount = applied.applied;
    for (const f of applied.failures) {
      issues.push(issue({ code: "CORRECTION_NOT_APPLICABLE", field: "abd_number", message: f }));
    }
  }

  // 3) ABD Number 해소 (검증 sidecar 인덱스가 무결성 검증을 통과한 경우에만)
  let unresolved = 0;
  if (!baseline.abdIndex) {
    issues.push(
      issue({
        code: "BASELINE_INDEX_MISSING",
        field: "validation/abd_items_index.json",
        message: BASELINE_V1_NOTICE,
      }),
    );
  } else {
    for (const c of comments) {
      if (!c.is_active) continue;
      const loc = commentLocator(c, nameToHash);
      for (const raw of c.abd_numbers) {
        if (baseline.byExact.has(raw) && baseline.byExact.get(raw)!.is_active) continue;
        const norm = normalizeAbdNumber(raw);
        const cands = baseline.byNormalized.get(norm) ?? [];
        unresolved += 1;
        if (cands.length === 1) {
          issues.push(
            issue({
              code: "ABD_NUMBER_NORMALIZATION",
              severity: "blocker",
              field: "abd_number",
              source_file: loc.source_file_name || null,
              sheet_name: loc.sheet_name,
              source_row: loc.source_row,
              sn: loc.sn,
              atomic_item_no: loc.atomic_item_no,
              original_value: raw,
              normalized_value: norm,
              candidates: cands.map((x) => ({
                abd_item_id: x.abd_item_id,
                abd_number: x.abd_number,
              })),
              correction_mode: "inline_mapping",
              message: `표기만 다른 ABD Number 입니다. canonical 값(${cands[0]!.abd_number}) 적용을 확인하십시오.`,
            }),
          );
        } else if (cands.length > 1) {
          issues.push(
            issue({
              code: "ABD_NUMBER_AMBIGUOUS",
              field: "abd_number",
              source_file: loc.source_file_name || null,
              sheet_name: loc.sheet_name,
              source_row: loc.source_row,
              sn: loc.sn,
              atomic_item_no: loc.atomic_item_no,
              original_value: raw,
              normalized_value: norm,
              candidates: cands.map((x) => ({
                abd_item_id: x.abd_item_id,
                abd_number: x.abd_number,
              })),
              correction_mode: "inline_mapping",
              message: "하나의 입력값이 복수 ABD 에 해당합니다. canonical 값을 선택하십시오.",
            }),
          );
        } else {
          issues.push(
            issue({
              code: "ABD_NUMBER_UNRESOLVED",
              field: "abd_number",
              source_file: loc.source_file_name || null,
              sheet_name: loc.sheet_name,
              source_row: loc.source_row,
              sn: loc.sn,
              atomic_item_no: loc.atomic_item_no,
              original_value: raw,
              normalized_value: norm,
              candidates: [],
              correction_mode: "inline_mapping",
              message: `Baseline 에서 찾을 수 없는 ABD Number 입니다: ${raw}`,
            }),
          );
        }
      }
    }
  }

  // 4) active atomic identity 중복
  const idSeen = new Map<string, number>();
  for (const c of comments) {
    if (!c.is_active) continue;
    idSeen.set(c.source_comment_id, (idSeen.get(c.source_comment_id) ?? 0) + 1);
  }
  const dupIdentities = [...idSeen.entries()].filter(([, n]) => n > 1);
  for (const [id, n] of dupIdentities) {
    issues.push(
      issue({
        code: "DUPLICATE_ACTIVE_IDENTITY",
        field: "source_comment_id",
        sn: id,
        original_value: id,
        correction_mode: "source_excel_required",
        message: `active atomic identity 중복 ${n}건: ${id}`,
      }),
    );
  }

  // 4-1) OCS Number / atomic item 번호 계약
  for (const c of comments) {
    const loc = commentLocator(c, nameToHash);
    if (!c.ocs_number) {
      issues.push(
        issue({
          code: "OCS_NUMBER_MISSING",
          field: "ocs_number",
          source_file: loc.source_file_name || null,
          sheet_name: loc.sheet_name,
          source_row: loc.source_row,
          sn: loc.sn,
          atomic_item_no: loc.atomic_item_no,
          correction_mode: "source_excel_required",
          message: "OCS Number 가 비어 있습니다.",
        }),
      );
    }
    if (c.atomic_item_no === null) {
      issues.push(
        issue({
          code: "ATOMIC_ITEM_NO_MISSING",
          field: "atomic_item_no",
          source_file: loc.source_file_name || null,
          sheet_name: loc.sheet_name,
          source_row: loc.source_row,
          sn: loc.sn,
          correction_mode: "source_excel_required",
          message: "atomic item 번호가 비어 있습니다.",
        }),
      );
    }
  }

  // 5) 참조 무결성 — comment ↔ group
  const groupIds = new Set(pkg.atomic.groups.map((g) => g.group_id));
  const parentIds = new Set(pkg.atomic.groups.map((g) => g.source_parent_comment_id));
  for (const c of comments) {
    if (c.comment_group_id && !groupIds.has(c.comment_group_id)) {
      issues.push(
        issue({
          code: "GROUP_REF_MISSING",
          field: "comment_group_id",
          sn: c.source_comment_id,
          original_value: c.comment_group_id,
          correction_mode: "source_excel_required",
          message: `코멘트가 참조하는 group 이 패키지에 없습니다: ${c.comment_group_id}`,
        }),
      );
    }
    if (c.source_parent_comment_id && !parentIds.has(c.source_parent_comment_id)) {
      issues.push(
        issue({
          code: "PARENT_REF_MISSING",
          field: "source_parent_comment_id",
          sn: c.source_comment_id,
          original_value: c.source_parent_comment_id,
          correction_mode: "source_excel_required",
          message: `코멘트가 참조하는 원본 parent 가 패키지에 없습니다: ${c.source_parent_comment_id}`,
        }),
      );
    }
  }

  // 6) attachment ↔ comment 참조
  const commentIds = new Set(comments.map((c) => c.source_comment_id));
  for (const a of pkg.atomic.attachments) {
    if (a.atomic_comment_id && !commentIds.has(a.atomic_comment_id)) {
      issues.push(
        issue({
          code: "ATTACHMENT_COMMENT_REF_MISSING",
          field: "atomic_comment_id",
          original_value: a.atomic_comment_id,
          correction_mode: "source_excel_required",
          message: `첨부가 참조하는 코멘트가 패키지에 없습니다: ${a.source_attachment_id} → ${a.atomic_comment_id}`,
        }),
      );
    }
  }

  // 7) response mapping ↔ comment 참조
  for (const r of pkg.response.segments) {
    if (r.atomic_comment_id && !commentIds.has(r.atomic_comment_id)) {
      issues.push(
        issue({
          code: "RESPONSE_COMMENT_REF_MISSING",
          field: "atomic_comment_id",
          original_value: r.atomic_comment_id,
          correction_mode: "source_excel_required",
          message: `응답 매핑이 참조하는 코멘트가 패키지에 없습니다: ${r.atomic_comment_id}`,
        }),
      );
    }
  }
  for (const r of pkg.response.invalid_rows) {
    issues.push(
      issue({
        code: "RESPONSE_CONTRACT",
        field: "response_mapping",
        correction_mode: "source_excel_required",
        message: `response_mapping.json 형식 오류: ${r.reason}`,
      }),
    );
  }

  // 8) source Excel metadata ↔ binary
  const sourceNames = new Set(
    comments.map((c) => c.source_file_name).filter((x): x is string => !!x),
  );
  for (const name of sourceNames) {
    if (!nameToHash.has(name)) {
      issues.push(
        issue({
          code: "SOURCE_FILE_MISSING",
          field: "source_file_name",
          source_file: name,
          correction_mode: "source_excel_required",
          message: `코멘트가 참조하는 원본 Excel 이 패키지에 없습니다: ${name}`,
        }),
      );
    }
  }

  // 9) 중복 pair (같은 코멘트 ↔ 같은 ABD 조합)
  const pairSeen = new Set<string>();
  let duplicatePairs = 0;
  for (const c of comments) {
    if (!c.is_active) continue;
    for (const num of c.abd_numbers) {
      const key = `${c.source_comment_id}|${num}`;
      if (pairSeen.has(key)) {
        duplicatePairs += 1;
        issues.push(
          issue({
            code: "DUPLICATE_ABD_PAIR",
            field: "abd_number",
            sn: c.source_comment_id,
            original_value: num,
            correction_mode: "inline_mapping",
            message: `동일 코멘트에 동일 ABD 가 중복 연결되었습니다: ${num}`,
          }),
        );
      }
      pairSeen.add(key);
    }
  }

  // 10) 항등식
  const activeN = comments.filter((c) => c.is_active).length;
  const inactiveN = comments.length - activeN;
  const identityOk = activeN + inactiveN === comments.length;
  if (!identityOk) {
    issues.push(
      issue({ code: "IDENTITY_MISMATCH", field: "identity", message: "패키지 항등식 불일치" }),
    );
  }

  // 10-1) 교정 검산용 파생치 — active atomic = single + multi + unmatched
  let singleLinked = 0;
  let multiLinked = 0;
  let unmatched = 0;
  let associations = 0;
  const distinctAbd = new Set<string>();
  for (const c of comments) {
    if (!c.is_active) continue;
    const n = c.abd_numbers.length;
    associations += n;
    for (const x of c.abd_numbers) distinctAbd.add(x);
    if (n === 0) unmatched += 1;
    else if (n === 1) singleLinked += 1;
    else multiLinked += 1;
  }
  if (singleLinked + multiLinked + unmatched !== activeN) {
    issues.push(
      issue({ code: "LINK_IDENTITY_MISMATCH", field: "identity", message: "링크 항등식 불일치" }),
    );
  }

  const blocker_count = issues.filter((i) => i.severity === "blocker").length;
  const warning_count = issues.length - blocker_count;

  return {
    schema_version: LOCAL_VALIDATION_SCHEMA,
    validator_version: VALIDATOR_VERSION,
    validated_at: input.now ?? new Date().toISOString(),
    package_id: pkg.manifest.package_id,
    package_sha256: pkg.package_sha256,
    baseline_id: baseline.baseline_id,
    baseline_core_hash: baseline.core_hash,
    counts: {
      comments: comments.length,
      groups: pkg.atomic.groups.length,
      attachments: pkg.atomic.attachments.length,
      source_files: pkg.sourceFiles.length,
      images: pkg.images.length,
      response_segments: pkg.response.segments.length,
    },
    blocker_count,
    warning_count,
    abd_link_associations: associations,
    distinct_linked_abd: distinctAbd.size,
    active_comments: activeN,
    single_linked_comments: singleLinked,
    multi_linked_comments: multiLinked,
    unmatched_comments: unmatched,
    baseline_supports_local_validation: baseline.abdIndex !== null,
    unresolved_abd_count: unresolved,
    duplicate_identity_count: dupIdentities.length,
    duplicate_pair_count: duplicatePairs,
    identities: { comments_active_plus_inactive_equals_total: identityOk },
    correction_count: correctionCount,
    issues,
    clean: blocker_count === 0,
  };
}

/**
 * 로컬 검증 영수증 — ZIP 자기참조 hash 를 쓰지 않는다.
 * payload_sha256 = manifest + atomic + response + policy + corrections 의 canonical digest.
 */
export async function computeLocalPayloadDigest(args: {
  pkg: IncrementPackage;
  corrections: CorrectionsDoc | null;
  manifestForPayload: unknown;
}): Promise<string> {
  // PAYLOAD_DIGEST_PARTS 순서를 코드 상수로 고정한다. 영수증 자체는 대상에서 제외한다.
  const parts: Record<(typeof PAYLOAD_DIGEST_PARTS)[number], unknown> = {
    manifest: manifestPayloadView(args.manifestForPayload),
    atomic: {
      comments: args.pkg.atomic.comments,
      groups: args.pkg.atomic.groups,
      attachments: args.pkg.atomic.attachments,
    },
    response_mapping: args.pkg.response.segments,
    policy: args.pkg.policy,
    corrections: args.corrections
      ? { ...args.corrections, corrections_sha256: await correctionsSha256(args.corrections) }
      : null,
  };
  const ordered = PAYLOAD_DIGEST_PARTS.map((k) => [k, parts[k]] as const);
  return sha256Hex(canonicalJson({ parts: ordered.map(([k, v]) => ({ key: k, value: v })) }));
}

export async function buildLocalValidationReceipt(args: {
  pkg: IncrementPackage;
  result: LocalValidationResult;
  corrections: CorrectionsDoc | null;
  manifestForPayload: unknown;
}): Promise<LocalValidationReceipt> {
  const package_payload_sha256 = await computeLocalPayloadDigest({
    pkg: args.pkg,
    corrections: args.corrections,
    manifestForPayload: args.manifestForPayload,
  });
  // staging 재현 digest — 서버가 abd_ocs_v3_stage_* 로 동일하게 재계산할 수 있는 대상만 포함한다.
  const staging = await computeStagingPayloadDigest({
    atomic: args.pkg.atomic,
    response: args.pkg.response,
  });
  const contract_hash = await sha256Hex(
    canonicalJson({
      clean: args.result.clean,
      blocker_count: args.result.blocker_count,
      warning_count: args.result.warning_count,
      counts: args.result.counts,
      unresolved_abd_count: args.result.unresolved_abd_count,
      package_id: args.result.package_id,
      baseline_id: args.result.baseline_id,
    }),
  );
  return {
    schema_version: LOCAL_VALIDATION_SCHEMA,
    package_id: args.result.package_id,
    payload_sha256: staging.payload_sha256,
    digest_version: PAYLOAD_DIGEST_VERSION,
    package_payload_sha256,
    staging_counts: staging.counts,
    baseline_id: args.result.baseline_id,
    baseline_core_hash: args.result.baseline_core_hash,
    validator_version: VALIDATOR_VERSION,
    validated_at: args.result.validated_at,
    clean: args.result.clean,
    blocker_count: args.result.blocker_count,
    warning_count: args.result.warning_count,
    contract_hash,
    payload_parts: PAYLOAD_DIGEST_PARTS,
  };
}

/** 영수증 재계산 대조 — 변조된 payload digest 를 차단한다. */
export async function verifyLocalValidationReceipt(args: {
  receipt: LocalValidationReceipt;
  pkg: IncrementPackage;
  corrections: CorrectionsDoc | null;
  manifestForPayload: unknown;
}): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  if (args.receipt.schema_version !== LOCAL_VALIDATION_SCHEMA)
    reasons.push(`영수증 schema_version 불일치: ${args.receipt.schema_version}`);
  const expected = await computeLocalPayloadDigest({
    pkg: args.pkg,
    corrections: args.corrections,
    manifestForPayload: args.manifestForPayload,
  });
  if (expected !== args.receipt.package_payload_sha256)
    reasons.push("package_payload_sha256 가 재계산값과 다릅니다 (영수증 변조).");
  const staging = await computeStagingPayloadDigest({
    atomic: args.pkg.atomic,
    response: args.pkg.response,
  });
  if (staging.payload_sha256 !== args.receipt.payload_sha256)
    reasons.push("payload_sha256 가 staging canonical 재계산값과 다릅니다 (영수증 변조).");
  if (args.receipt.package_id !== args.pkg.manifest.package_id)
    reasons.push("영수증 package_id 가 패키지와 다릅니다.");
  if (!args.receipt.clean) reasons.push("영수증이 CLEAN 이 아닙니다.");
  return { ok: reasons.length === 0, reasons };
}
