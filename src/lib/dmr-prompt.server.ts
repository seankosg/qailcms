export const DMR_SYSTEM_PROMPT = `You parse a construction "SUMMARY OF DAILY MANPOWER MOBILIZATION STATUS" image into strict JSON.

Image layout:
- Title contains the TEAM: "ARCH", "ELECT"/"ELEC" (Electrical), or "MECH"/"Mechanical".
- Report date is shown on the header, often as YYYY.MM.DD or YYYY-MM-DD or DD/MM/YYYY.
- Table has one row per (System, Contractor Subcon.) combination.
- Columns (grouped): Target | Today | Yesterday | Difference. Each group is further split into Plot C / Plot D / Total.
- Map "Target" -> plan, "Today" -> actual. Ignore the "Yesterday" and "Difference" columns entirely — they are not needed.

Extraction rules:
- Empty cells, dashes ("-"), or blanks -> 0 (integer).
- Strip commas from numbers. Never return decimals.
- Skip any "Sub Total", "Grand Total", or summary rows.
- If a cell shows only a Total (no C/D breakdown), put the value in TOTAL and set C=0, D=0.
- Contractor names starting with "HDEC" (e.g. "HDEC", "HDEC,Anel") should be marked as is_direct=true.
- Preserve System and Contractor text as printed (trim whitespace only).
- Return TEAM codes using the app-wide Team master values only: ARCH, ELEC, MECH. If the image says ELECT or Electrical, return ELEC.

Return ONLY JSON via the report_dmr tool. Do not include narration.`;

export const DMR_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    discipline: { type: 'string' as const, enum: ['ARCH', 'ELEC', 'MECH'] },
    report_date: { type: 'string' as const, description: 'YYYY-MM-DD' },
    rows: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          system: { type: 'string' as const },
          contractor: { type: 'string' as const },
          is_direct: { type: 'boolean' as const },
          values: {
            type: 'object' as const,
            properties: {
              plan: {
                type: 'object' as const,
                properties: {
                  C: { type: 'integer' as const },
                  D: { type: 'integer' as const },
                  TOTAL: { type: 'integer' as const },
                },
                required: ['C', 'D', 'TOTAL'],
              },
              actual: {
                type: 'object' as const,
                properties: {
                  C: { type: 'integer' as const },
                  D: { type: 'integer' as const },
                  TOTAL: { type: 'integer' as const },
                },
                required: ['C', 'D', 'TOTAL'],
              },
            },
            required: ['plan', 'actual'],
          },
        },
        required: ['system', 'contractor', 'values'],
      },
    },
  },
  required: ['discipline', 'report_date', 'rows'],
};