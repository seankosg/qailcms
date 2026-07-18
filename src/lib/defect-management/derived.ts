/** Defect 상태 파생 로직 (LetsBuild status_raw → rectified/closure). */

const CLOSED_STATUSES = new Set(["closed", "verified", "complete", "completed"]);
const IN_PROGRESS_STATUSES = new Set(["in progress", "inprogress", "under review", "reopened"]);

export function deriveRectifiedStatus(statusRaw: string | null | undefined): string {
  if (!statusRaw) return "Not Started";
  const s = statusRaw.trim().toLowerCase();
  if (CLOSED_STATUSES.has(s)) return "Complete";
  if (IN_PROGRESS_STATUSES.has(s)) return "In Progress";
  if (s === "open" || s === "new") return "Not Started";
  return "In Progress";
}

export function deriveClosureStatus(statusRaw: string | null | undefined): string {
  if (!statusRaw) return "Not Closed";
  const s = statusRaw.trim().toLowerCase();
  if (CLOSED_STATUSES.has(s)) return "Closed";
  if (s === "ind" || s === "in dispute") return "InD";
  return "Not Closed";
}
