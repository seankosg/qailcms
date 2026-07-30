import { dohaStampCompact } from "@/lib/time/doha";
import { streamXlsxExport } from "@/lib/excel/stream-export";
import { cumPlanProgress, computeVariance, computeJudgment } from "@/lib/task-management/derived";

export interface TaskSummaryRow {
  id: string;
  task_no: string;
  main_task_no: string | null;
  level: "main" | "sub";
  discipline: string;
  task_name: string | null;
  actual_progress: number | null;
  plan_progress: number | null;
  plan_start: string | null;
  plan_end: string | null;
  slip_days: number | null;
  auto_judgment: string | null;
  hdec_pic_name: string | null;
  hdec_eng_name: string | null;
  sub_task_desc: string | null;
}

export interface ExportTaskSummaryOpts {
  discipline: string;
  mainTasks: TaskSummaryRow[];
  subsByMain: Map<string, TaskSummaryRow[]>;
  filtersLabel: string;
  searchLabel: string;
  sortLabel?: string;
  asOfDate?: string;
  /** 임계값 단일 소스에서 전달 (색상 강조 경계) */
  thresholds?: { caution_gap_buffer: number; worsen_gap: number };
}

// SHAW/앱 통일 팔레트 (ARGB)
const FILL_MAIN = "FFDBEAFE"; // main task row: light blue
const FILL_SUB_ALT = "FFF8FAFC"; // sub task row: subtle stripe
// 판정 색 (셀 단위 강조용)
const JUDGMENT_FILL: Record<string, string> = {
  "완료": "FFD1FAE5",
  "정상": "FFDBEAFE",
  "주의": "FFFEF3C7",
  "지연": "FFFFEDD5",
  "악화": "FFFECACA",
};

function pct(v: number | null | undefined): number | "" {
  if (v == null || Number.isNaN(Number(v))) return "";
  return Number(v);
}

