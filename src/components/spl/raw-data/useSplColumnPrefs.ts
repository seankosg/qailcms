import { useEffect, useMemo, useState } from "react";
import { useUserViewPreference } from "@/hooks/useUserViewPreference";
import {
  SPL_COLUMNS,
  SPL_DEFAULT_ORDER,
  SPL_DEFAULT_VISIBILITY,
  buildSplStageColumns,
  type SplColumnDef,
  type SplStageColumn,
} from "./spl-columns";
import type { SplCatalogEntry } from "@/lib/spl/rows.functions";

/**
 * Raw Data 컬럼 설정(순서·표시·고정·폭)의 단일 소스.
 * Progress 의 Stage Detail Panel 이 Raw Data 와 같은 키를 공유하므로
 * 노출 컬럼·순서·고정이 두 화면에서 항상 동일하다.
 */
export function useSplColumnPrefs(
  catalog: SplCatalogEntry[],
  viewKey = "spl.raw-data.v1",
) {
  const viewPref = useUserViewPreference(viewKey);
  const [order, setOrder] = useState<string[]>(SPL_DEFAULT_ORDER);
  const [visibility, setVisibility] = useState<Record<string, boolean>>(SPL_DEFAULT_VISIBILITY);
  const [frozenExtras, setFrozenExtras] = useState<string[]>(["spl_number"]);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [stateLoaded, setStateLoaded] = useState(false);

  useEffect(() => {
    if (!viewPref.ready || stateLoaded) return;
    const s = (viewPref.state ?? {}) as any;
    if (Array.isArray(s.order)) {
      const legacyStages = Array.isArray(s.stageOrder)
        ? s.stageOrder.filter((k: unknown) => typeof k === "string" && k.startsWith("stage:"))
        : [];
      const kept = [...s.order, ...legacyStages].filter(
        (k: unknown, index: number, all: unknown[]) =>
          typeof k === "string" &&
          (SPL_DEFAULT_ORDER.includes(k) || k.startsWith("stage:")) &&
          all.indexOf(k) === index,
      ) as string[];
      setOrder([...kept, ...SPL_DEFAULT_ORDER.filter((k) => !kept.includes(k))]);
    }
    if (s.visibility && typeof s.visibility === "object") {
      setVisibility({ ...SPL_DEFAULT_VISIBILITY, ...s.visibility, ...(s.stageVisibility ?? {}) });
    }
    if (Array.isArray(s.frozenExtras)) {
      setFrozenExtras(
        s.frozenExtras.filter(
          (k: unknown) => typeof k === "string" && (SPL_DEFAULT_ORDER.includes(k) || k.startsWith("stage:")),
        ),
      );
    }
    if (s.colWidths && typeof s.colWidths === "object") {
      const kept: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.colWidths as Record<string, unknown>)) {
        if (typeof v === "number" && v > 0 && (SPL_DEFAULT_ORDER.includes(k) || k.startsWith("stage:"))) kept[k] = v;
      }
      setColWidths(kept);
    }
    setStateLoaded(true);
  }, [viewPref.ready, viewPref.state, stateLoaded]);

  const stageCols = useMemo(() => buildSplStageColumns(catalog), [catalog]);
  const stageKeys = useMemo(() => stageCols.map((sc) => `stage:${sc.key}`), [stageCols]);
  useEffect(() => {
    if (!stateLoaded || stageKeys.length === 0) return;
    setOrder((prev) => [...prev, ...stageKeys.filter((key) => !prev.includes(key))]);
  }, [stageKeys, stateLoaded]);

  const stageColMap = useMemo(
    () => new Map<string, SplStageColumn>(stageCols.map((sc) => [`stage:${sc.key}`, sc])),
    [stageCols],
  );
  const colDefMap = useMemo(() => new Map(SPL_COLUMNS.map((c) => [c.key, c] as const)), []);
  const allColumnItems = useMemo(
    () => [
      ...SPL_COLUMNS.map((c) => ({ key: c.key, label: c.label })),
      ...stageCols.map((sc) => ({ key: `stage:${sc.key}`, label: sc.code, title: sc.title })),
    ],
    [stageCols],
  );

  /** 표시 컬럼 배치 — Raw Data 와 같은 모델(고정 → 나머지) */
  const layout = useMemo(() => {
    const visibleOrder = order.filter(
      (k) => visibility[k] !== false && (colDefMap.has(k) || stageColMap.has(k)),
    );
    const frozen = frozenExtras.filter((k) => visibleOrder.includes(k));
    const rest = visibleOrder.filter((k) => !frozen.includes(k));
    const items: Array<{
      key: string;
      def: SplColumnDef | null;
      stage: SplStageColumn | null;
      width: number;
      left: number | null;
    }> = [];
    let left = 0;
    for (const k of frozen) {
      const def = colDefMap.get(k) ?? null;
      const stage = stageColMap.get(k) ?? null;
      const w = colWidths[k] ?? def?.width ?? 84;
      items.push({ key: k, def, stage, width: w, left });
      left += w;
    }
    for (const k of rest) {
      const def = colDefMap.get(k) ?? null;
      const stage = stageColMap.get(k) ?? null;
      items.push({ key: k, def, stage, width: colWidths[k] ?? def?.width ?? 84, left: null });
    }
    return items;
  }, [order, visibility, frozenExtras, colDefMap, stageColMap, colWidths]);

  const persist = () => viewPref.save({ order, visibility, frozenExtras, colWidths } as any);

  return {
    order,
    setOrder,
    visibility,
    setVisibility,
    frozenExtras,
    setFrozenExtras,
    colWidths,
    setColWidths,
    stageCols,
    stageColMap,
    colDefMap,
    allColumnItems,
    layout,
    persist,
    stateLoaded,
  };
}
