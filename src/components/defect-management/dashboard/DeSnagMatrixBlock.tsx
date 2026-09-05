import { cn } from "@/lib/utils";
import { Fragment } from "react";
import { formatHoDate, EMPTY_HO_DATE_MAP, type HoDateMap } from "@/lib/defect-management/ho-dates";
import {
  EMPTY_STAGE_DATE_MAP,
  type StageDateMap,
} from "@/lib/defect-management/stage-dates";
import {
  TEAM_COL_ORDER,
  bottleneckTeam,
  newStats,
  mergeStats,
  STAGE_METRICS,
  type StageMetric,
  type MatrixBlock,
  type Stats,
  type TeamKey,
} from "@/lib/defect-management/dashboard-shape";

export type MatrixMode = "count" | "pct" | "remain" | "remainPct";

type StatusSlot = "issued" | StageMetric;

/** Each Date 모드에서 한 셀의 스테이지·팀별 날짜를 찾아주는 조회자 */
export type StageDateLookup = (
  stage: StageMetric,
  team: TeamKey,
  which: "planned" | "actual",
) => string | null;

const STATUS_COLS: Array<{ slot: StatusSlot; label: string }> = [
  { slot: "issued", label: "Issued" },
  ...STAGE_METRICS.map((m) => ({ slot: m.slot as StatusSlot, label: m.label })),
];

const COLS_PER_GROUP = STATUS_COLS.length * TEAM_COL_ORDER.length; // 6 slots × 3 teams
/** 잔여+Date 모드: Issued 3열 + 스테이지 5개 × (잔여 3 + Date 3) */
const COLS_PER_GROUP_DUAL =
  TEAM_COL_ORDER.length + STAGE_METRICS.length * TEAM_COL_ORDER.length * 2;
const perGroupCols = (dual: boolean) => (dual ? COLS_PER_GROUP_DUAL : COLS_PER_GROUP);
/** sticky 헤더 오프셋 — 4단(잔여+Date)일 때 한 단(24px) 더 내려간다 */
const TEAM_ROW_TOP = (dual: boolean) => (dual ? 78 : 54);
const TOTAL_ROW_TOP = (dual: boolean) => (dual ? 102 : 78);


/** HO Planned Date (dd/mmm) 셀 */
function HoCell({
  value,
  groupIndex,
  isTotal,
  stickyTop,
  emphasize,
}: {
  value: string | null;
  groupIndex: number;
  isTotal?: boolean;
  stickyTop?: number;
  emphasize?: boolean;
}) {
  const bg = isTotal
    ? "color-mix(in oklab, var(--color-yellow-400) 12%, var(--card))"
    : groupIndex % 2 === 0
      ? "var(--card)"
      : "color-mix(in oklab, var(--muted) 25%, var(--card))";
  return (
    <td
      className={cn(
        "h-7 min-w-[52px] border-b border-l border-l-border/70 px-1 text-center text-[10px] tabular-nums",
        stickyTop !== undefined && "sticky z-20",
        value ? "text-foreground" : "text-muted-foreground/50",
        isTotal ? "font-bold" : emphasize && "font-semibold",
      )}
      style={stickyTop !== undefined ? { top: stickyTop, background: bg } : { background: bg }}
      title={value ?? undefined}
    >
      {formatHoDate(value)}
    </td>
  );
}

function pctTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct < 40) return "text-destructive font-semibold";
  if (pct < 80) return "text-amber-600 dark:text-amber-400 font-semibold";
  return "text-emerald-600 dark:text-emerald-400 font-semibold";
}

/** 잔여 비율은 높을수록 나쁨 — 완료 비율과 색 방향을 뒤집는다. */
function remainPctTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  return pctTone(100 - pct);
}

