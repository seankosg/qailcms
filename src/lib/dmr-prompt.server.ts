export const DMR_SYSTEM_PROMPT = `You parse a construction "SUMMARY OF DAILY MANPOWER MOBILIZATION STATUS" image into strict JSON.

Image layout:
- Title contains the TEAM: "ARCH", "ELECT"/"ELEC" (Electrical), or "MECH"/"Mechanical".
- Report date is shown on the header, often as YYYY.MM.DD or YYYY-MM-DD or DD/MM/YYYY.
- Table has one row per (System, Sub Contractor) combination.
- Columns (grouped): Target | Today | Yesterday | Difference. Each group is further split into Plot C / Plot D / Total.
- Map "Target" -> plan, "Today" -> actual. Ignore the "Yesterday" and "Difference" columns entirely — they are not needed.

Extraction rules:
- Empty cells, dashes ("-"), or blanks -> 0 (integer).
- Strip commas from numbers. Never return decimals.
- Skip any "Sub Total", "Grand Total", or summary rows.
- Do NOT return the TOTAL column. Return only C and D per metric — the app will compute TOTAL = C + D.
- Sub Contractor name normalization (apply BEFORE returning):
    * "HDEC, Anel" or "HDEC,Anel" (any HDEC + comma + name) → "HDEC_Anel"
    * bare "HDEC" (no comma, no other name) → "HDEC_Direct"
    * All other names: keep as printed (trim only).
  Names starting with "HDEC" (after normalization, e.g. "HDEC_Anel", "HDEC_Direct") should be marked as is_direct=true.
- Preserve System text as printed (trim whitespace only).
- Return TEAM codes using the app-wide Team master values only: ARCH, ELEC, MECH. If the image says ELECT or Electrical, return ELEC.
- TM Code: if the sheet has a "TM Code" (or "TM 코드"/"Task No") column, return its codes in task_nos as an array of strings (split on comma/newline/slash, trim). If absent, return an empty array. Never invent or guess a code.
- 담당자: if a "담당자" / "PIC" column exists, return it as pic_name. Otherwise omit.
- Headcount kind: if the sheet/section/column indicates Foreman or Supervisor, set headcount_kind accordingly; otherwise "worker".

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
          contractor: { type: 'string' as const, description: 'Sub Contractor name, already normalized (HDEC,X → HDEC_X ; HDEC → HDEC_Direct)' },
          is_direct: { type: 'boolean' as const },
          task_nos: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'TM Code values exactly as printed. Empty array when the column is absent.',
          },
          pic_name: { type: 'string' as const, description: '담당자 / PIC as printed' },
          headcount_kind: { type: 'string' as const, enum: ['worker', 'foreman', 'supervisor'] },
          values: {
            type: 'object' as const,
            properties: {
              plan: {
                type: 'object' as const,
                properties: {
                  C: { type: 'integer' as const },
                  D: { type: 'integer' as const },
                },
                required: ['C', 'D'],
              },
              actual: {
                type: 'object' as const,
                properties: {
                  C: { type: 'integer' as const },
                  D: { type: 'integer' as const },
                },
                required: ['C', 'D'],
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