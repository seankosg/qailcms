import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  ChevronDown,
  ClipboardCopy,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { bulkUpdateDmrEntries, bulkDeleteDmrEntries } from '@/lib/dmr-mutations.functions';
import { copyDmrAsTsv, exportDmrToXlsx, DMR_EXPORT_COLUMNS } from '@/lib/dmr/bulk-actions';
import { DMR_DISCIPLINES, DMR_PLOTS } from '@/lib/dmr/types';

const CHUNK = 500;

type FieldDef = {
  field: 'report_date' | 'discipline' | 'system_name' | 'contractor_name' | 'plot' | 'plan_manpower' | 'actual_manpower';
  label: string;
  input: 'date' | 'select' | 'text' | 'number';
  options?: string[];
};

const FIELDS: FieldDef[] = [
  { field: 'report_date', label: 'Date', input: 'date' },
  { field: 'discipline', label: 'TEAM', input: 'select', options: [...DMR_DISCIPLINES] },
  { field: 'system_name', label: 'Work Description', input: 'text' },
  { field: 'contractor_name', label: 'Sub Contractor', input: 'text' },
  { field: 'plot', label: 'Plot', input: 'select', options: [...DMR_PLOTS] },
  { field: 'plan_manpower', label: 'Plan (계획)', input: 'number' },
  { field: 'actual_manpower', label: 'Actual (실적)', input: 'number' },
];

interface Props {
  selectedIds: string[];
  sampleRows: Record<string, any>[];
  canEdit: boolean;
  onClearSelection: () => void;
  onApplied: () => void;
}