/** Render team-decomposed <td> cells (Issued/Stage × Elec/Mech/Arch, 잔여+Date 모드에서는 Date 열 추가). */
function TeamCells({
  stats,
  mode,
  onCell,
  dim,
  groupIndex,
  isTotal,
  stickyTop,
  stageDate,
  dual,
}: {
  stats: Stats;
  mode: MatrixMode;
  onCell: (slot: StatusSlot, team: TeamKey) => void;
  dim?: boolean;
  groupIndex: number;
  isTotal?: boolean;
  stickyTop?: number;
  /** 지정되면 날짜 조회 가능 — Each Date(대체) 또는 잔여+Date(병기) */
  stageDate?: StageDateLookup;
  /** true = 잔여 개수와 Date 를 나란히 표시 */
  dual?: boolean;
}) {
  const groupBg = isTotal ? "bg-yellow-400/10" : groupIndex % 2 === 0 ? "bg-transparent" : "bg-muted/20";
  const stickyBg = isTotal
    ? "color-mix(in oklab, var(--color-yellow-400) 12%, var(--card))"
    : groupIndex % 2 === 0
      ? "var(--card)"
      : "color-mix(in oklab, var(--muted) 25%, var(--card))";

  const bottlenecks: Partial<Record<StatusSlot, TeamKey | null>> = {};
  for (const m of STAGE_METRICS) bottlenecks[m.slot] = bottleneckTeam(stats.byTeam, m.slot);

  // 잔여 모드 전용 Room Group 단위 상태 하이라이트
  const isRemainMode = dual || mode === "remain" || mode === "remainPct";
  const totalIssued = TEAM_COL_ORDER.reduce((s, tk) => s + stats.byTeam[tk].issued, 0);
  const rectReady =
    isRemainMode &&
    totalIssued > 0 &&
    TEAM_COL_ORDER.every((tk) => stats.byTeam[tk].issued - stats.byTeam[tk].rect <= 0);
  const closedReady =
    isRemainMode &&
    totalIssued > 0 &&
    TEAM_COL_ORDER.every((tk) => stats.byTeam[tk].issued - stats.byTeam[tk].closed <= 0);

  /** Each Date 전용 모드(숫자 → 날짜 대체) */
  const dateOnly = !!stageDate && !dual;

  const renderCell = (
    sc: (typeof STATUS_COLS)[number],
    sIdx: number,
    team: TeamKey,
    tIdx: number,
    kind: "num" | "date",
    isFirstOfGroup: boolean,
    isSubgroupStart: boolean,
  ) => {
    const t = stats.byTeam[team];
    const done = sc.slot === "issued" ? t.issued : t[sc.slot];
    const isStageSlot = sc.slot !== "issued";
    const useRemain = isRemainMode;
    const count = useRemain && isStageSlot ? Math.max(0, t.issued - done) : done;
    const ratio = t.issued > 0 && isStageSlot ? (count / t.issued) * 100 : null;
    const showPct = !dual && (mode === "pct" || mode === "remainPct") && isStageSlot;
    const text = showPct ? (ratio == null ? "–" : `${Math.round(ratio)}%`) : count.toLocaleString();
    const isBottleneck = isStageSlot && bottlenecks[sc.slot] === team;
    const readyTone =
      sc.slot === "rect" && rectReady
        ? "ready-inspection"
        : sc.slot === "closed" && closedReady
          ? "ready-handover"
          : null;
    const zeroDim = !showPct && count === 0 ? "text-muted-foreground/50" : "text-foreground";

    // 날짜: 스테이지 완료(잔여 0) → 실적일 + 회색 반전, 그 외 → 계획일
    const wantDate = kind === "date" || dateOnly;
    const stageDone = wantDate && isStageSlot && t.issued > 0 && t.issued - done <= 0;
    const dateValue =
      wantDate && isStageSlot && stageDate
        ? stageDate(sc.slot as StageMetric, team, stageDone ? "actual" : "planned")
        : null;
    const dateText = wantDate ? (isStageSlot ? formatHoDate(dateValue) : "–") : null;

    const readyBg =
      wantDate && stageDone
        ? "color-mix(in oklab, var(--muted) 90%, var(--card))"
        : kind === "num" && readyTone === "ready-inspection"
          ? "color-mix(in oklab, var(--color-sky-400) 30%, var(--card))"
          : kind === "num" && readyTone === "ready-handover"
            ? "color-mix(in oklab, var(--color-emerald-400) 30%, var(--card))"
            : null;
    const showBottleneckBg = isBottleneck && !readyBg && kind === "num" && !dateOnly;

    return (
      <td
        key={`${sc.slot}-${team}-${kind}`}
        className={cn(
          "h-7 border-b p-0 tabular-nums",
          (dateOnly || kind === "date") && "min-w-[54px]",
          stickyTop === undefined && !readyBg && groupBg,
          stickyTop !== undefined && "sticky z-20",
          isFirstOfGroup && "border-l-2 border-l-border",
          !isFirstOfGroup && isSubgroupStart && "border-l border-l-border/70",
          !isSubgroupStart && "border-r border-r-border/30",
          showBottleneckBg && "bg-destructive/15",
          dim && "opacity-50",
        )}
        style={
          stickyTop !== undefined
            ? { top: stickyTop, background: readyBg ?? (showBottleneckBg ? undefined : stickyBg) }
            : readyBg
              ? { background: readyBg }
              : undefined
        }
      >
        <button
          type="button"
          onClick={() => onCell(sc.slot, team)}
          title={`${team} ${sc.label}: ${count.toLocaleString()}${
            ratio != null ? ` (${Math.round(ratio)}%)` : ""
          }${isBottleneck ? " · 병목" : ""}${
            readyTone === "ready-inspection"
              ? " · Ready for Inspection"
              : readyTone === "ready-handover"
                ? " · Ready for Handover"
                : ""
          }${
            wantDate && isStageSlot
              ? ` · ${stageDone ? "실적일" : "계획일"} ${dateValue ?? "없음"}`
              : ""
          }`}
          className={cn(
            "block h-full w-full px-1 leading-none hover:bg-primary/10",
            kind === "date" || dateOnly ? "text-center text-[10px]" : "text-right text-xs",
            kind === "num" && !dateOnly && sc.slot === "issued" && !isTotal && "font-medium",
            kind === "date" || dateOnly
              ? stageDone
                ? "text-muted-foreground"
                : dateValue
                  ? "text-foreground"
                  : "text-muted-foreground/50"
              : showPct
                ? isRemainMode
                  ? remainPctTone(ratio)
                  : pctTone(ratio)
                : zeroDim,
            kind === "num" && !dateOnly && isBottleneck && !isTotal && "font-semibold",
            kind === "num" && !dateOnly && readyTone && !isTotal && "font-semibold text-foreground",
            isTotal && "font-bold",
          )}
        >
          {kind === "date" || dateOnly ? dateText : text}
        </button>
      </td>
    );
  };

  return (
    <>
      {STATUS_COLS.map((sc, sIdx) => (
        <Fragment key={`slot-${sc.slot}`}>
          {TEAM_COL_ORDER.map((team, tIdx) =>
            renderCell(sc, sIdx, team, tIdx, "num", sIdx === 0 && tIdx === 0, tIdx === 0),
          )}
          {dual &&
            sc.slot !== "issued" &&
            TEAM_COL_ORDER.map((team, tIdx) =>
              renderCell(sc, sIdx, team, tIdx, "date", false, tIdx === 0),
            )}
        </Fragment>
      ))}
    </>
  );
}


