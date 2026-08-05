import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RollbackDialog, type RollbackKind } from "@/components/import/RollbackDialog";
import { fetchAllByUploadId, fetchAllFieldLogs } from "@/lib/import/fetchAllByUploadId";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  FieldLogTable,
  FieldLogSummaryChips,
  OUTCOME_LABELS,
  downloadFieldLevelCsv,
  type FieldLog,
} from "@/components/import/FieldLogTable";
import { Fragment } from "react";
import { formatDdMmmYyyy, formatDdMmmYyyyHm } from "@/lib/time/doha";

const FIELD_OUTCOMES = Object.keys(OUTCOME_LABELS);

type Kind = RollbackKind;

interface Batch {
  id: string;
  file_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  imported_by: string | null;
  data_date: string | null;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  extra?: string | null; // discipline for TM, sheet for SP
  rolled_back_at?: string | null;
  /** TM: 파싱/반영 행수와 사유별 제외 건수 (E-2) */
  parsed_rows?: number | null;
  applied_rows?: number | null;
  exclusions?: Record<string, unknown> | null;
}

interface RowLog {
  id: string;
  raw_row_no: number | null;
  action_taken: string;
  reason_code: string | null;
  reason_detail: string | null;
  key_value: string | null;
  processed_at: string;
}

const statusColor: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  rolled_back: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

const actionColor: Record<string, string> = {
  inserted: "bg-emerald-100 text-emerald-800",
  updated: "bg-blue-100 text-blue-800",
  skipped: "bg-yellow-100 text-yellow-800",
  rejected: "bg-red-100 text-red-800",
  inactivated: "bg-slate-200 text-slate-800",
  skipped_locked: "bg-yellow-100 text-yellow-800",
  mismatched: "bg-orange-100 text-orange-800",
};

const CFG = {
  task_management: {
    title: "Task Management — Import Logs",
    backTo: "/import-log/import",
    logsTable: "task_management_import_logs",
    rowLogsTable: "task_management_import_row_logs",
    deleteFn: "delete_task_management_import_batch",
    keyLabel: "Task No",
    keyColumn: "task_no",
    extraLabel: "Discipline",
  },
  defect_management: {
    title: "Snag List — Import Logs",
    backTo: "/closure/snag-management/import",
    logsTable: "defect_import_logs",
    rowLogsTable: "defect_import_row_logs",
    deleteFn: "delete_defect_import_batch",
    keyLabel: "Source Issue No",
    keyColumn: "source_issue_no",
    // Team은 파일 단위가 아니라 행 단위 자동매핑 결과이므로 배치 목록에서 노출하지 않음.
    extraLabel: null,
  },
  abd: {
    title: "ABD — Import Logs",
    backTo: "/closure/abd/import",
    logsTable: "abd_import_logs",
    rowLogsTable: "abd_import_row_logs",
    deleteFn: "delete_abd_import_batch",
    keyLabel: "ABD Number",
    keyColumn: "abd_number",
    extraLabel: "Team",
  },
} as const;

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return formatDdMmmYyyyHm(iso) || "—";
}

function fmtDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function ImportLogsPage({ kind }: { kind: Kind }) {
  const cfg = CFG[kind];
  const hasExtra = !!cfg.extraLabel;
  const navigate = useNavigate();
  const { data: me } = useCurrentUser();
  const isAdmin = me?.roles?.includes("admin") || me?.roles?.includes("superuser");

  const [batches, setBatches] = useState<Batch[]>([]);
  const [uploaderNames, setUploaderNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [rowLogs, setRowLogs] = useState<RowLog[]>([]);
  const [fieldOutcomeCounts, setFieldOutcomeCounts] = useState<Record<string, number>>({});
  const [fieldLogCache, setFieldLogCache] = useState<Record<number, FieldLog[]>>({});
  const [fieldRowLoading, setFieldRowLoading] = useState<number | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [fieldKind, setFieldKind] = useState<string>("defect");
  const [expandedRowNo, setExpandedRowNo] = useState<number | null>(null);
  const [fieldOutcomeFilter, setFieldOutcomeFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [rowSearch, setRowSearch] = useState<string>("");
  const [renderLimit, setRenderLimit] = useState<number>(500);

  useEffect(() => {
    void fetchBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const fetchBatches = async () => {
    setLoading(true);
    if (kind === "task_management") {
      const { data } = await supabase
        .from("task_management_import_logs")
        .select(
          "id, file_name, status, started_at, finished_at, imported_by, data_date, total_rows, inserted, updated, skipped, rejected, discipline, rolled_back_at, parsed_rows, applied_rows, exclusions",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      const list: Batch[] = (data ?? []).map((r: any) => ({
        id: r.id,
        file_name: r.file_name,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at,
        imported_by: r.imported_by,
        data_date: r.data_date,
        total: r.total_rows ?? 0,
        inserted: r.inserted ?? 0,
        updated: r.updated ?? 0,
        skipped: r.skipped ?? 0,
        rejected: r.rejected ?? 0,
        extra: r.discipline,
        rolled_back_at: r.rolled_back_at,
        parsed_rows: r.parsed_rows ?? null,
        applied_rows: r.applied_rows ?? null,
        exclusions: r.exclusions ?? null,
      }));
      setBatches(list);
      await loadUploaders(list.map((b) => b.imported_by).filter(Boolean) as string[]);
    } else if (kind === "defect_management") {
      const { data } = await (supabase as any)
        .from("defect_import_logs")
        .select(
          "id, file_name, status, started_at, finished_at, imported_by, data_date, total_rows, inserted, updated, skipped, rejected, team, rolled_back_at",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      const list: Batch[] = (data ?? []).map((r: any) => ({
        id: r.id,
        file_name: r.file_name,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at,
        imported_by: r.imported_by,
        data_date: r.data_date,
        total: r.total_rows ?? 0,
        inserted: r.inserted ?? 0,
        updated: r.updated ?? 0,
        skipped: r.skipped ?? 0,
        rejected: r.rejected ?? 0,
        extra: r.team,
        rolled_back_at: r.rolled_back_at,
      }));
      setBatches(list);
      await loadUploaders(list.map((b) => b.imported_by).filter(Boolean) as string[]);
    } else {
      // abd
      const { data } = await (supabase as any)
        .from("abd_import_logs")
        .select(
          "id, file_name, status, started_at, finished_at, imported_by, total_rows, inserted, updated, inactivated, mismatched, skipped_no_key, team, rolled_back_at",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      const list: Batch[] = (data ?? []).map((r: any) => ({
        id: r.id,
        file_name: r.file_name,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at,
        imported_by: r.imported_by,
        data_date: null,
        total: r.total_rows ?? 0,
        inserted: r.inserted ?? 0,
        updated: r.updated ?? 0,
        skipped: (r.skipped_no_key ?? 0) + (r.inactivated ?? 0),
        rejected: r.mismatched ?? 0,
        extra: r.team,
        rolled_back_at: r.rolled_back_at,
      }));
      setBatches(list);
      await loadUploaders(list.map((b) => b.imported_by).filter(Boolean) as string[]);
    }
    setLoading(false);
  };

  const loadUploaders = async (ids: string[]) => {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) {
      setUploaderNames({});
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", unique);
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as any[]) {
      map[r.id] = r.display_name || r.email || "";
    }
    setUploaderNames(map);
  };

  const loadDetail = async (id: string) => {
    setSelected(id);
    setDetailLoading(true);
    setActionFilter("all");
    setReasonFilter("all");
    setRowSearch("");
    setRenderLimit(500);
    setFieldOutcomeCounts({});
    setFieldLogCache({});
    setFieldRowLoading(null);
    setExpandedRowNo(null);
    setFieldOutcomeFilter("all");
    try {
      const cols =
        kind === "task_management"
          ? "id, raw_row_no, discipline, task_no, action_taken, reason_code, reason_detail, processed_at"
          : kind === "defect_management"
            ? "id, raw_row_no, team, source_issue_no, action_taken, reason_code, reason_detail, processed_at"
            : "id, raw_row_no, team, abd_number, action_taken, reason_code, reason_detail, processed_at";
      const rows = await fetchAllByUploadId<any>(cfg.rowLogsTable, cols, id);
      const mapped: RowLog[] = rows.map((r: any) => ({
        id: r.id,
        raw_row_no: r.raw_row_no,
        action_taken: r.action_taken,
        reason_code: r.reason_code,
        reason_detail: r.reason_detail,
        key_value:
          kind === "task_management"
            ? r.task_no
            : kind === "defect_management"
              ? r.source_issue_no
              : r.abd_number,
        processed_at: r.processed_at,
      }));
      setRowLogs(mapped);
      // 필드 단위 로그 조회 (SHAW 스타일 확장 상세)
      try {
        const kindKey =
          kind === "task_management"
            ? "task_management"
            : kind === "defect_management"
              ? "defect"
              : "abd";
        setFieldKind(kindKey);
        // 업로드당 필드 로그는 수십만 건까지 가능 → 전량 로드 금지.
        // 요약은 outcome별 count(head), 상세는 행 확장 시 개별 조회.
        const entries = await Promise.all(
          FIELD_OUTCOMES.map(async (o) => {
            const { count } = await (supabase as any)
              .from("import_field_logs")
              .select("id", { count: "exact", head: true })
              .eq("upload_id", id)
              .eq("kind", kindKey)
              .eq("outcome", o);
            return [o, (count ?? 0) as number] as const;
          }),
        );
        const counts: Record<string, number> = {};
        for (const [o, c] of entries) if (c > 0) counts[o] = c;
        setFieldOutcomeCounts(counts);
      } catch (e) {
        console.warn("field logs load failed", e);
        setFieldOutcomeCounts({});
      }
    } catch (e) {
      console.error("Row logs load failed", e);
      setRowLogs([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const deleteBatch = async (b: Batch) => {
    setDeletingId(b.id);
    try {
      const { error } = await (supabase as any).rpc(cfg.deleteFn, { _batch_id: b.id });
      if (error) throw error;
      toast.success("배치 삭제 완료", { description: `${b.file_name} 및 관련 데이터 제거` });
      if (selected === b.id) setSelected(null);
      await fetchBatches();
    } catch (e: any) {
      toast.error("삭제 실패", { description: e?.message ?? "권한을 확인하세요" });
    } finally {
      setDeletingId(null);
    }
  };

  const selectedBatch = batches.find((b) => b.id === selected) ?? null;

  const actionCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rowLogs) {
      const k = r.action_taken || "unknown";
      acc[k] = (acc[k] || 0) + 1;
    }
    return acc;
  }, [rowLogs]);

  const actionOptions = useMemo(
    () => Array.from(new Set(rowLogs.map((r) => r.action_taken).filter(Boolean))).sort(),
    [rowLogs],
  );

  const reasonOptions = useMemo(
    () =>
      Array.from(
        new Set(rowLogs.map((r) => r.reason_code).filter(Boolean) as string[]),
      ).sort(),
    [rowLogs],
  );

  const filteredRowLogs = useMemo(() => {
    const q = rowSearch.trim();
    return rowLogs.filter((r) => {
      if (actionFilter !== "all" && (r.action_taken || "") !== actionFilter)
        return false;
      if (reasonFilter !== "all") {
        if (reasonFilter === "__none__") {
          if (r.reason_code) return false;
        } else if (r.reason_code !== reasonFilter) return false;
      }
      if (q && String(r.raw_row_no ?? "") !== q) return false;
      return true;
    });
  }, [rowLogs, actionFilter, reasonFilter, rowSearch]);

  const visibleRowLogs = filteredRowLogs.slice(0, renderLimit);

  const fieldLogTotal = useMemo(
    () => Object.values(fieldOutcomeCounts).reduce((a, b) => a + b, 0),
    [fieldOutcomeCounts],
  );

  const fieldOutcomeOptions = useMemo(
    () => Object.keys(fieldOutcomeCounts).sort(),
    [fieldOutcomeCounts],
  );

  /** 행 확장 시 해당 raw_row_no 의 필드 로그만 조회 (전량 로드 금지). */
  const toggleRowFields = async (rowNo: number) => {
    if (expandedRowNo === rowNo) {
      setExpandedRowNo(null);
      return;
    }
    setExpandedRowNo(rowNo);
    if (fieldLogCache[rowNo] || !selected) return;
    setFieldRowLoading(rowNo);
    try {
      let q = (supabase as any)
        .from("import_field_logs")
        .select(
          "id, raw_row_no, field_name, outcome, raw_value, applied_value, previous_value, reason_code, reason_detail",
        )
        .eq("upload_id", selected)
        .eq("kind", fieldKind)
        .order("field_name", { ascending: true })
        .limit(500);
      q = rowNo === -1 ? q.is("raw_row_no", null) : q.eq("raw_row_no", rowNo);
      const { data, error } = await q;
      if (error) throw error;
      setFieldLogCache((c) => ({ ...c, [rowNo]: (data ?? []) as FieldLog[] }));
    } catch (e) {
      console.warn("row field logs load failed", e);
      setFieldLogCache((c) => ({ ...c, [rowNo]: [] }));
    } finally {
      setFieldRowLoading(null);
    }
  };

  /** CSV 는 요청 시에만 페이지네이션 조회 (최대 100,000행). */
  const exportFieldCsv = async () => {
    if (!selected) return;
    setCsvLoading(true);
    try {
      const rows = await fetchAllFieldLogs<FieldLog>(
        selected,
        fieldKind,
        "id, raw_row_no, field_name, outcome, raw_value, applied_value, previous_value, reason_code, reason_detail",
        1000,
        fieldOutcomeFilter === "all" ? undefined : fieldOutcomeFilter,
        100_000,
      );
      downloadFieldLevelCsv(rows, `${selectedBatch?.file_name ?? "field-logs"}.csv`);
    } catch (e) {
      console.error("field csv export failed", e);
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => (selected ? setSelected(null) : navigate({ to: cfg.backTo }))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          {selected ? "Import 행 상세" : cfg.title}
        </h1>
      </div>

      {!selected ? (
        <Card>
          <CardContent className="pt-4">
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">File</TableHead>
                    {hasExtra && <TableHead className="text-xs">{cfg.extraLabel}</TableHead>}
                    <TableHead className="text-xs">Data Date</TableHead>
                    <TableHead className="text-xs">Uploaded</TableHead>
                    <TableHead className="text-xs">Uploader</TableHead>
                    <TableHead className="text-xs text-right">Duration</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Total</TableHead>
                    <TableHead className="text-xs text-right">Inserted</TableHead>
                    <TableHead className="text-xs text-right">Updated</TableHead>
                    <TableHead className="text-xs text-right">Skipped</TableHead>
                    <TableHead className="text-xs text-right">Rejected</TableHead>
                    <TableHead className="text-xs w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                  <TableRow>
                      <TableCell
                        colSpan={12 + (hasExtra ? 1 : 0)}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : batches.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12 + (hasExtra ? 1 : 0)}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Import 이력이 없습니다
                      </TableCell>
                    </TableRow>
                  ) : (
                    batches.map((b) => {
                      const uploader = b.imported_by ? uploaderNames[b.imported_by] || "—" : "—";
                      const isOwner = !!me?.id && b.imported_by === me.id;
                      const canRollback = isAdmin || isOwner;
                      return (
                        <TableRow
                          key={b.id}
                          className={`hover:bg-muted/50 ${b.status === "rolled_back" ? "opacity-60 line-through decoration-slate-400" : ""}`}
                        >
                          <TableCell
                            className="text-xs font-medium cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.file_name}
                          </TableCell>
                          {hasExtra && (
                            <TableCell
                              className="text-xs cursor-pointer"
                              onClick={() => loadDetail(b.id)}
                            >
                              {b.extra ?? "—"}
                            </TableCell>
                          )}
                          <TableCell
                            className="text-xs cursor-pointer whitespace-nowrap"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.data_date ? (formatDdMmmYyyy(b.data_date) || "—") : "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs cursor-pointer whitespace-nowrap"
                            onClick={() => loadDetail(b.id)}
                          >
                            {fmtDateTime(b.started_at)}
                          </TableCell>
                          <TableCell
                            className="text-xs cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {uploader}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer whitespace-nowrap"
                            onClick={() => loadDetail(b.id)}
                          >
                            {fmtDuration(b.started_at, b.finished_at)}
                          </TableCell>
                          <TableCell className="cursor-pointer" onClick={() => loadDetail(b.id)}>
                            <div className="flex flex-col gap-0.5 no-underline">
                              <Badge
                                variant="outline"
                                className={`text-xs w-fit ${statusColor[b.status] || ""}`}
                              >
                                {b.status === "rolled_back" ? "rolled back" : b.status}
                              </Badge>
                              {b.status === "rolled_back" && b.rolled_back_at && (
                                <span
                                  className="text-[10px] text-muted-foreground whitespace-nowrap"
                                  title={new Date(b.rolled_back_at).toLocaleString()}
                                >
                                  {fmtDateTime(b.rolled_back_at)}
                                </span>
                              )}
                              {b.status === "partial" && (
                                <span className="text-[10px] text-amber-700 dark:text-amber-300">
                                  {typeof b.applied_rows === "number" &&
                                  typeof b.parsed_rows === "number"
                                    ? `반영 ${b.applied_rows}/${b.parsed_rows}`
                                    : "일부 미반영"}
                                  {b.exclusions
                                    ? ` · ${Object.entries(b.exclusions)
                                        .filter(([, v]) => typeof v === "number" && v > 0)
                                        .map(([k, v]) => `${k}=${v}`)
                                        .join(" · ")}`
                                    : ""}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.total}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.inserted}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.updated}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.skipped}
                          </TableCell>
                          <TableCell
                            className="text-xs text-right cursor-pointer"
                            onClick={() => loadDetail(b.id)}
                          >
                            {b.rejected}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              {canRollback && b.status !== "rolled_back" && (
                                <RollbackDialog
                                  kind={kind}
                                  batchId={b.id}
                                  fileName={b.file_name}
                                  onDone={fetchBatches}
                                />
                              )}
                              {isAdmin && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      disabled={deletingId === b.id}
                                      title="배치 삭제 (모든 데이터 제거)"
                                    >
                                      {deletingId === b.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>배치를 완전히 삭제하시겠습니까?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        <strong>{b.file_name}</strong> 및 이 배치가 만든 모든 원본 행/로그가
                                        영구 삭제됩니다. 되돌릴 수 없습니다. 변경분만 되돌리려면 Rollback을
                                        사용하세요.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>취소</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteBatch(b)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{selectedBatch?.file_name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline">Total {rowLogs.length}</Badge>
                {actionOptions.map((a) => (
                  <Badge
                    key={a}
                    variant="outline"
                    className={`cursor-pointer ${actionColor[a] || ""} ${
                      actionFilter === a ? "ring-2 ring-offset-1 ring-primary" : ""
                    }`}
                    onClick={() => {
                      setActionFilter((cur) => (cur === a ? "all" : a));
                      setRenderLimit(500);
                    }}
                  >
                    {a} {actionCounts[a] || 0}
                  </Badge>
                ))}
              </div>
              <div className="flex-1" />
              {fieldLogTotal > 0 && (
                <>
                  <Select
                    value={fieldOutcomeFilter}
                    onValueChange={(v) => setFieldOutcomeFilter(v)}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue placeholder="Field outcome" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All field outcomes</SelectItem>
                      {fieldOutcomeOptions.map((o) => (
                        <SelectItem key={o} value={o}>
                          {OUTCOME_LABELS[o] || o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={csvLoading}
                    onClick={() => void exportFieldCsv()}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    {csvLoading ? "Exporting…" : "Field-level CSV"}
                  </Button>
                </>
              )}
              <Select
                value={actionFilter}
                onValueChange={(v) => {
                  setActionFilter(v);
                  setRenderLimit(500);
                }}
              >
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={reasonFilter}
                onValueChange={(v) => {
                  setReasonFilter(v);
                  setRenderLimit(500);
                }}
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue placeholder="Reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All reasons</SelectItem>
                  <SelectItem value="__none__">(no reason)</SelectItem>
                  {reasonOptions.map((rc) => (
                    <SelectItem key={rc} value={rc}>
                      {rc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={rowSearch}
                onChange={(e) => {
                  setRowSearch(e.target.value);
                  setRenderLimit(500);
                }}
                placeholder="Row #"
                className="h-8 w-[100px] text-xs"
              />
            </div>
            {fieldLogTotal > 0 && (
              <div className="mb-2">
                <FieldLogSummaryChips
                  counts={fieldOutcomeCounts}
                  activeOutcome={fieldOutcomeFilter}
                  onSelect={(o) => setFieldOutcomeFilter(o)}
                />
              </div>
            )}
            <div className="rounded-md border max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="text-xs w-8"></TableHead>
                    <TableHead className="text-xs w-16">Row</TableHead>
                    <TableHead className="text-xs">{cfg.keyLabel}</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                    <TableHead className="text-xs">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : filteredRowLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {rowLogs.length === 0
                          ? "행 로그가 없습니다"
                          : "필터에 해당하는 행이 없습니다"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleRowLogs.map((r) => {
                      const rowNo = r.raw_row_no ?? -1;
                      const cached = fieldLogCache[rowNo];
                      const fls = (cached ?? []).filter(
                        (f) => fieldOutcomeFilter === "all" || f.outcome === fieldOutcomeFilter,
                      );
                      const hasField = fieldLogTotal > 0;
                      const isOpen = expandedRowNo === rowNo;
                      return (
                        <Fragment key={r.id}>
                          <TableRow className={hasField ? "cursor-pointer hover:bg-muted/40" : ""}>
                            <TableCell className="text-xs">
                              {hasField ? (
                                <button
                                  type="button"
                                  className="p-0.5 rounded hover:bg-muted"
                                  onClick={() => void toggleRowFields(rowNo)}
                                  aria-label={isOpen ? "Collapse" : "Expand"}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-muted-foreground">·</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{r.raw_row_no ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono">{r.key_value ?? "—"}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-xs ${actionColor[r.action_taken] || ""}`}
                              >
                                {r.action_taken}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">{r.reason_code ?? "—"}</TableCell>
                            <TableCell className="text-xs max-w-[420px] whitespace-normal break-words">
                              {r.reason_detail ?? "—"}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell colSpan={6} className="p-2">
                                {fieldRowLoading === rowNo ? (
                                  <div className="py-2 text-xs text-muted-foreground">Loading…</div>
                                ) : fls.length === 0 ? (
                                  <div className="py-2 text-xs text-muted-foreground">
                                    필드 로그가 없습니다
                                  </div>
                                ) : (
                                  <FieldLogTable logs={fls} />
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>
                Showing {visibleRowLogs.length} of {filteredRowLogs.length}
                {filteredRowLogs.length !== rowLogs.length
                  ? ` (filtered from ${rowLogs.length})`
                  : ""}
              </span>
              {visibleRowLogs.length < filteredRowLogs.length && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRenderLimit((l) => l + 500)}
                >
                  Show 500 more
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}