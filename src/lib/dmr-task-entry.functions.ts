import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

/**
 * 출면기록부 저장 경로 (2단계).
 *
 * TM 값은 저장 시점에 박는다. 참조로 두지 않는다.
 * tm_rows_as_of(report_date) 를 한 번만 부르고, 그 결과만이 유일한 근거다.
 * 클라이언트 계산 금지 · 읽을 때 재계산 금지 · 증분 저장 금지.
 */
const EntrySchema = z.object({
  system_name: z.string().min(1),
  contractor_name: z.string().min(1),
  plot: z.enum(['C', 'D']),
  plan_manpower: z.number().int().min(0).default(0),
  actual_manpower: z.number().int().min(0).default(0),
  task_no: z.string().trim().min(1).nullable().optional(),
  headcount_kind: z.enum(['worker', 'foreman', 'supervisor']).default('worker'),
  pic_name: z.string().trim().nullable().optional(),
});

const InputSchema = z.object({
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discipline: z.enum(['ARCH', 'ELEC', 'MECH']),
  entries: z.array(EntrySchema).min(1).max(2000),
});

export const saveDmrTaskEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;

    const roles = await Promise.all(
      ['admin', 'superuser', 'd_superuser', 'senior_user'].map((r) =>
        sb.rpc('has_role', { _user_id: context.userId, _role: r }),
      ),
    );
    if (!roles.some((r: any) => r.data === true)) {
      throw new Error('권한 없음: senior_user 이상만 편집할 수 있습니다');
    }

    const taskNos = [
      ...new Set(
        data.entries
          .map((e) => (e.task_no ?? '').trim())
          .filter((s) => s.length > 0),
      ),
    ];

    // TM 정본 1회 조회 (기준일 = report_date)
    const snapshot = new Map<string, any>();
    if (taskNos.length > 0) {
      const { data: tmRows, error: tmErr } = await sb
        .rpc('tm_rows_as_of', { _as_of: data.report_date })
        .in('task_no', taskNos);
      if (tmErr) throw new Error(`TM 정본 조회 실패: ${tmErr.message}`);
      for (const r of tmRows ?? []) snapshot.set(String(r.task_no), r);
    }

    const snapshotAt = new Date().toISOString();
    const missing: string[] = [];

    const payload = data.entries.map((e) => {
      const taskNo = (e.task_no ?? '').trim() || null;
      const tm = taskNo ? snapshot.get(taskNo) : null;
      if (taskNo && !tm) missing.push(taskNo);
      return {
        report_date: data.report_date,
        discipline: data.discipline,
        system_name: e.system_name.trim(),
        contractor_name: e.contractor_name.trim(),
        plot: e.plot,
        plan_manpower: e.plan_manpower,
        actual_manpower: e.actual_manpower,
        task_no: taskNo,
        headcount_kind: e.headcount_kind,
        pic_name: e.pic_name?.trim() || null,
        task_level: tm ? (tm.level ?? null) : null,
        task_name: tm ? (tm.task_name ?? null) : null,
        work_category: tm ? (tm.row_type ?? null) : null,
        tplan_pct: tm ? (tm.cum_plan_pct ?? null) : null,
        tactual_pct: tm ? (tm.cum_actual_pct ?? null) : null,
        task_actual_start: tm ? (tm.actual_start ?? null) : null,
        task_data_date: tm ? (tm.data_date ?? null) : null,
        snapshot_at: taskNo ? snapshotAt : null,
        created_by: context.userId,
      };
    });

    const { data: saved, error } = await sb
      .from('dmr_entries')
      .upsert(payload, {
        onConflict:
          'report_date,discipline,system_name,contractor_name,plot,task_no,headcount_kind',
      })
      .select('id');
    if (error) throw new Error(error.message);

    return {
      ok: true,
      saved: saved?.length ?? payload.length,
      snapshot_at: snapshotAt,
      linked_tasks: snapshot.size,
      missing_task_nos: [...new Set(missing)],
    };
  });