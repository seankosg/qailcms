import { useMemo, useState } from "react";
import { todayInDoha } from "@/lib/time/doha";
import {
  ChevronDown,
  ClipboardCopy,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
  getBulkEditableFields,
  type BulkEditableField,
} from "@/lib/task-management/columns";
import { useTmColumnLabel } from "@/hooks/useTaskManagementFieldConfig";
import {
  applyBulkUpdate,
  copyRowsAsTsv,
  exportRowsToXlsx,
  type ExportColumn,
} from "@/lib/task-management/bulk-actions";
import { BulkConfirmDialog } from "./dialogs/BulkConfirmDialog";
import { BulkDeleteDialog } from "./dialogs/BulkDeleteDialog";

const BLANK = "__BLANK__";
const CHUNK = 500;

interface Props {
  selectedRows: Record<string, unknown>[];
  exportColumns: ExportColumn[];
  canEdit: boolean;
  onClear: () => void;
  onMutated: () => void;
}

export function BulkEditBar({
  selectedRows,
  exportColumns,
  canEdit,
  onClear,
  onMutated,
}: Props) {
  const fields = useMemo(() => getBulkEditableFields(), []);
  const resolveLabel = useTmColumnLabel();
  const displayFields = useMemo(
    () => fields.map((f) => ({ ...f, label: resolveLabel(f.field) })),
    [fields, resolveLabel],
  );
  const fieldGroups = useMemo(() => {
    const map = new Map<string, BulkEditableField[]>();
    for (const f of displayFields) {
      const arr = map.get(f.group) ?? [];
      arr.push(f);
      map.set(f.group, arr);
    }
    return Array.from(map.entries());
  }, [displayFields]);

  const [fieldName, setFieldName] = useState<string>("");
  const [rawValue, setRawValue] = useState<string>("");
  const [setBlank, setSetBlank] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const field = useMemo(
    () => displayFields.find((f) => f.field === fieldName) ?? null,
    [displayFields, fieldName],
  );

  const count = selectedRows.length;
  const ids = useMemo(
    () => selectedRows.map((r) => String(r.id ?? "")).filter(Boolean),
    [selectedRows],
  );

  if (count === 0) return null;

  const computedValue: string | number | boolean | null = (() => {
    if (setBlank) return null;
    if (!field) return null;
    if (field.inputType === "select" && rawValue === BLANK) return null;
    if (field.inputType === "number") {
      if (rawValue === "") return null;
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return null;
      if (field.isPercent) {
        const clamped = Math.max(0, Math.min(100, n));
        return Math.round((clamped / 100) * 10000) / 10000;
      }
      return n;
    }
    return rawValue === "" ? null : rawValue;
  })();

  const valueUnset = !setBlank && (rawValue === "" || rawValue == null);

  function reset() {
    setFieldName("");
    setRawValue("");
    setSetBlank(false);
  }

  async function handleApply() {
    if (!field) return;
    setSubmitting(true);
    try {
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) batches.push(ids.slice(i, i + CHUNK));
      let ok = 0;
      let failed = 0;
      for (let i = 0; i < batches.length; i++) {
        if (batches.length > 1) {
          toast.info(`Applying… (batch ${i + 1}/${batches.length})`);
        }
        // eslint-disable-next-line no-await-in-loop
        const r = await applyBulkUpdate({
          ids: batches[i],
          field: field.field,
          value: computedValue,
        });
        ok += r.succeeded;
        failed += r.failed;
      }
      toast.success(failed > 0 ? "부분 반영" : "저장 완료", {
        description: `${ok} updated${failed > 0 ? ` · ${failed} 실패` : ""}`,
      });
      setConfirmOpen(false);
      reset();
      onMutated();
    } catch (e: any) {
      toast.error("Bulk edit 실패", { description: e?.message ?? String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportXlsx() {
    try {
      const stamp = todayInDoha();
      exportRowsToXlsx({
        rows: selectedRows,
        columns: exportColumns,
        fileName: `task-management_selected_${stamp}.xlsx`,
      });
      toast.success("Export 완료", { description: `${count} rows exported.` });
    } catch (e: any) {
      toast.error("Export 실패", { description: e?.message ?? String(e) });
    }
  }

  async function handleCopyTsv() {
    try {
      const r = await copyRowsAsTsv({ rows: selectedRows, columns: exportColumns });
      toast.success("클립보드 복사 완료", {
        description: `${r.rowCount} rows × ${r.colCount} columns.`,
      });
    } catch (e: any) {
      toast.error("복사 실패", { description: e?.message ?? String(e) });
    }
  }

  return (
    <>
      <div className="rounded-md border border-l-2 border-l-primary bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 pr-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-sm font-semibold">{count} selected</span>
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              value={fieldName}
              onValueChange={(v) => {
                setFieldName(v);
                setRawValue("");
                setSetBlank(false);
              }}
            >
              <SelectTrigger className="h-8 w-[200px]">
                <SelectValue placeholder="Edit field…" />
              </SelectTrigger>
              <SelectContent className="max-h-[400px]">
                {fieldGroups.map(([group, list]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {list.map((f) => (
                      <SelectItem key={f.field} value={f.field} className="text-xs">
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {field && (
              <>
                {field.inputType === "select" && (
                  <Select
                    value={setBlank ? BLANK : rawValue}
                    onValueChange={(v) => {
                      setRawValue(v);
                      setSetBlank(v === BLANK);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue placeholder="New value…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={BLANK}>(Clear / Blank)</SelectItem>
                      {(field.options ?? []).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                {field.inputType === "number" && (
                  field.isPercent ? (
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        className="h-8 w-[160px] pr-6"
                        value={setBlank ? "" : rawValue}
                        disabled={setBlank}
                        onChange={(e) => setRawValue(e.target.value)}
                        placeholder="0 ~ 100"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-muted-foreground">
                        %
                      </span>
                    </div>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 w-[160px]"
                      value={setBlank ? "" : rawValue}
                      disabled={setBlank}
                      onChange={(e) => setRawValue(e.target.value)}
                      placeholder="0"
                    />
                  )
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

            <Button
              size="sm"
              className="h-8"
              disabled={!canEdit || !field || submitting || (valueUnset && !setBlank)}
              onClick={() => setConfirmOpen(true)}
            >
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Apply
            </Button>
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
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={!canEdit}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
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

      <BulkConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        field={field}
        value={computedValue}
        rows={selectedRows}
        submitting={submitting}
        onConfirm={handleApply}
        totalCount={count}
        chunkCount={Math.max(1, Math.ceil(count / CHUNK))}
      />

      <BulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        ids={ids}
        onDone={() => {
          onClear();
          onMutated();
        }}
      />
    </>
  );
}