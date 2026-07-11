import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  applyBulkUpdate,
  BULK_CHUNK_ROWS,
  chunkArray,
  getBulkEditableFields,
  type BulkEditableField,
} from "@/lib/spare-part/bulk-edit";
import {
  copyRowsAsTsv,
  exportSelectedToXlsx,
  type ExportColumn,
} from "@/lib/spare-part/bulk-actions";
import { BulkConfirmDialog } from "./dialogs/BulkConfirmDialog";
import { BulkDeleteDialog } from "./dialogs/BulkDeleteDialog";

const BLANK = "__BLANK__";

interface Props {
  selectedRows: Record<string, unknown>[];
  exportColumns: ExportColumn[];
  canEdit: boolean;
  onClear: () => void;
  onSaved: () => void;
  onMutated: () => void;
}

export function BulkEditBar({
  selectedRows,
  exportColumns,
  canEdit,
  onClear,
  onSaved,
  onMutated,
}: Props) {
  const fields = useMemo(() => getBulkEditableFields(), []);
  const fieldGroups = useMemo(() => {
    const map = new Map<string, BulkEditableField[]>();
    for (const f of fields) {
      const arr = map.get(f.group) ?? [];
      arr.push(f);
      map.set(f.group, arr);
    }
    return Array.from(map.entries());
  }, [fields]);

  const [fieldName, setFieldName] = useState<string>("");
  const [rawValue, setRawValue] = useState<string>("");
  const [boolValue, setBoolValue] = useState<string>("");
  const [setBlank, setSetBlank] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const field = useMemo(
    () => fields.find((f) => f.field === fieldName) ?? null,
    [fields, fieldName],
  );

  const count = selectedRows.length;
  const chunkCount = Math.max(1, Math.ceil(count / BULK_CHUNK_ROWS));
  const willChunk = count > BULK_CHUNK_ROWS;

  const docRefs = useMemo(
    () => selectedRows.map((r) => String(r.doc_ref ?? "")).filter(Boolean),
    [selectedRows],
  );

  if (count === 0) return null;

  const computedValue: string | number | boolean | null = (() => {
    if (setBlank) return null;
    if (!field) return null;
    if (field.inputType === "boolean") {
      if (boolValue === "true") return true;
      if (boolValue === "false") return false;
      return null;
    }
    if (field.inputType === "select" && rawValue === BLANK) return null;
    if (field.inputType === "number") {
      if (rawValue === "") return null;
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    return rawValue === "" ? null : rawValue;
  })();

  const valueUnset =
    !setBlank &&
    (field?.inputType === "boolean"
      ? boolValue === ""
      : rawValue === "" || rawValue == null);

  function reset() {
    setFieldName("");
    setRawValue("");
    setBoolValue("");
    setSetBlank(false);
  }

  async function handleApply() {
    if (!field) return;
    setSubmitting(true);
    try {
      const batches = chunkArray(docRefs, BULK_CHUNK_ROWS);
      let ok = 0;
      let failed = 0;
      for (let i = 0; i < batches.length; i++) {
        if (batches.length > 1) {
          toast.info(`Applying… (batch ${i + 1}/${batches.length})`, {
            description: `${ok} updated so far.`,
          });
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
      onSaved();
    } catch (e: any) {
      toast.error("Bulk edit 실패", { description: e?.message ?? String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExportXlsx() {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      exportSelectedToXlsx({
        rows: selectedRows,
        columns: exportColumns,
        fileName: `spare-part_selected_${stamp}.xlsx`,
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
      <div className="sticky top-0 z-30 rounded-md border border-l-2 border-l-primary bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 pr-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-sm font-semibold">{count} selected</span>
            {willChunk && (
              <span className="text-xs text-muted-foreground">
                · Will run in {chunkCount} batches of {BULK_CHUNK_ROWS}
              </span>
            )}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              value={fieldName}
              onValueChange={(v) => {
                setFieldName(v);
                setRawValue("");
                setBoolValue("");
                setSetBlank(false);
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
                    <SelectTrigger className="h-8 w-[180px]">
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

                {field.inputType === "boolean" && (
                  <Select
                    value={setBlank ? BLANK : boolValue}
                    onValueChange={(v) => {
                      setBoolValue(v);
                      setSetBlank(v === BLANK);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue placeholder="Yes / No" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                      <SelectItem value={BLANK}>(Clear / Blank)</SelectItem>
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
                  <Input
                    type="number"
                    className="h-8 w-[160px]"
                    value={setBlank ? "" : rawValue}
                    disabled={setBlank}
                    onChange={(e) => setRawValue(e.target.value)}
                    placeholder="0"
                  />
                )}

                {field.inputType === "text" && (
                  <Input
                    type="text"
                    className="h-8 w-[240px]"
                    value={setBlank ? "" : rawValue}
                    disabled={setBlank}
                    onChange={(e) => setRawValue(e.target.value)}
                    placeholder="New value…"
                  />
                )}

                {field.inputType === "textarea" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-[240px] justify-start truncate text-xs font-normal"
                        disabled={setBlank}
                      >
                        {setBlank ? "(Blank)" : rawValue || "New value…"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-2" align="start">
                      <Textarea
                        value={rawValue}
                        onChange={(e) => setRawValue(e.target.value)}
                        rows={5}
                        className="text-xs"
                        placeholder="New value…"
                      />
                    </PopoverContent>
                  </Popover>
                )}

                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={setBlank}
                    onCheckedChange={(c) => {
                      setSetBlank(!!c);
                      if (c) {
                        setRawValue("");
                        setBoolValue("");
                      }
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
        chunkCount={chunkCount}
      />

      <BulkDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        docRefs={docRefs}
        onDone={() => {
          onClear();
          onMutated();
        }}
      />
    </>
  );
}