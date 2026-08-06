// ABD OCS Latest Baseline — 클라이언트/서버 공용 상수·산식.
// baseline_id 산식은 여기 하나에만 존재한다. (증분 Import precheck 도 동일 산식을 쓴다)

export const BASELINE_SCHEMA_VERSION = "ocs-baseline-v1";
export const BASELINE_BUCKET = "db-backups";
export const BASELINE_PREFIX = "ocs-baselines";
export const BASELINE_SIGNED_URL_SECONDS = 600;

/** manifest.json 을 제외한 10개 데이터셋 (dump RPC whitelist 와 1:1) */
export const BASELINE_DATASETS = [
  "comments",
  "comment_groups",
  "comment_abd_links",
  "attachments",
  "attachment_comment_links",
  "response_segments",
  "response_comment_links",
  "compliance",
  "source_files",
  "number_corrections",
] as const;

export type BaselineDataset = (typeof BASELINE_DATASETS)[number];

export const BASELINE_CORE_TABLES = [
  "abd_ocs_comments",
  "abd_ocs_comment_groups",
  "abd_ocs_comment_abd_links",
  "abd_ocs_attachments",
  "abd_ocs_attachment_comment_links",
  "abd_ocs_response_segments",
  "abd_ocs_response_comment_links",
  "abd_ocs_source_files",
] as const;

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** baseline_id = sha256(schema_version + '|' + core_hash + '|' + latest_success_import_run_id) */
export function baselineIdInput(
  schemaVersion: string,
  coreHash: string,
  latestRunId: string,
): string {
  return `${schemaVersion}|${coreHash}|${latestRunId}`;
}

export async function computeBaselineId(
  schemaVersion: string,
  coreHash: string,
  latestRunId: string,
): Promise<string> {
  return sha256Hex(baselineIdInput(schemaVersion, coreHash, latestRunId));
}

export const shortId = (v: string | null | undefined) => (v ? v.slice(0, 16) : "");

export const baselineFolder = (baselineId: string) => `${BASELINE_PREFIX}/${baselineId}`;

export const baselineFileName = (stampCompact: string, baselineId: string) =>
  `OCS_Baseline_${stampCompact}_${shortId(baselineId)}.zip`;
