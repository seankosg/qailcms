import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface FieldLog {
  id: string;
  raw_row_no: number | null;
  field_name: string;
  outcome: string;
  raw_value: string | null;
  applied_value: string | null;
  previous_value: string | null;
  reason_code: string | null;
  reason_detail: string | null;
}

export const OUTCOME_COLORS: Record<string, string> = {
  applied: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  unchanged: "bg-muted text-muted-foreground",
  derived: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  auto_filled: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  corrected: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  skipped_empty: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  skipped_clear_blocked: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  skipped_no_permission: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  rejected_invalid: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  rejected_conflict: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  info: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export const OUTCOME_LABELS: Record<string, string> = {
  applied: "Applied",
  unchanged: "Unchanged",
  derived: "Derived",
  auto_filled: "Auto-filled",
  corrected: "Corrected",
  skipped_empty: "Skipped (empty)",
  skipped_clear_blocked: "Skipped (clear blocked)",
  skipped_no_permission: "Skipped (no permission)",
  rejected_invalid: "Rejected (invalid)",
  rejected_conflict: "Rejected (conflict)",
  info: "Info",
};

const ALL_OUTCOMES = Object.keys(OUTCOME_LABELS);

const formatVal = (v: string | null) =>
  v == null || v === "" ? <span className="text-muted-foreground">—</span> : v;

export function FieldLogTable({ logs }: { logs: FieldLog[] }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-1">
        No field-level details for this row.
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Field</TableHead>
            <TableHead className="text-xs">Outcome</TableHead>
            <TableHead className="text-xs">Raw</TableHead>
            <TableHead className="text-xs">Applied</TableHead>
            <TableHead className="text-xs">Previous</TableHead>
            <TableHead className="text-xs">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="text-xs font-mono">{f.field_name}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-[10px] ${OUTCOME_COLORS[f.outcome] || ""}`}>
                  {OUTCOME_LABELS[f.outcome] || f.outcome}
                </Badge>
              </TableCell>
              <TableCell className="text-xs max-w-[160px] break-words">{formatVal(f.raw_value)}</TableCell>
              <TableCell className="text-xs max-w-[160px] break-words">{formatVal(f.applied_value)}</TableCell>
              <TableCell className="text-xs max-w-[160px] break-words">{formatVal(f.previous_value)}</TableCell>
              <TableCell className="text-xs max-w-[280px] break-words">
                {f.reason_code ? (
                  <div>
                    <span className="font-mono text-[11px]">{f.reason_code}</span>
                    {f.reason_detail && <div className="text-muted-foreground">{f.reason_detail}</div>}
                  </div>
                ) : (
                  f.reason_detail || <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function FieldLogSummaryChips({
  logs,
  activeOutcome,
  onSelect,
}: {
  logs: FieldLog[];
  activeOutcome?: string;
  onSelect?: (o: string) => void;
}) {
  const counts: Record<string, number> = {};
  for (const l of logs) counts[l.outcome] = (counts[l.outcome] || 0) + 1;
  const present = ALL_OUTCOMES.filter((o) => counts[o]);
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {present.map((o) => (
        <Badge
          key={o}
          variant="outline"
          className={`text-[10px] ${OUTCOME_COLORS[o] || ""} ${onSelect ? "cursor-pointer" : ""} ${
            activeOutcome === o ? "ring-2 ring-offset-1 ring-primary" : ""
          }`}
          onClick={onSelect ? () => onSelect(activeOutcome === o ? "all" : o) : undefined}
        >
          {OUTCOME_LABELS[o]} {counts[o]}
        </Badge>
      ))}
    </div>
  );
}

export function buildFieldLevelCsv(logs: FieldLog[]): string {
  const headers = [
    "raw_row_no",
    "field_name",
    "outcome",
    "raw_value",
    "applied_value",
    "previous_value",
    "reason_code",
    "reason_detail",
  ];
  const escape = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const l of logs) {
    lines.push(
      [
        l.raw_row_no,
        l.field_name,
        l.outcome,
        l.raw_value,
        l.applied_value,
        l.previous_value,
        l.reason_code,
        l.reason_detail,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadFieldLevelCsv(logs: FieldLog[], filename: string) {
  const csv = buildFieldLevelCsv(logs);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}