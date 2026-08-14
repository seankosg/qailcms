import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  ClipboardCopy,
  CheckCheck,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { todayInDoha } from "@/lib/time/doha";
import { rclCanRows } from "@/hooks/useRclCan";
import {
  buildSplBulkFields,
  type SplBulkField,
  type SplStageColumn,
} from "./spl-columns";
import { SplBulkDeleteDialog } from "./SplBulkDeleteDialog";
import { SplBulkConfirmDialog } from "./SplBulkConfirmDialog";
import { copySplRowsAsTsv, exportSplRowsToXlsx, type SplExportColumn } from "@/lib/spl/bulk-actions";

const BLANK = "__BLANK__";
const CHUNK = 200;

interface Props {
  selectedIds: string[];
  /** 표시용으로 평탄화된 선택 행 (컬럼 키 → 문자열, `id`/`spl_number` 포함) */
  selectedRows: Record<string, unknown>[];
  /** 카탈로그에서 만든 스테이지 컬럼 — Bulk Edit 목록에 그대로 노출한다 */
  stageColumns: SplStageColumn[];
  /** 표에 보이는 전체 컬럼(내보내기용) */
  exportColumns: SplExportColumn[];
  onClear: () => void;
  onSaveField: (id: string, field: string, value: string | null) => Promise<void>;
  onSaveStage: (
    id: string,
    stage: { stage_code: string; field: "ps" | "as" | "pf" | "af" | "fv" },
    value: string | null,
  ) => Promise<void>;
  onDone: () => Promise<void> | void;
  disabledReason?: string | null;
  /**
   * 선택 행의 REQUIRED 문서를 전부 「받았음」으로. 기존 RPC 반복 호출이며,
   * 대상 계산은 행 데이터를 가진 화면(SplRawDataPage)이 한다.
   */
  onReqDocReadyAll?: (ids: string[]) => Promise<void>;
}