/** Header: Room Group → Status → (잔여/Date) → Team. */
function MatrixHeader({
  block,
  buildingParam,
  onNavigate,
  showHoDate,
  srcRG,
  dual,
}: {
  block: MatrixBlock;
  buildingParam: Record<string, string>;
  onNavigate: (p: Record<string, string>) => void;
  showHoDate: boolean;
  srcRG: (col: string) => string;
  dual: boolean;
}) {
  const groups: Array<{ key: string; label: string; isTotal?: boolean; isNa?: boolean }> = [
    ...block.columnKeys.map((rg) => ({ key: rg as string, label: rg as string, isNa: rg === "N/A" })),
    { key: "__ROW_TOTAL__", label: "Row Total", isTotal: true },
  ];
  const groupBg = (g: { isTotal?: boolean; isNa?: boolean }, idx: number) =>
    g.isTotal
      ? "color-mix(in oklab, var(--primary) 10%, var(--card))"
      : g.isNa
        ? "color-mix(in oklab, var(--muted) 50%, var(--card))"
        : idx % 2 === 1
          ? "color-mix(in oklab, var(--muted) 30%, var(--card))"
          : "color-mix(in oklab, var(--muted) 50%, var(--card))";
  return (
    <thead>
      {/* Tier 1: Room Group */}
      <tr>
        <th
          rowSpan={dual ? 4 : 3}
          className="sticky left-0 top-0 z-40 min-w-[100px] border-b-2 border-r px-2 py-1.5 text-left text-[11px] font-semibold"
          style={{ background: "color-mix(in oklab, var(--muted) 70%, var(--card))" }}
        >
          {block.rowAxis.primary}
        </th>
        <th
          rowSpan={dual ? 4 : 3}
          className="sticky left-[100px] top-0 z-40 min-w-[80px] border-b-2 border-r px-2 py-1.5 text-left text-[11px] font-semibold"
          style={{ background: "color-mix(in oklab, var(--muted) 70%, var(--card))" }}
        >
          {block.rowAxis.secondary}
        </th>
        {groups.map((g, idx) => (
          <th
            key={g.key}
            colSpan={perGroupCols(dual) + (showHoDate ? 1 : 0)}
            className="sticky top-0 z-30 border-b border-l-2 border-l-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide"
            style={{ background: groupBg(g, idx) }}
          >
            {g.isTotal ? (
              <span>{g.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const p: Record<string, string> = { ...buildingParam };
                  if (block.kind === "liftcabin") {
                    p.subcontractor = g.key === "N/A" ? "__EMPTY__" : g.key;
                  } else {
                    p.roomGroup = srcRG(g.key);
                  }
                  onNavigate(p);
                }}
                className="hover:text-primary"
              >
                {g.label}
              </button>
            )}
          </th>
        ))}
      </tr>
      {/* Tier 2: Status */}
      <tr>
        {groups.map((g, idx) => (
          <Fragment key={`t2-${g.key}`}>
          {STATUS_COLS.map((sc, sIdx) => (
            <th
              key={`${g.key}-${sc.slot}`}
              colSpan={
                dual && sc.slot !== "issued"
                  ? TEAM_COL_ORDER.length * 2
                  : TEAM_COL_ORDER.length
              }
              className={cn(
                "sticky top-[30px] z-30 h-6 border-b px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                sIdx === 0 && "border-l-2 border-l-border",
                sIdx !== 0 && "border-l border-l-border/70",
              )}
              style={{ background: groupBg(g, idx) }}
            >
              {sc.label}
            </th>
          ))}
          {showHoDate && (
            <th
              key={`${g.key}-hodate`}
              rowSpan={dual ? 3 : 2}
              className="sticky top-[30px] z-30 min-w-[52px] border-b border-l border-l-border/70 px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ background: groupBg(g, idx) }}
            >
              {g.isTotal ? "Level HO" : "HO Date"}
            </th>
          )}
          </Fragment>
        ))}
      </tr>
      {/* Tier 2b: 잔여 / Date (잔여+Date 모드 전용) */}
      {dual && (
        <tr>
          {groups.map((g, idx) =>
            STATUS_COLS.map((sc, sIdx) =>
              (sc.slot === "issued" ? (["num"] as const) : (["num", "date"] as const)).map(
                (kind) => (
                  <th
                    key={`${g.key}-${sc.slot}-${kind}`}
                    colSpan={TEAM_COL_ORDER.length}
                    className={cn(
                      "sticky top-[54px] z-30 h-6 border-b px-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
                      sIdx === 0 && kind === "num" && "border-l-2 border-l-border",
                      !(sIdx === 0 && kind === "num") && "border-l border-l-border/70",
                    )}
                    style={{ background: groupBg(g, idx) }}
                  >
                    {sc.slot === "issued" ? "개수" : kind === "num" ? "잔여" : "Date"}
                  </th>
                ),
              ),
            ),
          )}
        </tr>
      )}
      {/* Tier 3: Team */}
      <tr>
        {groups.map((g, idx) =>
          STATUS_COLS.map((sc, sIdx) =>
            (dual && sc.slot !== "issued" ? (["num", "date"] as const) : (["num"] as const)).map(
              (kind) =>
                TEAM_COL_ORDER.map((team, tIdx) => (
                  <th
                    key={`${g.key}-${sc.slot}-${kind}-${team}`}
                    className={cn(
                      "sticky z-30 h-6 min-w-[40px] border-b px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
                      kind === "date" ? "text-center" : "text-right",
                      sIdx === 0 && kind === "num" && tIdx === 0 && "border-l-2 border-l-border",
                      !(sIdx === 0 && kind === "num") && tIdx === 0 && "border-l border-l-border/70",
                      tIdx !== 0 && "border-r border-r-border/30",
                    )}
                    style={{ background: groupBg(g, idx), top: TEAM_ROW_TOP(dual) }}
                    title={`${sc.label} · ${team}${kind === "date" ? " · Date" : ""}`}
                  >
                    {team === "ELEC" ? "Elec" : team === "MECH" ? "Mech" : "Arch"}
                  </th>
                )),
            ),
          ),
        )}
      </tr>
    </thead>
  );
}

