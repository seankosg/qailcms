import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { normalizeDmrTeam, normalizeDmrContractor, isDmrDirectContractor } from './dmr/types';

const TeamSchema = z.preprocess((v) => normalizeDmrTeam(v), z.enum(['ARCH', 'ELEC', 'MECH']));

const EntrySchema = z.object({
  report_date: z.string(),
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
});

export const saveDmrEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

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