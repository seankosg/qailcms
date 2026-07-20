import { useState, useEffect, useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useServerFn } from '@tanstack/react-start';
import { bulkUpdateDmrEntries } from '@/lib/dmr-mutations.functions';
import { useInvalidateDmr } from '@/hooks/useDmrEntries';
import type { DmrColumnDef } from '@/lib/dmr/columns';

interface Props {
  rowId: string;
  column: DmrColumnDef;
  value: any;
  canEdit: boolean;
  children: React.ReactNode;
}

export function DmrEditCellPopover({ rowId, column, value, canEdit, children }: Props) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const update = useServerFn(bulkUpdateDmrEntries);
  const invalidate = useInvalidateDmr();

  useEffect(() => { if (open) setVal(value == null ? '' : String(value)); }, [open, value]);

  if (!canEdit || !column.editable) return <>{children}</>;

  const commit = async () => {
    let parsed: any = val;
    if (column.editorType === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) { toast.error('0 이상 정수여야 합니다'); return; }
      parsed = Math.round(n);
    }
    setSaving(true);
    try {
      await update({ data: { ids: [rowId], patch: { [column.key]: parsed } } });
      toast.success('저장됨');
      invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error('저장 실패', { description: e?.message ?? String(e) });
    } finally { setSaving(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div ref={anchorRef} className="group flex h-full w-full cursor-pointer items-center gap-1">
          <span className="flex-1 truncate">{children}</span>
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 space-y-2" align="start">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{column.label}</div>
        {column.editorType === 'select' && column.enumOptions ? (
          <Select value={val} onValueChange={setVal}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{column.enumOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        ) : column.editorType === 'date' ? (
          <Input type="date" value={val} onChange={(e) => setVal(e.target.value)} className="h-8 text-xs" />
        ) : column.editorType === 'number' ? (
          <Input type="number" value={val} onChange={(e) => setVal(e.target.value)} className="h-8 text-xs" min={0} />
        ) : (
          <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-8 text-xs" />
        )}
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>취소</Button>
          <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={commit}>저장</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}