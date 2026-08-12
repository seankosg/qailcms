import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { dohaDateOnly } from '@/lib/time/doha';
import { normalizeDmrTeam, normalizeDmrContractor, isDmrDirectContractor } from './dmr/types';

/** 입력은 스크린샷(이미지)뿐이다. 엑셀 업로드 경로는 폐지됐다. */
const InputSchema = z.object({
  storagePaths: z.array(z.string().min(1)).min(1).max(3),
});

const ValuesSchema = z
  .object({
    C: z.coerce.number().int().default(0),
    D: z.coerce.number().int().default(0),
    TOTAL: z.coerce.number().int().optional(),
  })
  .transform((v) => ({ C: v.C ?? 0, D: v.D ?? 0, TOTAL: (v.C ?? 0) + (v.D ?? 0) }));
const RowSchema = z.object({
  system: z.string().default(''),
  contractor: z.string().default(''),
  /** 이 양식이 주는 넷 중 둘 */
  task_no: z.string().default(''),
  count: z.coerce.number().int().default(0),
  is_direct: z.boolean().optional(),
  /** 기존 미리보기 화면(DmrImportPage) 호환용 — 파서는 더 이상 채우지 않는다. */
  values: z
    .object({ plan: ValuesSchema, actual: ValuesSchema })
    .optional(),
});
const SectionSchema = z.object({
  discipline: z.preprocess((v) => normalizeDmrTeam(v), z.enum(['ARCH', 'ELEC', 'MECH'])),
  report_date: z.string(),
  rows: z.array(RowSchema),
  warnings: z.array(z.string()).optional(),
});

function normalizeDate(raw: string): string {
  const s = String(raw).trim();
  // YYYY.MM.DD or YYYY-MM-DD or YYYY/MM/DD
  const m1 = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m1) {
    return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY
  const m2 = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (m2) {
    return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return dohaDateOnly(d) ?? s;
  return s;
}

export const parseDmrImages = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY missing');

    const { DMR_SYSTEM_PROMPT, DMR_TOOL_SCHEMA } = await import('./dmr-prompt.server');

    // 이미지는 URL 로 넘기지 않는다. 모델 제공자가 원격 URL 을 못 읽어 400 을 내는 일이 있어,
    // 바이트를 직접 받아 data URL 로 실어 보낸다.
    const supabase = context.supabase;
    const signed = await Promise.all(
      (data.storagePaths ?? []).map(async (p) => {
        const { data: blob, error } = await supabase.storage.from('dmr-uploads').download(p);
        if (error || !blob) throw new Error(`download failed: ${p} ${error?.message ?? ''}`);
        const buf = Buffer.from(await blob.arrayBuffer());
        const ext = (p.split('.').pop() ?? '').toLowerCase();
        const mime =
          blob.type && blob.type.startsWith('image/')
            ? blob.type
            : ext === 'png'
              ? 'image/png'
              : ext === 'webp'
                ? 'image/webp'
                : 'image/jpeg';
        return { path: p, url: `data:${mime};base64,${buf.toString('base64')}` };
      }),
    );

    async function parseOne(source: { imgUrl: string }) {
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: DMR_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Parse this Daily Manpower Mobilization Status screenshot. Call report_dmr with the extracted data.' },
                { type: 'image_url', image_url: { url: source.imgUrl } },
              ],
            },
          ],
          tools: [{ type: 'function', function: { name: 'report_dmr', description: 'Return parsed DMR data', parameters: DMR_TOOL_SCHEMA } }],
          tool_choice: { type: 'function', function: { name: 'report_dmr' } },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`AI Gateway ${res.status}: ${t}`);
      }
      const body = await res.json();
      const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error('No tool_call returned from AI');
      const argsRaw = toolCall.function?.arguments;
      const parsed = typeof argsRaw === 'string' ? JSON.parse(argsRaw) : argsRaw;
      const section = SectionSchema.parse(parsed);
      section.report_date = normalizeDate(section.report_date);
      // Contractor 정규화 + 기존 미리보기(DmrImportPage) 호환용 values 채우기
      const rows = section.rows.map((r) => {
        const contractor = normalizeDmrContractor(r.contractor);
        const planC = r.values?.plan.C ?? 0;
        const planD = r.values?.plan.D ?? 0;
        const actC = r.values?.actual.C ?? 0;
        const actD = r.values?.actual.D ?? 0;
        return {
          ...r,
          contractor,
          is_direct: r.is_direct ?? isDmrDirectContractor(contractor),
          values: {
            plan: { C: planC, D: planD, TOTAL: planC + planD },
            actual: { C: actC, D: actD, TOTAL: actC + actD },
          },
        };
      });
      return { ...section, rows };
    }

    const results = await Promise.all(
      signed.map((s) => ({ path: s.path, source: { imgUrl: s.url } })).map(async (s) => {
        try {
          const section = await parseOne(s.source);
          return { path: s.path, section, error: null as string | null };
        } catch (e: unknown) {
          return { path: s.path, section: null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    return { results };
  });