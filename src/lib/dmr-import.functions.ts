import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { normalizeDmrTeam, normalizeDmrContractor, isDmrDirectContractor } from './dmr/types';
import { normalizeDmrReportDate, assertNotFutureReportDate } from './dmr/report-date';
import { dmrPayloadFingerprint, totalActual } from './dmr/duplicate-guard';

const TeamSchema = z.preprocess((v) => normalizeDmrTeam(v), z.enum(['ARCH', 'ELEC', 'MECH']));

const EntrySchema = z.object({
  report_date: z.preprocess((v) => normalizeDmrReportDate(v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  discipline: TeamSchema,
  system_name: z.string().min(1),
  contractor_name: z.preprocess((v) => normalizeDmrContractor(v), z.string().min(1)),
  plot: z.enum(['C', 'D', 'TOTAL']),
  plan_manpower: z.coerce.number().int().min(0),
  actual_manpower: z.coerce.number().int().min(0),
  diff_manpower: z.coerce.number().int().optional(),
  source_image_path: z.string().optional().nullable(),
});

const InputSchema = z.object({
  entries: z.array(EntrySchema).min(1),
  systemMasters: z.array(z.object({ discipline: TeamSchema, name: z.string().min(1) })).default([]),
  contractorMasters: z
    .array(
      z.object({
        name: z.preprocess((v) => normalizeDmrContractor(v), z.string().min(1)),
        is_direct: z.boolean().default(false),
      }),
    )
    .default([]),
  overwrite: z.boolean().default(false),
  /** 다른 날짜와 완전히 같은 표임을 사용자가 확인한 경우에만 true */
  confirm_duplicate: z.boolean().default(false),
});

export const saveDmrEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // 미래 보고일 차단 (도하 기준). 날짜 오적재의 가장 흔한 신호다.
    for (const d of new Set(data.entries.map((e) => e.report_date))) {
      assertNotFutureReportDate(d);
    }

    // Upsert masters (best-effort, ignore duplicates)
    if (data.systemMasters.length > 0) {
      await supabase.from('dmr_system_master').upsert(
        data.systemMasters.map((m) => ({ discipline: m.discipline, name: m.name })),
        { onConflict: 'discipline,name', ignoreDuplicates: true },
      );
    }
    if (data.contractorMasters.length > 0) {
      await supabase.from('dmr_contractor_master').upsert(
        data.contractorMasters.map((c) => ({
          name: c.name,
          is_direct: c.is_direct || isDmrDirectContractor(c.name),
        })),
        { onConflict: 'name', ignoreDuplicates: true },
      );
    }

    const rows = data.entries.map((e) => ({
      report_date: e.report_date,
      discipline: e.discipline,
      system_name: e.system_name,
      contractor_name: e.contractor_name,
      plot: e.plot,
      plan_manpower: e.plan_manpower,
      actual_manpower: e.actual_manpower,
      source_image_path: e.source_image_path ?? null,
      created_by: context.userId,
    }));

    // 같은 표를 다른 날짜로 다시 넣는 사고 차단 (보고일·공종 조합별로 대조).
    if (!data.confirm_duplicate) {
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const k = `${r.report_date}\u0001${r.discipline}`;
        if (!groups.has(k)) groups.set(k, [] as any);
        groups.get(k)!.push(r);
      }
      for (const [k, grp] of groups) {
        const [reportDate, discipline] = k.split('\u0001');
        const fp = dmrPayloadFingerprint(grp as any);
        const from = new Date(new Date(`${reportDate}T00:00:00Z`).getTime() - 45 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const { data: near } = await supabase
          .from('dmr_entries')
          .select('report_date, system_name, contractor_name, plot, actual_manpower')
          .eq('discipline', discipline)
          .neq('report_date', reportDate)
          .gte('report_date', from)
          .lte('report_date', reportDate);
        const byDate = new Map<string, any[]>();
        for (const r of near ?? []) {
          const d = String(r.report_date);
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d)!.push(r);
        }
        for (const [d, prev] of byDate) {
          if (dmrPayloadFingerprint(prev) === fp) {
            throw new Error(
              `중복 의심(${discipline}): ${d} 자료와 행 구성·인원(총 ${totalActual(prev)}명)이 완전히 같습니다. ` +
                `보고일(${reportDate})이 맞는지 확인해 주세요.`,
            );
          }
        }
      }
    }

    // Upsert on the unique key
    const { error, count } = await supabase
      .from('dmr_entries')
      .upsert(rows, {
        onConflict: 'report_date,discipline,system_name,contractor_name,plot',
        count: 'exact',
        ignoreDuplicates: !data.overwrite,
      });

    if (error) throw new Error(error.message);

    return { inserted: count ?? rows.length, total: rows.length };
  });

export const listDmrMasters = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: systems }, { data: contractors }] = await Promise.all([
      context.supabase.from('dmr_system_master').select('id, discipline, name, is_active').order('discipline').order('name'),
      context.supabase.from('dmr_contractor_master').select('id, name, is_direct, is_active').order('name'),
    ]);
    return { systems: systems ?? [], contractors: contractors ?? [] };
  });