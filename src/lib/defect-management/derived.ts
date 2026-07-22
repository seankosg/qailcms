/** Defect 상태 파생 로직 (LetsBuild status_raw → rectified/closure).
 *  Status flow: Open → Rectified → Closed. 인스펙션 실패 시 Re-Opened로 되돌아감.
 *  Re-Opened는 진행률 관점에서 Open과 동일하게 "Not finish yet"로 취급하되,
 *  대시보드는 status_raw 기반으로 별도 Reopened 카운트를 유지한다.
 */

const CLOSED_STATUSES = new Set(["closed", "verified"]);
const RECTIFIED_STATUSES_SET = new Set(["rectified", "complete", "completed"]);
const REOPENED_STATUSES = new Set(["re-opened", "reopened", "re opened", "reopen", "re-open"]);
const IN_PROGRESS_STATUSES = new Set(["in progress", "inprogress", "wip", "under review"]);

export function deriveRectifiedStatus(statusRaw: string | null | undefined): string {
  if (!statusRaw) return "Not finish yet";
  const s = statusRaw.trim().toLowerCase();
  // Closed는 Rectified 후행 스테이지이므로 rectified_status도 Rectified로 반영.
  if (CLOSED_STATUSES.has(s)) return "Rectified";
  if (RECTIFIED_STATUSES_SET.has(s)) return "Rectified";
  if (REOPENED_STATUSES.has(s)) return "Not finish yet";
  if (IN_PROGRESS_STATUSES.has(s)) return "In Progress";
  if (s === "open" || s === "new") return "Not finish yet";
  return "Not finish yet";
}

export function deriveClosureStatus(statusRaw: string | null | undefined): string {
  if (!statusRaw) return "Not Closed";
  const s = statusRaw.trim().toLowerCase();
  if (CLOSED_STATUSES.has(s)) return "Closed";
  if (s === "ind" || s === "in dispute") return "InD";
  return "Not Closed";
}