export function DmrBulkEditBar({ selectedIds, sampleRows, canEdit, onClearSelection, onApplied }: Props) {
  const [fieldName, setFieldName] = useState<string>('');
  const [rawValue, setRawValue] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const ids = useMemo(() => selectedIds.filter(Boolean), [selectedIds]);
  const count = ids.length;
  const field = useMemo(() => FIELDS.find((f) => f.field === fieldName) ?? null, [fieldName]);
  const chunkCount = Math.max(1, Math.ceil(count / CHUNK));

  if (count === 0) return null;

  const computedValue: string | number | null = (() => {
    if (!field) return null;
    if (rawValue === '') return null;
    if (field.input === 'number') {
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : null;
    }
    return rawValue;
  })();
  const valueUnset = rawValue === '' || rawValue == null;

  function reset() {
    setFieldName('');
    setRawValue('');
  }

  const apply = async () => {
    if (!field || computedValue == null) return;
    setSubmitting(true);
    try {
      let updated = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (ids.length > CHUNK) toast.info(`적용 중… (${Math.floor(i / CHUNK) + 1}/${chunkCount})`);
        const res = await bulkUpdateDmrEntries({
          data: { ids: slice, patch: { [field.field]: computedValue } },
        });
        updated += res?.count ?? slice.length;
      }
      toast.success('일괄 수정 완료', { description: `${updated}건 업데이트` });
      setConfirmOpen(false);
      reset();
      onApplied();
    } catch (e: any) {
      toast.error('일괄 수정 실패', { description: e?.message ?? String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  function handleExportXlsx() {
    try {
      const { todayInDoha } = await import("@/lib/time/doha");
      const stamp = todayInDoha();
      exportDmrToXlsx({
        rows: sampleRows,
        columns: DMR_EXPORT_COLUMNS,
        fileName: `dmr-selected-${stamp}.xlsx`,
      });
      toast.success('엑셀 다운로드', { description: `${sampleRows.length}건 내보내기 완료 (현재 페이지)` });
    } catch (e: any) {
      toast.error('내보내기 실패', { description: e?.message ?? String(e) });
    }
  }

  async function handleCopyTsv() {
    try {
      const r = await copyDmrAsTsv({ rows: sampleRows, columns: DMR_EXPORT_COLUMNS });
      toast.success('클립보드 복사', { description: `${r.rowCount}행 × ${r.colCount}열` });
    } catch (e: any) {
      toast.error('복사 실패', { description: e?.message ?? String(e) });
    }
  }

  async function handleDelete() {
    if (deleteText !== 'DELETE') return;
    setDeleting(true);
    let done = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        if (ids.length > CHUNK) toast.info(`삭제 중… (${Math.floor(i / CHUNK) + 1}/${chunkCount})`);
        const res = await bulkDeleteDmrEntries({ data: { ids: slice } });
        done += res?.count ?? slice.length;
      }
      toast.success('영구 삭제 완료', { description: `${done}건 삭제` });
      setDeleteOpen(false);
      setDeleteText('');
      onApplied();
    } catch (e: any) {
      toast.error('삭제 실패', { description: e?.message ?? String(e) });
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
            <span className="text-sm font-semibold">{count.toLocaleString()}건 선택</span>
            {count > CHUNK && (
              <span className="text-xs text-muted-foreground">
                · {chunkCount} 배치 (배치당 {CHUNK}건)
              </span>
            )}
            {sampleRows.length < count && (
              <span className="text-xs text-muted-foreground">
                · 현재 페이지 미리보기 {sampleRows.length}건
              </span>
            )}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Select
              value={fieldName}
              onValueChange={(v) => {
                setFieldName(v);
                setRawValue('');
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="수정할 필드…" />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f.field} value={f.field} className="text-xs">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {field && field.input === 'select' && (
              <Select value={rawValue} onValueChange={setRawValue}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="새 값…" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((o) => (
                    <SelectItem key={o} value={o} className="text-xs">
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {field && field.input === 'date' && (
              <Input
                type="date"
                className="h-8 w-[160px] text-xs"
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
              />
            )}
            {field && field.input === 'number' && (
              <Input
                type="number"
                min={0}
                step={1}
                className="h-8 w-[120px] text-xs"
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder="0"
              />
            )}
            {field && field.input === 'text' && (
              <Input
                type="text"
                className="h-8 w-[220px] text-xs"
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder="새 값…"
              />
            )}

            <Button
              size="sm"
              className="h-8"
              disabled={!canEdit || !field || submitting || valueUnset}
              onClick={() => setConfirmOpen(true)}
              title={!canEdit ? '권한 없음' : undefined}
            >
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              적용
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8">
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  내보내기
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportXlsx}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> .xlsx 다운로드
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyTsv}>
                  <ClipboardCopy className="mr-2 h-4 w-4" /> TSV 복사
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownMenuItem
                  disabled={!canEdit}
                  onClick={() => setDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> 선택 항목 영구삭제
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClearSelection}>
                  <X className="mr-2 h-4 w-4" /> 선택 해제
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>일괄 수정 확인</DialogTitle>
            <DialogDescription>
              {count.toLocaleString()}개 행의 <code>{field?.label}</code> 값을{' '}
              <strong>{String(computedValue ?? '—')}</strong>로 변경합니다.
              {count > CHUNK && ` (${chunkCount} 배치)`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded border text-xs">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Date</th>
                  <th className="px-2 py-1 text-left">Work Description</th>
                  <th className="px-2 py-1 text-left">이전</th>
                  <th className="px-2 py-1 text-left">이후</th>
                </tr>
              </thead>
              <tbody>
                {sampleRows.slice(0, 5).map((r, i) => (
                  <tr key={String(r.id ?? i)} className="border-t">
                    <td className="px-2 py-1">{String(r.report_date ?? '')}</td>
                    <td className="px-2 py-1">{String(r.system_name ?? '')}</td>
                    <td className="px-2 py-1">{field ? String(r[field.field] ?? '') : ''}</td>
                    <td className="px-2 py-1 font-medium">{String(computedValue ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {count > sampleRows.slice(0, 5).length && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                …외 {(count - Math.min(sampleRows.length, 5)).toLocaleString()}건 (총 {count.toLocaleString()}건 적용)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button onClick={apply} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setDeleteText('');
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              선택한 {count.toLocaleString()}건을 영구 삭제하시겠습니까?
            </DialogTitle>
            <DialogDescription>
              이 작업은 <strong>되돌릴 수 없습니다</strong>.
              {count > CHUNK && ` · ${chunkCount} 배치로 실행됩니다.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              확인을 위해 <code className="rounded bg-muted px-1">DELETE</code> 를 입력하세요.
            </p>
            <Input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE"
              className="h-8"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteText !== 'DELETE'}
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