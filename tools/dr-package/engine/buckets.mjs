/**
 * DR 패키지 Storage 범위 정본 (HP1 확정).
 * db-backups 는 Snapshot 중복 보관물이므로 명시적으로 제외한다.
 */
export const DR_BUCKETS = [
  "abd-ocs-source-files",
  "abd-ocs-attachments",
  "spl-documents",
  "dmr-uploads",
  "spl-ocs-source-files",
  "abd-ocs-imports",
  "spl-ocs-attachments",
];

export const EXCLUDED_BUCKETS = ["db-backups"];

export function assertBucketScope(buckets) {
  for (const b of buckets) {
    if (EXCLUDED_BUCKETS.includes(b)) {
      throw new Error(`제외 대상 버킷이 포함되었습니다: ${b}`);
    }
  }
  return true;
}