export function SplBulkEditBar({
  selectedIds,
  selectedRows,
  stageColumns,
  exportColumns,
  onClear,
  onSaveField,
  onSaveStage,
  onDone,
  disabledReason,
  onReqDocReadyAll,
}: Props) {
  const [fieldKey, setFieldKey] = useState<string>("");
  const [rawValue, setRawValue] = useState<string>("");
  const [setBlank, setSetBlank] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [deletable, setDeletable] = useState<string[] | null>(null);
  const [reqDocRunning, setReqDocRunning] = useState(false);

  useEffect(() => {
    let live = true;
    if (selectedIds.length === 0) {
      setAllowed(null);
      setDeletable(null);
      return;
    }
    void rclCanRows("SPL", selectedIds, "write").then((s) => {
      if (live) setAllowed(selectedIds.filter((id) => s.has(id)));
    });
    void rclCanRows("SPL", selectedIds, "delete")
      .then((s) => {
        if (live) setDeletable(selectedIds.filter((id) => s.has(id)));
      })
      .catch(() => {
        if (live) setDeletable([]);
      });
    return () => {
      live = false;
    };
  }, [selectedIds]);

  const fields = useMemo(() => buildSplBulkFields(stageColumns), [stageColumns]);
  const fieldGroups = useMemo(() => {
    const map = new Map<string, SplBulkField[]>();
    for (const f of fields) {
      const arr = map.get(f.group) ?? [];
      arr.push(f);
      map.set(f.group, arr);
    }
    return Array.from(map.entries());
  }, [fields]);
  const field = useMemo(() => fields.find((f) => f.key === fieldKey) ?? null, [fields, fieldKey]);

  const count = selectedIds.length;
  const ids = allowed ?? [];
  const skippedCount = count - ids.length;
  const delIds = deletable ?? [];
  const delExcluded = count - delIds.length;

  if (count === 0) return null;

  const computedValue: string | null = setBlank ? null : rawValue === "" ? null : rawValue;
  const valueUnset = !setBlank && rawValue === "";

  function reset() {
    setFieldKey("");
    setRawValue("");
    setSetBlank(false);
    setCustomMode(false);
  }

  async function handleApply() {
    if (!field || field.kind === "derived") return;
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    if (ids.length === 0) {
      toast.error("편집 권한이 있는 행이 없습니다.");
      return;
    }
    setSubmitting(true);
    let ok = 0;
    let failed = 0;
    let firstError: string | null = null;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (ids.length > CHUNK) {
          toast.info(`Applying… (batch ${Math.floor(i / CHUNK) + 1}/${Math.ceil(ids.length / CHUNK)})`);
        }
        for (const id of slice) {
          try {
            // eslint-disable-next-line no-await-in-loop
            if (field.kind === "stage" && field.stage) {
              await onSaveStage(id, field.stage, computedValue);
            } else if (field.column) {
              await onSaveField(id, field.column, computedValue);
            }
            ok += 1;
          } catch (e: any) {
            failed += 1;
            if (!firstError) firstError = e?.message ?? String(e);
          }
        }
      }
      toast.success(failed > 0 ? "부분 반영" : "저장 완료", {
        description: `${ok} updated${failed > 0 ? ` · ${failed} 실패 — ${firstError}` : ""}${
          skippedCount > 0 ? ` · ${skippedCount} 권한없음 skip` : ""
        }`,
      });
      setConfirmOpen(false);
      reset();
      await onDone();
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportXlsx() {
    try {
      exportSplRowsToXlsx({
        rows: selectedRows,
        columns: exportColumns,
        fileName: `CMS_SPL_selected_${todayInDoha()}.xlsx`,
      });
      toast.success("Export 완료", { description: `${count} rows exported.` });
    } catch (e: any) {
      toast.error("Export 실패", { description: e?.message ?? String(e) });
    }
  }

  async function handleCopyTsv() {
    try {
      const r = await copySplRowsAsTsv({ rows: selectedRows, columns: exportColumns });
      toast.success("클립보드 복사 완료", {
        description: `${r.rowCount} rows × ${r.colCount} columns.`,
      });
    } catch (e: any) {
      toast.error("복사 실패", { description: e?.message ?? String(e) });
    }
  }

  const applyDisabled =
    !field ||
    field.kind === "derived" ||
    submitting ||
    !!disabledReason ||
    (valueUnset && !setBlank);

  return (
    <>
      <div className="sticky bottom-2 z-30 rounded-md border border-l-2 border-l-primary bg-card px-3 py-2 shadow-lg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 pr-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-sm font-semibold">{count} selected</span>
            <span className="text-[11px] text-muted-foreground">
              적용 {ids.length}
              {skippedCount > 0 && ` · 권한없음 ${skippedCount}`}
            </span>
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              value={fieldKey}
              onValueChange={(v) => {
                setFieldKey(v);
                setRawValue("");
                setSetBlank(false);
                setCustomMode(false);
              }}
            >
              <SelectTrigger className="h-8 w-[220px]">
                <SelectValue placeholder="Edit field…" />
              </SelectTrigger>
              <SelectContent className="max-h-[400px]">
                {fieldGroups.map(([group, list]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {list.map((f) => (
                      <SelectItem
                        key={f.key}
                        value={f.key}
                        disabled={f.kind === "derived"}
                        className="text-xs"
                      >
                        {f.label}
                        {f.disabledReason ? ` (${f.disabledReason})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {field && field.kind !== "derived" && (
              <>
                {field.inputType === "select" &&
                  (customMode ? (
                    <Input
                      type="text"
                      className="h-8 w-[160px]"
                      value={setBlank ? "" : rawValue}
                      disabled={setBlank}
                      onChange={(e) => setRawValue(e.target.value)}
                      placeholder="신규값 입력…"
                    />
                  ) : (
                    <Select
                      value={setBlank ? BLANK : rawValue}
                      onValueChange={(v) => {
                        setRawValue(v === BLANK ? "" : v);
                        setSetBlank(v === BLANK);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[160px]">
                        <SelectValue placeholder="New value…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BLANK}>(Clear / Blank)</SelectItem>
                        {(field.options ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                {field.inputType === "select" && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={customMode}
                      onCheckedChange={(c) => {
                        setCustomMode(!!c);
                        setRawValue("");
                        setSetBlank(false);
                      }}
                    />
                    신규값 입력
                  </label>
                )}
                {field.inputType === "date" && (
                  <Input
                    type="date"
                    className="h-8 w-[160px]"
                    value={setBlank ? "" : rawValue}
                    disabled={setBlank}
                    onChange={(e) => setRawValue(e.target.value)}
                  />
                )}
                {field.inputType === "text" && (
                  <Input
                    type="text"
                    className="h-8 w-[220px]"
                    value={setBlank ? "" : rawValue}
                    disabled={setBlank}
                    onChange={(e) => setRawValue(e.target.value)}
                    placeholder="New value…"
                  />
                )}

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={setBlank}
                    onCheckedChange={(c) => {
                      setSetBlank(!!c);
                      if (c) setRawValue("");
                    }}
                  />
                  Blank
                </label>
              </>
            )}

            <Button size="sm" className="h-8" disabled={applyDisabled} onClick={() => setConfirmOpen(true)}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Apply
            </Button>
            {disabledReason && <span className="text-[11px] text-amber-600">{disabledReason}</span>}
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Export
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportXlsx}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Download .xlsx
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyTsv}>
                  <ClipboardCopy className="mr-2 h-4 w-4" /> Copy as TSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px]">
                {onReqDocReadyAll && (
                  <>
                    <DropdownMenuItem
                      disabled={ids.length === 0 || !!disabledReason || reqDocRunning}
                      onSelect={(e) => {
                        e.preventDefault();
                        setReqDocRunning(true);
                        void onReqDocReadyAll(ids).finally(() => setReqDocRunning(false));
                      }}
                    >
                      {reqDocRunning ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCheck className="mr-2 h-4 w-4" />
                      )}
                      선택한 행의 필요 문서를 전부 받았음으로 ({ids.length})
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={delIds.length === 0 || !!disabledReason}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete permanently ({delIds.length})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClear}>
                  <X className="mr-2 h-4 w-4" /> Clear selection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <SplBulkConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        field={field}
        value={computedValue}
        rows={selectedRows}
        submitting={submitting}
        onConfirm={handleApply}
        totalCount={ids.length}
        chunkCount={Math.max(1, Math.ceil(ids.length / CHUNK))}
      />

      <SplBulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        ids={delIds}
        excluded={delExcluded}
        onDone={async () => {
          onClear();
          await onDone();
        }}
      />
    </>
  );
}
