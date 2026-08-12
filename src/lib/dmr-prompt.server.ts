export const DMR_SYSTEM_PROMPT = `You read a screenshot of a construction sheet titled "Daily Manpower Mobilization Status (ARCH | ELECT | MECH)" and return strict JSON.

Sheet layout:
- Title contains the discipline: ARCH, ELECT (return as ELEC), or MECH. Always take the discipline from the title text, never from the content of the rows.
- The report date is at the top right, e.g. "11/8/26" or "11/Aug/26". It is DAY first: "12/8/26" is 2026-08-12, not 2026-12-08. Two-digit years are 20xx. Return it as YYYY-MM-DD.
- The header spans two lines:
    [Type] | System | Contractor Subcon. | PLOT_C | PLOT_D | Remark
    and under each PLOT group: 담당자 | Today | TM Code | TASK
- The last rows are "Total", "HDEC_Total", "SUBCON_Total".

READ ONLY THESE FOUR per data row: TM Code, Today (headcount), System, Contractor.
IGNORE everything else: Type, 담당자, TASK, Remark, PLOT group headers, and all totals.

Rules:
- "Today" is ALWAYS the cell immediately to the LEFT of its TM Code cell. Do not interpret the PLOT_C / PLOT_D grouping — the app resolves plot from its own data.
- Emit one row object per printed data row (per Today value). If the same TM Code appears in several rows, emit each occurrence separately — do NOT sum them yourself.
- count: integer. Strip commas. Never decimals. If the cell is "-", blank, or 0, SKIP that row entirely.
- task_no: the TM Code exactly as printed. If the cell is empty or does not look like a code (e.g. "Monitoring"), return an empty string "". Never invent or guess a code.
- If a cell holds several codes, return them as printed separated by a comma.
- Skip the "Total", "HDEC_Total", "SUBCON_Total" rows and any other summary line.
- System and Contractor cells are merged vertically: when a row's cell is blank, carry down the value from the row above.
- Contractor normalization before returning: "HDEC, X" → "HDEC_X" ; bare "HDEC" → "HDEC_Direct" ; otherwise keep as printed (trim only).
- discipline and report_date must always be filled: the app classifies the team and sets the report date from them. ELECT means ELEC.

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
          task_no: {
            type: 'string' as const,
            description: 'TM Code exactly as printed. Empty string when absent or not code-shaped.',
          },
          count: { type: 'integer' as const, description: 'Today headcount. Integer, no commas, no decimals.' },
          system: { type: 'string' as const, description: 'System name, carried down when merged/blank.' },
          contractor: { type: 'string' as const, description: 'Contractor Subcon., normalized (HDEC,X → HDEC_X ; HDEC → HDEC_Direct)' },
        },
        required: ['task_no', 'count', 'system', 'contractor'],
      },
    },
  },
  required: ['discipline', 'report_date', 'rows'],
};
