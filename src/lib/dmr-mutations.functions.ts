import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { normalizeDmrTeam } from './dmr/types';

const ALLOWED_FIELDS = new Set<string>([
  'report_date',
  'discipline',
  'system_name',
  'contractor_name',
  'plot',
  'plan_manpower',
  'actual_manpower',
]);

const PLOT_VALS = new Set(['C', 'D', 'TOTAL']);

async function assertCanEdit(ctx: any) {
  const checks = await Promise.all([
    ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'admin' }),
    ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'superuser' }),
    ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'd_superuser' }),
    ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'senior_user' }),
  ]);
  if (!checks.some((r) => r.data === true)) {
    throw new Error('권한 없음: senior_user 이상만 편집할 수 있습니다');
  }
}

function validatePatchValue(field: string, value: unknown): unknown {
  if (field === 'discipline') {
    return normalizeDmrTeam(value);
  }
  if (field === 'plot' && !PLOT_VALS.has(String(value))) {
    throw new Error(`잘못된 Plot 값: ${value}`);
  }
  if (field === 'plan_manpower' || field === 'actual_manpower') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('인원은 0 이상 정수여야 합니다');
    return Math.round(n);
  }
  if (field === 'report_date') {
    const s = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('잘못된 날짜 형식');
    return s;
  }
  if (field === 'system_name' || field === 'contractor_name') {
    const s = String(value ?? '').trim();
    if (!s) throw new Error(`${field} 은(는) 비워둘 수 없습니다`);
    return s;
  }
  return value;
}

const BulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  patch: z.record(z.string(), z.any()),
});

export const bulkUpdateDmrEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkUpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEdit(context);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (!ALLOWED_FIELDS.has(k)) continue;
      patch[k] = validatePatchValue(k, v);
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('허용된 편집 필드가 없습니다');
    }

    // system_name / contractor_name 변경 시 마스터 자동 upsert
    if (patch.system_name) {
      await (context.supabase as any)
        .from('dmr_system_master')
        .upsert({ name: patch.system_name }, { onConflict: 'name' });
    }
    if (patch.contractor_name) {
      const name = String(patch.contractor_name);
      const isDirect = name.toUpperCase().startsWith('HDEC');
      await (context.supabase as any)
        .from('dmr_contractor_master')
        .upsert({ name, is_direct: isDirect }, { onConflict: 'name' });
    }

    const { error, count } = await (context.supabase as any)
      .from('dmr_entries')
      .update({ ...patch, updated_at: new Date().toISOString() }, { count: 'exact' })
      .in('id', data.ids)
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return { ok: true, count: count ?? data.ids.length, fields: Object.keys(patch) };
  });

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  // 화면 스코프 가드 — Raw Data(import: task_no NULL) / Raw Data 2(entry: task_no NOT NULL)
  scope: z.enum(['import', 'entry', 'all']).optional().default('all'),
});

export const bulkDeleteDmrEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BulkDeleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanEdit(context);
    let dq = (context.supabase as any)
      .from('dmr_entries')
      .delete({ count: 'exact' })
      .in('id', data.ids);
    if (data.scope === 'import') dq = dq.is('task_no', null);
    else if (data.scope === 'entry') dq = dq.not('task_no', 'is', null);
    const { error, count } = await dq;
    if (error) throw new Error(error.message);
    return { ok: true, count: count ?? data.ids.length };
  });

// 필터 조건에 매칭되는 전체 id 조회 (필터된 전체 선택용)
const FilterIdsSchema = z.object({
  discipline: z.string().optional().nullable(),
  plot: z.string().optional().nullable(),
  systems: z.array(z.string()).optional().default([]),
  contractors: z.array(z.string()).optional().default([]),
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable(),
  q: z.string().optional().nullable(),
  directOnly: z.array(z.enum(['direct', 'sub'])).optional().default([]),
  scope: z.enum(['import', 'entry', 'all']).optional().default('all'),
});

export const fetchDmrFilteredIds = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => FilterIdsSchema.parse(data))
  .handler(async ({ data, context }) => {
    let sq = (context.supabase as any).from('dmr_entries').select('id').limit(10000);
    if (data.scope === 'import') sq = sq.is('task_no', null);
    else if (data.scope === 'entry') sq = sq.not('task_no', 'is', null);
    if (data.discipline && data.discipline !== 'all') sq = sq.eq('discipline', data.discipline);
    if (data.plot && data.plot !== 'all') sq = sq.eq('plot', data.plot);
    if (data.systems.length) sq = sq.in('system_name', data.systems);
    if (data.contractors.length) sq = sq.in('contractor_name', data.contractors);
    if (data.fromDate) sq = sq.gte('report_date', data.fromDate);
    if (data.toDate) sq = sq.lte('report_date', data.toDate);
    if (data.q?.trim()) {
      const t = data.q.trim();
      sq = sq.or(`system_name.ilike.%${t}%,contractor_name.ilike.%${t}%`);
    }
    const { data: rows, error } = await sq;
    if (error) throw new Error(error.message);
    return { ids: (rows ?? []).map((r: any) => r.id as string) };
  });