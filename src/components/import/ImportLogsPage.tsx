import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Trash2 } from "lucide-react";
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
import { fetchAllByUploadId } from "@/lib/import/fetchAllByUploadId";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Kind = RollbackKind;

interface Batch {
  id: string;
  file_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  imported_by: string | null;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  extra?: string | null; // discipline for TM, sheet for SP
  rolled_back_at?: string | null;
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
};

const CFG = {
  spare_part: {
    title: "Spare Part — Import Logs",
    backTo: "/closure/spare-part/import",
    logsTable: "spare_parts_import_logs",
    rowLogsTable: "spare_part_import_row_logs",
    deleteFn: "delete_spare_part_import_batch",
    keyLabel: "Doc Ref",
    keyColumn: "doc_ref",
    extraLabel: "Sheet",
  },
  task_management: {
    title: "Task Management — Import Logs",
    backTo: "/closure/spare-part/import",
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
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { hour12: false });
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
    if (kind === "spare_part") {
      const { data } = await supabase
        .from("spare_parts_import_logs")
        .select(
          "id, file_name, status, executed_at, duration_ms, executed_by, row_counts, sheet_name, rolled_back_at",
        )
        .order("executed_at", { ascending: false })
        .limit(100);
      const list: Batch[] = (data ?? []).map((r: any) => {
        const c = (r.row_counts ?? {}) as any;
        const startedAt = r.executed_at;
        const finishedAt = r.duration_ms
          ? new Date(new Date(r.executed_at).getTime() + r.duration_ms).toISOString()
          : null;
        return {
          id: r.id,
          file_name: r.file_name,
          status: r.status,
          started_at: startedAt,
          finished_at: finishedAt,
          imported_by: r.executed_by,
          total: c.total ?? 0,
          inserted: c.inserted ?? 0,
          updated: c.updated ?? 0,
          skipped: c.skipped ?? 0,
          rejected: c.rejected ?? 0,
          extra: r.sheet_name,
          rolled_back_at: r.rolled_back_at,
        };
      });
      setBatches(list);
      await loadUploaders(list.map((b) => b.imported_by).filter(Boolean) as string[]);
    } else if (kind === "task_management") {
      const { data } = await supabase
        .from("task_management_import_logs")
        .select(
          "id, file_name, status, started_at, finished_at, imported_by, total_rows, inserted, updated, skipped, rejected, discipline, rolled_back_at",
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
        total: r.total_rows ?? 0,
        inserted: r.inserted ?? 0,
        updated: r.updated ?? 0,
        skipped: r.skipped ?? 0,
        rejected: r.rejected ?? 0,
        extra: r.discipline,
        rolled_back_at: r.rolled_back_at,
      }));
      setBatches(list);
      await loadUploaders(list.map((b) => b.imported_by).filter(Boolean) as string[]);
    } else if (kind === "defect_management") {
      const { data } = await (supabase as any)
        .from("defect_import_logs")
        .select(
          "id, file_name, status, started_at, finished_at, imported_by, total_rows, inserted, updated, skipped, rejected, team, rolled_back_at",
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
    try {
      const cols =
        kind === "spare_part"
          ? "id, raw_row_no, doc_ref, action_taken, reason_code, reason_detail, processed_at"
          : kind === "task_management"
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
          kind === "spare_part"
            ? r.doc_ref
            : kind === "task_management"
              ? r.task_no
              : kind === "defect_management"
                ? r.source_issue_no
                : r.abd_number,
        processed_at: r.processed_at,
      }));
      setRowLogs(mapped);
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
                        colSpan={11 + (hasExtra ? 1 : 0)}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : batches.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={11 + (hasExtra ? 1 : 0)}
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
            <div className="rounded-md border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : rowLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        행 로그가 없습니다
                      </TableCell>
                    </TableRow>
                  ) : (
                    rowLogs.slice(0, 1000).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{r.raw_row_no ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{r.key_value ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${actionColor[r.action_taken] || ""}`}>
                            {r.action_taken}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{r.reason_code ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.reason_detail ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {rowLogs.length > 1000 && (
              <p className="text-xs text-muted-foreground mt-2">
                상위 1000행만 표시 (총 {rowLogs.length}행)
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}