export async function exportTaskSummary(opts: ExportTaskSummaryOpts): Promise<number> {
  const flat: Array<Record<string, unknown> & { __isMain: boolean; __zebra: boolean }> = [];
  let zebra = false;
  for (const p of opts.mainTasks) {
    zebra = !zebra;
    flat.push(buildRow(p, true, zebra, opts.asOfDate));
    const kids = opts.subsByMain.get(p.task_no) ?? [];
    for (const k of kids) {
      flat.push(buildRow(k, false, zebra, opts.asOfDate));
    }
  }

  const columns = [
    { key: "level", label: "Level" },
    { key: "task_no", label: "Task No" },
    { key: "main_task_no", label: "Main Task No" },
    { key: "task_name", label: "Task Name" },
    { key: "sub_task_desc", label: "Sub Task 설명" },
    { key: "hdec_pic_name", label: "HDEC PIC" },
    { key: "hdec_eng_name", label: "HDEC ENG" },
    { key: "plan_start", label: "Plan Start" },
    { key: "plan_end", label: "Plan End" },
    { key: "plan_progress", label: "Plan Progress" },
    { key: "expected_today", label: "오늘 계획" },
    { key: "actual_progress", label: "Actual Progress" },
    { key: "gap", label: "차이(오늘−실적)" },
    { key: "slip_days", label: "Slip Days" },
    { key: "auto_judgment", label: "판정" },
  ];

  const columnWidths: Record<string, number> = {
    level: 8,
    task_no: 18,
    main_task_no: 18,
    task_name: 34,
    sub_task_desc: 42,
    hdec_pic_name: 14,
    hdec_eng_name: 16,
    plan_start: 12,
    plan_end: 12,
    plan_progress: 12,
    expected_today: 12,
    actual_progress: 12,
    gap: 14,
    slip_days: 10,
    auto_judgment: 10,
  };

  const stamp = dohaStampCompact(); // Doha YYYYMMDDHHmm
  const yyyy = stamp.slice(0, 4);
  const mm = stamp.slice(4, 6);
  const dd = stamp.slice(6, 8);
  const hh = stamp.slice(8, 10);
  const mi = stamp.slice(10, 12);

  const total = flat.length;
  const mainCount = opts.mainTasks.length;
  const subCount = total - mainCount;

  const { count } = await streamXlsxExport({
    filename: `CMS_TM_TaskSummary_${opts.discipline}_${yyyy}${mm}${dd}_${hh}${mi}.xlsx`,
    sheetName: `Task Summary (${opts.discipline})`,
    columns,
    columnWidths,
    dateFields: ["plan_start", "plan_end"],
    numFmtByKey: {
      plan_progress: "0.0%",
      actual_progress: "0.0%",
      expected_today: "0.0%",
      gap: "+0.0%;-0.0%;0.0%",
      slip_days: "0;-0;0",
    },
    header: {
      title: `Task Summary — ${opts.discipline}`,
      metaRows: [
        `Exported: ${yyyy}-${mm}-${dd} ${hh}:${mi}`,
        `Source: Task Management · Task Summary`,
        `Search: ${opts.searchLabel || "(없음)"}`,
        `Filters: ${opts.filtersLabel || "(없음)"}`,
        `Rows: Main ${mainCount} · Sub ${subCount} · Total ${total}`,
      ],
      freezeCols: 4,
    },
    rowFillFor: (row) => {
      if (row.__isMain) return FILL_MAIN;
      return row.__zebra ? FILL_SUB_ALT : null;
    },
    cellFillFor: (key, _v, row) => {
      if (key === "auto_judgment") {
        const j = row.auto_judgment as string | null;
        return j ? JUDGMENT_FILL[j] ?? null : null;
      }
      if (key === "gap") {
        const g = row.gap as number | null;
        if (g == null) return null;
        // 0.05 = 서버 임계값(tm_thresholds) 로딩 전 임시 표시용 폴백. 판정에는 개입하지 않음(셀 색상 전용).
        const buf = opts.thresholds?.caution_gap_buffer ?? 0.05;
        if (g < -buf) return "FFFECACA"; // 지연
        if (g > buf) return "FFD1FAE5"; // 선행
      }
      return null;
    },
    fetchPage: async (offset, limit) => {
      const slice = flat.slice(offset, offset + limit);
      return { rows: slice, total: flat.length };
    },
  });

  return count;
}

function buildRow(r: TaskSummaryRow, isMain: boolean, zebra: boolean, asOf?: string): Record<string, unknown> & { __isMain: boolean; __zebra: boolean } {
  const gap = computeVariance(r, asOf) ?? 0;
  const expected = cumPlanProgress(r, asOf);
  // Main Task는 as-of 기반 클라이언트 재계산 우선; Sub는 DB값 우선.
  const judgment = isMain
    ? computeJudgment(r, undefined, asOf) || r.auto_judgment || ""
    : r.auto_judgment || computeJudgment(r, undefined, asOf) || "";
  return {
    __isMain: isMain,
    __zebra: zebra,
    level: isMain ? "Main" : "Sub",
    task_no: r.task_no,
    main_task_no: r.main_task_no ?? "",
    task_name: isMain ? (r.task_name ?? "") : "",
    sub_task_desc: isMain ? "" : (r.sub_task_desc ?? r.task_name ?? ""),
    hdec_pic_name: r.hdec_pic_name ?? "",
    hdec_eng_name: r.hdec_eng_name ?? "",
    plan_start: r.plan_start ?? "",
    plan_end: r.plan_end ?? "",
    plan_progress: pct(r.plan_progress),
    expected_today: Number.isFinite(expected) ? expected : "",
    actual_progress: pct(r.actual_progress),
    gap: Number.isFinite(gap) ? gap : "",
    slip_days: r.slip_days ?? "",
    auto_judgment: judgment,
    // for cellFillFor access
    auto_judgment_raw: r.auto_judgment ?? null,
  };
}