export function DeSnagMatrixBlock({
  block,
  onNavigate,
  mode,
  buildingSourceMap,
  levelSourceMap,
  roomGroupSourceMap,
  showHoDate = false,
  hoDates = EMPTY_HO_DATE_MAP,
  eachDate = false,
  stageDates = EMPTY_STAGE_DATE_MAP,
}: {
  block: MatrixBlock;
  mode: MatrixMode;
  /** 라벨 → 원본 값 역매핑 (정본 = dashboard-shape.buildMatrix) */
  buildingSourceMap: Record<string, string[]>;
  levelSourceMap: Record<string, string[]>;
  roomGroupSourceMap: Record<string, string[]>;
  onNavigate: (params: Record<string, string>) => void;
  showHoDate?: boolean;
  hoDates?: HoDateMap;
  eachDate?: boolean;
  stageDates?: StageDateMap;
}) {
  // 라벨 → 원본 값. 목록을 컴포넌트에 적지 않는다.
  const srcB = (label: string) => (buildingSourceMap[label] ?? [label]).join(",");
  const srcL = (label: string) => (levelSourceMap[label] ?? [label]).join(",");
  const srcRG = (col: string) =>
    (roomGroupSourceMap[col] ?? [col === "N/A" ? "__EMPTY__" : col]).join(",");

  const buildingMembers = Array.from(
    new Set(block.rows.flatMap((r) => (buildingSourceMap[r.building] ?? [r.building]))),
  );

  const buildingParam: Record<string, string> = buildingMembers.length
    ? { building: buildingMembers.join(",") }
    : {};

  const goCell = (
    rowBuilding: string | null,
    rowLevelDisp: string | null,
    col: string,
    slot: StatusSlot,
    team: TeamKey,
  ) => {
    const p: Record<string, string> = {};
    if (block.kind === "unassigned" || block.kind === "basement" || !rowBuilding)
      Object.assign(p, buildingParam);
    else p.building = srcB(rowBuilding);
    // LG · LIFT CABIN 블록의 행 라벨은 level_name 이 아니므로 level 필터를 걸지 않는다.
    if (block.kind === "liftcabin") {
      if (rowLevelDisp) p.room = rowLevelDisp === "N/A" ? "__EMPTY__" : rowLevelDisp;
      if (col === "N/A") p.subcontractor = "__EMPTY__";
      else if (col !== "__ROW_TOTAL__" && col !== "__BUILDING_SUBTOTAL__") p.subcontractor = col;
    } else {
      if (rowLevelDisp && block.kind !== "lg") p.level = srcL(rowLevelDisp);
      if (col !== "__ROW_TOTAL__" && col !== "__BUILDING_SUBTOTAL__") p.roomGroup = srcRG(col);
    }
    p.team = team;
    // 정본(_snag_done_asof) 동치: 자기 실적일 ≤ as-of. dateEnd 는 상위에서 as-of 로 채움.
    const sm = STAGE_METRICS.find((m) => m.slot === slot);
    if (sm) p.dateField = sm.dateField;
    onNavigate(p);
  };

  // Building 별 소계 계산 (podium 블록에서만 의미 있음)
  type BuildingGroup = { building: string; rows: typeof block.rows; subtotal: Stats };
  const groups: BuildingGroup[] = [];
  {
    let cur: BuildingGroup | null = null;
    for (const r of block.rows) {
      if (!cur || cur.building !== r.building) {
        if (cur) groups.push(cur);
        cur = { building: r.building, rows: [], subtotal: newStats() };
      }
      cur.rows.push(r);
      mergeStats(cur.subtotal, r.rowTotal);
    }
    if (cur) groups.push(cur);
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b bg-muted px-3 py-2">
        <h3 className="text-sm font-semibold">{block.title}</h3>
        <button
          type="button"
          onClick={() => onNavigate({ ...buildingParam })}
          className="text-[11px] text-muted-foreground hover:text-primary"
        >
          블록 전체 보기 →
        </button>
      </div>
      <div className="relative max-h-[calc(100dvh-260px)] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <MatrixHeader
            block={block}
            buildingParam={buildingParam}
            onNavigate={onNavigate}
            showHoDate={showHoDate}
            srcRG={srcRG}
          />
          <tbody>
            {/* Column Total 행 — 헤더 바로 아래 고정 */}
            <tr className="font-bold">
              <td
                className="sticky left-0 top-[78px] z-30 border-r border-b-2 border-b-border px-2 py-1 text-[11px]"
                colSpan={2}
                style={{ background: "color-mix(in oklab, var(--color-yellow-400) 14%, var(--card))" }}
              >
                <button
                  type="button"
                  onClick={() => onNavigate({ ...buildingParam })}
                  className="hover:text-primary"
                >
                  Column Total
                </button>
              </td>
              {block.columnKeys.map((rg, idx) => (
                <Fragment key={rg}>
                  <TeamCells
                    dual={dual}
                    stats={block.colTotals[rg]}
                    mode={mode}
                    onCell={(slot, team) => goCell(null, null, rg, slot, team)}
                    groupIndex={idx}
                    isTotal
                    stickyTop={TOTAL_ROW_TOP(dual)}
                    stageDate={
                      eachDate || remainDate
                        ? (stage, team, which) => stageDates.col(block.kind, rg, stage, team, which)
                        : undefined
                    }
                  />
                  {showHoDate && (
                    <HoCell
                      value={hoDates.col(block.kind, rg)}
                      groupIndex={idx}
                      isTotal
                      stickyTop={TOTAL_ROW_TOP(dual)}
                    />
                  )}
                </Fragment>
              ))}
              <TeamCells
                dual={dual}
                stats={block.blockTotal}
                mode={mode}
                onCell={(slot, team) => goCell(null, null, "__ROW_TOTAL__", slot, team)}
                groupIndex={block.columnKeys.length}
                isTotal
                stickyTop={TOTAL_ROW_TOP(dual)}
                stageDate={
                  eachDate || remainDate
                    ? (stage, team, which) => stageDates.block(block.kind, stage, team, which)
                    : undefined
                }
              />
              {showHoDate && (
                <HoCell
                  value={hoDates.block(block.kind)}
                  groupIndex={block.columnKeys.length}
                  isTotal
                  stickyTop={TOTAL_ROW_TOP(dual)}
                />
              )}
            </tr>
            {groups.map((grp) => (
              <FragmentRows
                key={grp.building}
                group={grp}
                block={block}
                buildingParam={buildingParam}
                    mode={mode}
                onNavigate={onNavigate}
                goCell={goCell}
                srcB={srcB}
                srcL={srcL}
                showHoDate={showHoDate}
                hoDates={hoDates}
                eachDate={eachDate}
                stageDates={stageDates}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRows({
  group,
  block,
  buildingParam,
  mode,
  onNavigate,
  goCell,
  srcB,
  srcL,
  showHoDate,
  hoDates,
  eachDate,
  stageDates,
}: {
  group: { building: string; rows: MatrixBlock["rows"]; subtotal: Stats };
  block: MatrixBlock;
  buildingParam: Record<string, string>;
  mode: MatrixMode;
  onNavigate: (p: Record<string, string>) => void;
  goCell: (
    b: string | null,
    l: string | null,
    c: string,
    slot: StatusSlot,
    team: TeamKey,
  ) => void;
  srcB: (label: string) => string;
  srcL: (label: string) => string;
  showHoDate: boolean;
  hoDates: HoDateMap;
  eachDate: boolean;
  stageDates: StageDateMap;
}) {
  const showBuildingSubtotal = block.kind === "podium" && group.rows.length > 1;
  return (
    <>
      {group.rows.map((r, idx) => (
        <tr key={`${r.building}::${r.levelDisp}`} className="hover:bg-muted/20">
          {idx === 0 && (
            <td
              rowSpan={group.rows.length + (showBuildingSubtotal ? 1 : 0)}
              className="sticky left-0 z-10 border-b border-r bg-card px-2 py-1 align-top text-[11px] font-medium"
              style={{ background: "var(--card)" }}
            >
              <button
                type="button"
                onClick={() => {
                  const p: Record<string, string> =
                    block.kind === "unassigned" ? { ...buildingParam } : { building: srcB(r.building) };
                  onNavigate(p);
                }}
                className="hover:text-primary"
              >
                {r.building}
              </button>
            </td>
          )}
          <td
            className="sticky left-[100px] z-10 border-b border-r bg-card px-2 py-1 text-[11px]"
            style={{ background: "var(--card)" }}
          >
            <button
              type="button"
              onClick={() => {
                const p: Record<string, string> =
                  block.kind === "unassigned" ? { ...buildingParam } : { building: srcB(r.building) };
                // LG · LIFT CABIN 블록 행 라벨은 level_name 이 아니므로 level 필터 제외
                if (block.kind === "liftcabin") p.room = r.levelDisp === "N/A" ? "__EMPTY__" : r.levelDisp;
                else if (block.kind !== "lg") p.level = srcL(r.levelDisp);
                onNavigate(p);
              }}
              className="hover:text-primary"
            >
              {r.levelDisp}
            </button>
          </td>
          {block.columnKeys.map((rg, gIdx) => (
            <Fragment key={rg}>
              <TeamCells
                dual={dual}
                stats={r.cells[rg]}
                mode={mode}
                onCell={(slot, team) => goCell(r.building, r.levelDisp, rg, slot, team)}
                dim={r.cells[rg].issued === 0}
                groupIndex={gIdx}
                stageDate={
                  eachDate || remainDate
                    ? (stage, team, which) =>
                        stageDates.cell(block.kind, r.building, r.levelDisp, rg, stage, team, which)
                    : undefined
                }
              />
              {showHoDate && (
                <HoCell
                  value={hoDates.cell(block.kind, r.building, r.levelDisp, rg)}
                  groupIndex={gIdx}
                />
              )}
            </Fragment>
          ))}
          <TeamCells
            dual={dual}
            stats={r.rowTotal}
            mode={mode}
            onCell={(slot, team) => goCell(r.building, r.levelDisp, "__ROW_TOTAL__", slot, team)}
            groupIndex={block.columnKeys.length}
            isTotal
            stageDate={
              eachDate || remainDate
                ? (stage, team, which) =>
                    stageDates.row(block.kind, r.building, r.levelDisp, stage, team, which)
                : undefined
            }
          />
          {showHoDate && (
            <HoCell
              value={hoDates.row(block.kind, r.building, r.levelDisp)}
              groupIndex={block.columnKeys.length}
              isTotal
            />
          )}
        </tr>
      ))}
      {showBuildingSubtotal && (
        <tr className="bg-muted/30 font-medium">
          <td
            className="sticky left-[100px] z-10 border-b border-r bg-muted/40 px-2 py-1 text-[11px]"
            style={{ background: "color-mix(in oklab, var(--muted) 60%, var(--card))" }}
          >
            {group.building} 소계
          </td>
          {block.columnKeys.map((rg, gIdx) => {
            const sub = newStats();
            for (const r of group.rows) mergeStats(sub, r.cells[rg]);
            let colMax: string | null = null;
            if (showHoDate) {
              for (const r of group.rows) {
                const v = hoDates.cell(block.kind, r.building, r.levelDisp, rg);
                if (v && (!colMax || v > colMax)) colMax = v;
              }
            }
            return (
              <Fragment key={rg}>
                <TeamCells
                  dual={dual}
                  stats={sub}
                  mode={mode}
                  onCell={(slot, team) => goCell(group.building, null, rg, slot, team)}
                  groupIndex={gIdx}
                  stageDate={
                    eachDate || remainDate
                      ? (stage, team, which) =>
                          stageDates.buildingCol(block.kind, group.building, rg, stage, team, which)
                      : undefined
                  }
                />
                {showHoDate && <HoCell value={colMax} groupIndex={gIdx} emphasize />}
              </Fragment>
            );
          })}
          <TeamCells
            dual={dual}
            stats={group.subtotal}
            mode={mode}
            onCell={(slot, team) => goCell(group.building, null, "__BUILDING_SUBTOTAL__", slot, team)}
            groupIndex={block.columnKeys.length}
            isTotal
            stageDate={
              eachDate || remainDate
                ? (stage, team, which) =>
                    stageDates.building(block.kind, group.building, stage, team, which)
                : undefined
            }
          />
          {showHoDate && (
            <HoCell
              value={hoDates.building(block.kind, group.building)}
              groupIndex={block.columnKeys.length}
              isTotal
            />
          )}
        </tr>
      )}
    </>
  );
}
