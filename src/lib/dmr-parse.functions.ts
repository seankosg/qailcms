import { dohaDateOnly } from './time/doha';
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { normalizeDmrTeam, normalizeDmrContractor, isDmrDirectContractor } from './dmr/types';

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
  system: z.string().min(1),
  contractor: z.string().min(1),
  is_direct: z.boolean().optional(),
  values: z.object({
    plan: ValuesSchema,
    actual: ValuesSchema,
  }),
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

    // Get signed URLs for each storage path.
    const supabase = context.supabase;
    const signed = await Promise.all(
      data.storagePaths.map(async (p) => {
        const { data: s, error } = await supabase.storage
          .from('dmr-uploads')
          .createSignedUrl(p, 600);
        if (error || !s) throw new Error(`signed url failed: ${p} ${error?.message ?? ''}`);
        return { path: p, url: s.signedUrl };
      }),
    );

    async function parseOne(imgUrl: string) {
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
                { type: 'text', text: 'Parse this Daily Manpower report image. Call report_dmr with the extracted data.' },
                { type: 'image_url', image_url: { url: imgUrl } },
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
      // Normalize contractor names + force TOTAL = C + D (ignore any TOTAL the AI returned)
      section.rows = section.rows.map((r) => {
        const contractor = normalizeDmrContractor(r.contractor);
        const planC = r.values.plan.C ?? 0;
        const planD = r.values.plan.D ?? 0;
        const actC = r.values.actual.C ?? 0;
        const actD = r.values.actual.D ?? 0;
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
      return section;
    }

    const results = await Promise.all(
      signed.map(async (s) => {
        try {
          const section = await parseOne(s.url);
          return { path: s.path, section, error: null as string | null };
        } catch (e: unknown) {
          return { path: s.path, section: null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    return { results };
  });