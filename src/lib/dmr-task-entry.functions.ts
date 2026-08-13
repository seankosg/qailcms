import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { normalizeDmrReportDate, assertNotFutureReportDate } from './dmr/report-date';
import { dmrPayloadFingerprint, totalActual } from './dmr/duplicate-guard';

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
  /** 사용자가 직접 적은 Task/Subtask — 있으면 TM 명칭 대신 이 값을 저장한다 */
  task_name: z.string().trim().min(1).nullable().optional(),
  /** 사용자가 직접 적은 Work Type — TM 코드 없는 행에서만 사용 */
  work_type: z.string().trim().min(1).nullable().optional(),
  headcount_kind: z.enum(['worker', 'foreman', 'supervisor']).default('worker'),
  pic_name: z.string().trim().nullable().optional(),
});

const InputSchema = z.object({
  report_date: z.preprocess((v) => normalizeDmrReportDate(v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  discipline: z.enum(['ARCH', 'ELEC', 'MECH']),
  entries: z.array(EntrySchema).min(1).max(2000),
  /** 다른 날짜와 완전히 같은 표임을 사용자가 확인한 경우에만 true */
  confirm_duplicate: z.boolean().default(false),
});

export const saveDmrTaskEntries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;

    // 미래 날짜는 저장하지 않는다 (날짜 오적재의 가장 흔한 신호).
    assertNotFutureReportDate(data.report_date);

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

    // 공종 키 정정: DMR 공종 코드 → TM 공종 어휘.
    // 매핑은 team_master(code, aliases) 가 유일한 근거다. 코드에 박지 않는다.
    const { data: teamRow, error: teamErr } = await sb
      .from('team_master')
      .select('code, aliases')
      .eq('code', data.discipline)
      .maybeSingle();
    if (teamErr) throw new Error(`team_master 조회 실패: ${teamErr.message}`);
    if (!teamRow) throw new Error(`team_master 에 공종 코드가 없습니다: ${data.discipline}`);
    const tmDisciplines = [
      String(teamRow.code),
      ...((teamRow.aliases ?? []) as string[]).map((a) => String(a)),
    ];

    // TM 정본 1회 조회 (기준일 = report_date)
    // 키는 `${discipline}|${task_no}`. task_no 는 전역 유일이 아니다.
    const snapshot = new Map<string, any>();
    if (taskNos.length > 0) {
      const { data: tmRows, error: tmErr } = await sb
        .rpc('tm_rows_as_of', { _as_of: data.report_date })
        .in('task_no', taskNos)
        .in('discipline', tmDisciplines);
      if (tmErr) throw new Error(`TM 정본 조회 실패: ${tmErr.message}`);
      for (const r of tmRows ?? []) {
        snapshot.set(`${String(r.discipline)}|${String(r.task_no)}`, r);
      }
    }

    const snapshotAt = new Date().toISOString();
    const missing: string[] = [];

    const payload = data.entries.map((e) => {
      const taskNo = (e.task_no ?? '').trim() || null;
      const tm = taskNo
        ? (tmDisciplines
            .map((d) => snapshot.get(`${d}|${taskNo}`))
            .find((r) => !!r) ?? null)
        : null;
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
        task_name: (e.task_name ?? '').trim() || (tm ? (tm.task_name ?? null) : null),
        work_category: (e.work_type ?? '').trim() || (tm ? (tm.row_type ?? null) : null),
        tplan_pct: tm ? (tm.cum_plan_pct ?? null) : null,
        tactual_pct: tm ? (tm.cum_actual_pct ?? null) : null,
        // 하루치 증분 — tm_rows_as_of 정본 값을 저장 시점에 그대로 박는다.
        tc_plan_pct: tm ? (tm.tc_plan_pct ?? null) : null,
        tc_actual_pct: tm ? (tm.tc_actual_pct ?? null) : null,
        task_actual_start: tm ? (tm.actual_start ?? null) : null,
        task_data_date: tm ? (tm.data_date ?? null) : null,
        snapshot_at: taskNo ? snapshotAt : null,
        created_by: context.userId,
      };
    });

    // 동일 충돌 키가 한 배치에 두 번 들어오면 Postgres 가
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" 로 실패한다.
    // 저장 전에 충돌 키 기준으로 합산 병합한다(인원은 합, 나머지는 나중 값 우선).
    const mergedMap = new Map<string, (typeof payload)[number]>();
    for (const row of payload) {
      const key = [
        row.report_date,
        row.discipline,
        row.system_name,
        row.contractor_name,
        row.plot,
        row.task_no ?? '',
        row.headcount_kind,
      ].join('\u0001');
      const prev = mergedMap.get(key);
      if (!prev) {
        mergedMap.set(key, { ...row });
        continue;
      }
      mergedMap.set(key, {
        ...prev,
        ...row,
        plan_manpower: (prev.plan_manpower ?? 0) + (row.plan_manpower ?? 0),
        actual_manpower: (prev.actual_manpower ?? 0) + (row.actual_manpower ?? 0),
      });
    }
    const mergedPayload = [...mergedMap.values()];

    // 같은 표를 다른 날짜로 다시 넣는 사고 차단.
    if (!data.confirm_duplicate) {
      const fp = dmrPayloadFingerprint(mergedPayload as any);
      const from = new Date(new Date(`${data.report_date}T00:00:00Z`).getTime() - 45 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { data: near } = await sb
        .from('dmr_entries')
        .select('report_date, system_name, contractor_name, plot, actual_manpower')
        .eq('discipline', data.discipline)
        .neq('report_date', data.report_date)
        .gte('report_date', from)
        .lte('report_date', data.report_date);
      const byDate = new Map<string, any[]>();
      for (const r of near ?? []) {
        const k = String(r.report_date);
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k)!.push(r);
      }
      for (const [d, rows] of byDate) {
        if (dmrPayloadFingerprint(rows) === fp) {
          throw new Error(
            `중복 의심: ${d} 자료와 행 구성·인원(총 ${totalActual(rows)}명)이 완전히 같습니다. ` +
              `보고일(${data.report_date})이 맞는지 확인하고, 그래도 저장하려면 중복 저장을 확인해 주세요.`,
          );
        }
      }
    }

    const { data: saved, error } = await sb
      .from('dmr_entries')
      .upsert(mergedPayload, {
        onConflict:
          'report_date,discipline,system_name,contractor_name,plot,task_no,headcount_kind',
      })
      .select('id');
    if (error) throw new Error(error.message);

    return {
      ok: true,
      saved: saved?.length ?? mergedPayload.length,
      merged: payload.length - mergedPayload.length,
      snapshot_at: snapshotAt,
      linked_tasks: snapshot.size,
      missing_task_nos: [...new Set(missing)],
    };
  });