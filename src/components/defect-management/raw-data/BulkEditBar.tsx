import { useMemo, useState } from "react";
import { todayInDoha } from "@/lib/time/doha";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bulkUpdateDefects, bulkDeleteDefects } from "@/lib/defect-management/mutations.functions";
import { type DefectColumnDef } from "@/lib/defect-management/columns";
import { copyRowsAsTsv, exportSelectedToXlsx, type ExportColumn } from "@/lib/defect-management/bulk-actions";
import { toast } from "sonner";
import { ChevronDown, ClipboardCopy, FileSpreadsheet, Loader2, MoreHorizontal, Trash2, X } from "lucide-react";

interface Props {
  selectedRows: Record<string, any>[];
  fields: Array<{
    field: string;
    label: string;
    inputType: NonNullable<DefectColumnDef["editorType"]>;
    options?: { value: string; label: string }[];
    group: string;
    coerce?: "boolean";
  }>;
  exportColumns: ExportColumn[];
  canEdit: boolean;
  onClearSelection: () => void;
  onApplied: () => void;
}

const BLANK = "__BLANK__";
const CHUNK = 500;

export function BulkEditBar({ selectedRows, fields, exportColumns, canEdit, onClearSelection, onApplied }: Props) {
  const [fieldName, setFieldName] = useState<string>("");
  const [rawValue, setRawValue] = useState<string>("");
  const [setBlank, setSetBlank] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const count = selectedRows.length;
  const ids = useMemo(() => selectedRows.map((row) => String(row.id ?? "")).filter(Boolean), [selectedRows]);
  const fieldGroups = useMemo(() => {
    const map = new Map<string, typeof fields>();
    for (const field of fields) {
      const key = field.group || "Other";
      const list = map.get(key) ?? [];
      list.push(field);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [fields]);
  const field = useMemo(() => fields.find((f) => f.field === fieldName) ?? null, [fields, fieldName]);
  const chunkCount = Math.max(1, Math.ceil(count / CHUNK));

  if (count === 0) return null;

  const computedValue: string | number | boolean | null = (() => {
    if (setBlank) return null;
    if (!field) return null;
    if (field.inputType === "select" && rawValue === BLANK) return null;
    if (field.coerce === "boolean") {
      if (rawValue === "") return null;
      return rawValue === "true";
    }
    if (field.inputType === "number") {
      if (rawValue === "") return null;
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    return rawValue === "" ? null : rawValue;
  })();
  const valueUnset = !setBlank && (rawValue === "" || rawValue == null);

  function reset() {
    setFieldName("");
    setRawValue("");
    setSetBlank(false);
  }

  const apply = async () => {
    if (!field) return;
    setSubmitting(true);
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (ids.length > CHUNK) toast.info(`Applying… (batch ${Math.floor(i / CHUNK) + 1}/${chunkCount})`);
        // eslint-disable-next-line no-await-in-loop
        await bulkUpdateDefects({ data: { ids: slice, patch: { [field.field]: computedValue } } });
      }
      toast.success("Bulk edit applied", { description: `${count} updated.` });
      setConfirmOpen(false);
      reset();
      onApplied();
    } catch (e: any) {
      toast.error("Bulk edit failed", { description: e?.message ?? String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  function handleExportXlsx() {
    try {
      const stamp = todayInDoha();
      exportSelectedToXlsx({ rows: selectedRows, columns: exportColumns, fileName: `CMS_SM_selected_${stamp}.xlsx` });
      toast.success("Export ready", { description: `${count} rows exported.` });
    } catch (e: any) {
      toast.error("Export failed", { description: e?.message ?? String(e) });
    }
  }

  async function handleCopyTsv() {
    try {
      const result = await copyRowsAsTsv({ rows: selectedRows, columns: exportColumns });
      toast.success("Copied to clipboard", { description: `${result.rowCount} rows × ${result.colCount} columns.` });
    } catch (e: any) {
      toast.error("Copy failed", { description: e?.message ?? String(e) });
    }
  };

  async function handleDelete() {
    if (deleteConfirmText !== "DELETE") return;
    setDeleting(true);
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (ids.length > CHUNK) toast.info(`Deleting… (batch ${Math.floor(i / CHUNK) + 1}/${chunkCount})`);
        // eslint-disable-next-line no-await-in-loop
        const res = await bulkDeleteDefects({ data: { ids: slice } });
        done += res?.count ?? slice.length;
      }
      toast.success("영구 삭제 완료", { description: `${done}건이 삭제되었습니다.` });
      setDeleteOpen(false);
      setDeleteConfirmText("");
      onApplied();
    } catch (e: any) {
      toast.error("삭제 실패", { description: e?.message ?? String(e) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="sticky top-0 z-30 rounded-lg border border-l-2 border-l-primary bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 pr-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-sm font-semibold">{count} selected</span>
            {count > CHUNK && <span className="text-xs text-muted-foreground">· Will run in {chunkCount} batches of {CHUNK}</span>}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              value={fieldName}
              onValueChange={(value) => {
                setFieldName(value);
                setRawValue("");
                setSetBlank(false);
              }}
            >
              <SelectTrigger className="h-8 w-[220px]"><SelectValue placeholder="Edit field…" /></SelectTrigger>
              <SelectContent className="max-h-[400px]">
                {fieldGroups.map(([group, list]) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {list.map((f) => <SelectItem key={f.field} value={f.field} className="text-xs">{f.label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {field && (
            <>
              {field.inputType === "select" && (
                <Select value={setBlank ? BLANK : rawValue} onValueChange={(value) => { setRawValue(value); setSetBlank(value === BLANK); }}>
                  <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="New value…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={BLANK}>(Clear / Blank)</SelectItem>
                    {(field.options ?? []).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {field.inputType === "date" && <Input type="date" className="h-8 w-[160px]" value={setBlank ? "" : rawValue} disabled={setBlank} onChange={(e) => setRawValue(e.target.value)} />}
              {field.inputType === "number" && <Input type="number" className="h-8 w-[160px]" value={setBlank ? "" : rawValue} disabled={setBlank} onChange={(e) => setRawValue(e.target.value)} placeholder="0" />}
              {field.inputType === "text" && (
                <TextValueCombobox
                  value={setBlank ? "" : rawValue}
                  disabled={setBlank}
                  options={(field.options ?? []).map((o) => o.value)}
                  onChange={setRawValue}
                />
              )}
              {field.inputType === "textarea" && (
                <Popover>
                  <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-8 w-[240px] justify-start truncate text-xs font-normal" disabled={setBlank}>{setBlank ? "(Blank)" : rawValue || "New value…"}</Button></PopoverTrigger>
                  <PopoverContent className="w-96 p-2" align="start"><Textarea value={rawValue} onChange={(e) => setRawValue(e.target.value)} rows={5} className="text-xs" placeholder="New value…" /></PopoverContent>
                </Popover>
              )}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={setBlank} onCheckedChange={(checked) => { setSetBlank(!!checked); if (checked) setRawValue(""); }} />
                Blank
              </label>
            </>
            )}

            <Button size="sm" className="h-8" disabled={!canEdit || !field || submitting || (valueUnset && !setBlank)} onClick={() => setConfirmOpen(true)}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Apply
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8"><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Export <ChevronDown className="ml-1 h-3 w-3" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportXlsx}><FileSpreadsheet className="mr-2 h-4 w-4" /> Download .xlsx</DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyTsv}><ClipboardCopy className="mr-2 h-4 w-4" /> Copy as TSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-8 px-2"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownMenuItem
                  disabled={!canEdit}
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> 선택 항목 영구삭제
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClearSelection}><X className="mr-2 h-4 w-4" /> Clear selection</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Edit 확인</DialogTitle>
            <DialogDescription>{count}개 행의 <code>{field?.label}</code> 값을 <strong>{formatValue(computedValue)}</strong>로 변경합니다. ({chunkCount} batch)</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded border text-xs">
            <table className="w-full">
              <thead className="bg-muted"><tr><th className="px-2 py-1 text-left">Issue No</th><th className="px-2 py-1 text-left">Before</th><th className="px-2 py-1 text-left">After</th></tr></thead>
              <tbody>
                {selectedRows.slice(0, 5).map((row, index) => (
                  <tr key={String(row.id ?? index)} className="border-t">
                    <td className="px-2 py-1 font-mono">{formatValue(row.source_issue_no)}</td>
                    <td className="px-2 py-1">{formatValue(field ? row[field.field] : "")}</td>
                    <td className="px-2 py-1 font-medium">{formatValue(computedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {count > 5 && <p className="px-2 py-1 text-[11px] text-muted-foreground">…외 {count - 5}개</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>취소</Button>
            <Button onClick={apply} disabled={submitting}>{submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteConfirmText(""); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">선택한 {count}건을 영구 삭제하시겠습니까?</DialogTitle>
            <DialogDescription>
              이 작업은 <strong>되돌릴 수 없습니다</strong>. 삭제된 데이터는 복구할 수 없으며, 관련 상태 이력도 함께 제거됩니다.
              {count > CHUNK && <> · {chunkCount} batch 로 실행됩니다.</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">확인을 위해 <code className="rounded bg-muted px-1">DELETE</code> 를 입력하세요.</p>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-8"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>취소</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText !== "DELETE"}
            >
              {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              <Trash2 className="mr-1 h-3.5 w-3.5" /> 영구 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** 텍스트 필드: 기존 값 목록에서 선택 + 자유 입력 동시 지원 */
function TextValueCombobox({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const uniq = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of options) {
      const s = (o ?? "").toString().trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [options]);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? uniq.filter((o) => o.toLowerCase().includes(q)) : uniq;
    return list.slice(0, 200);
  }, [uniq, value]);

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-[240px]">
          <Input
            type="text"
            className="h-8 pr-7"
            value={value}
            disabled={disabled}
            placeholder="New value… (기존값 선택/직접입력)"
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          <ChevronDown
            className="absolute right-2 top-2 h-4 w-4 cursor-pointer text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {uniq.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">기존 값이 없습니다. 직접 입력하세요.</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">일치하는 기존 값 없음 — 입력값이 그대로 사용됩니다.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((o) => (
              <button
                key={o}
                type="button"
                className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}