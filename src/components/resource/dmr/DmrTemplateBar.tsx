import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BookmarkPlus, FolderOpen, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { newEntryRow, type EntryRow, type DmrDiscipline } from './entry-types';

/** Template 종류는 항상 이 4개만 유지한다. 같은 종류로 저장하면 덮어쓴다. */
export const TEMPLATE_SCOPES = ['ALL', 'ARCH', 'ELEC', 'MECH'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

interface TemplateRow {
  scope: TemplateScope;
  rows: any[];
  row_count: number;
  updated_at: string;
  updated_by_name: string | null;
}

/** 저장할 때 화면 상태(저장 여부·파싱 표식)는 버린다. 입력 내용과 코드만 남긴다. */
function toTemplateRows(rows: EntryRow[]): any[] {
  return rows.map((r, i) => ({
    discipline: r.discipline,
    task_no: r.task_no ?? '',
    task_name: r.task_name ?? '',
    system_name: r.system_name ?? '',
    contractor_name: r.contractor_name ?? '',
    plot: r.plot ?? 'C',
    pic_name: r.pic_name ?? '',
    manpower: r.manpower ?? '0',
    importIndex: i,
  }));
}

function fromTemplateRows(rows: any[]): EntryRow[] {
  return rows.map((r, i) =>
    newEntryRow({
      discipline: (['ARCH', 'ELEC', 'MECH'].includes(String(r.discipline)) ? r.discipline : 'ARCH') as DmrDiscipline,
      task_no: String(r.task_no ?? ''),
      task_name: r.task_name ? String(r.task_name) : undefined,
      system_name: String(r.system_name ?? ''),
      contractor_name: String(r.contractor_name ?? ''),
      plot: r.plot === 'D' ? 'D' : 'C',
      pic_name: String(r.pic_name ?? ''),
      manpower: String(r.manpower ?? '0'),
      importIndex: typeof r.importIndex === 'number' ? r.importIndex : i,
    }),
  );
}

export interface DmrTemplateBarProps {
  rows: EntryRow[];
  canEdit: boolean;
  /** 불러온 행으로 표를 바꾼다 */
  onLoad: (rows: EntryRow[]) => void;
}

export function DmrTemplateBar({ rows, canEdit, onLoad }: DmrTemplateBarProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const listQ = useQuery({
    queryKey: ['dmr-entry-templates'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('dmr_entry_templates')
        .select('scope, rows, row_count, updated_at, updated_by_name');
      if (error) throw new Error(error.message);
      return (data ?? []) as TemplateRow[];
    },
    staleTime: 30_000,
  });

  const byScope = new Map<string, TemplateRow>((listQ.data ?? []).map((t) => [t.scope, t]));

  async function save(scope: TemplateScope) {
    const target = scope === 'ALL' ? rows : rows.filter((r) => r.discipline === scope);
    if (target.length === 0) {
      toast.error(`${scope} 에 해당하는 행이 없습니다`);
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      let name: string | null = null;
      if (uid) {
        const { data: p } = await supabase.from('profiles').select('name').eq('id', uid).maybeSingle();
        name = (p as any)?.name ?? null;
      }
      const payload = toTemplateRows(target);
      const { error } = await (supabase as any)
        .from('dmr_entry_templates')
        .upsert(
          { scope, rows: payload, row_count: payload.length, updated_by: uid, updated_by_name: name, updated_at: new Date().toISOString() },
          { onConflict: 'scope' },
        );
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ['dmr-entry-templates'] });
      toast.success(`Template ${scope} 저장 완료 (${payload.length}행 · 덮어쓰기)`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Template 저장 실패');
    } finally {
      setBusy(false);
    }
  }

  function load(scope: TemplateScope) {
    const t = byScope.get(scope);
    if (!t || !Array.isArray(t.rows) || t.rows.length === 0) {
      toast.error(`Template ${scope} 이(가) 비어 있습니다`);
      return;
    }
    onLoad(fromTemplateRows(t.rows));
    toast.success(`Template ${scope} 불러오기 (${t.rows.length}행) — 저장해야 확정됩니다`);
  }

  const stamp = (s: TemplateScope) => {
    const t = byScope.get(s);
    if (!t) return '없음';
    return `${t.row_count}행 · ${String(t.updated_at).slice(0, 10)}${t.updated_by_name ? ` · ${t.updated_by_name}` : ''}`;
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={!canEdit || busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
            Template 저장
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">현재 표를 덮어쓰기 저장</DropdownMenuLabel>
          {TEMPLATE_SCOPES.map((s) => (
            <DropdownMenuItem key={s} className="text-xs" onSelect={() => void save(s)}>
              <span className="font-medium">{s}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{stamp(s)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 text-xs">
            <FolderOpen className="h-3.5 w-3.5" />
            Template 불러오기
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">
            {listQ.isFetching ? '불러오는 중…' : '저장된 Template'}
          </DropdownMenuLabel>
          {TEMPLATE_SCOPES.map((s) => (
            <DropdownMenuItem
              key={s}
              className="text-xs"
              disabled={!byScope.get(s)?.row_count}
              onSelect={() => load(s)}
            >
              <span className="font-medium">{s}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{stamp(s)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
