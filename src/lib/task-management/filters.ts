import type { Row } from "@tanstack/react-table";
import { TM_SEARCH_FIELDS } from "./columns";
import {
  classifyAlarm,
  classifyFinish,
  classifyStart,
  type AlarmState,
  type StageState,
} from "@/components/task-management/raw-data/TaskStageProgress";

export const EMPTY_TOKEN = "__EMPTY__";

export const tokenizeAnd = (text: string): string[] =>
  String(text ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

export const matchesAllTokens = (haystack: string, query: string): boolean => {
  const tokens = tokenizeAnd(query);
  if (tokens.length === 0) return true;
  const lower = String(haystack ?? "").toLowerCase();
  return tokens.every((tok) => lower.includes(tok));
};

export const multiSelectFilterFn = (row: Row<any>, columnId: string, filterValue: string[]) => {
  if (!filterValue || filterValue.length === 0) return true;
  const val = row.getValue(columnId);
  const isEmpty = val == null || val === "";
  if (filterValue.includes(EMPTY_TOKEN) && isEmpty) return true;
  if (isEmpty) return false;
  return filterValue.includes(String(val));
};

export const textFilterFn = (row: Row<any>, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const text = typeof filterValue === "string" ? filterValue : filterValue?.text;
  const emptyOnly = typeof filterValue === "object" ? filterValue?.emptyOnly : false;
  const val = row.getValue(columnId);
  if (emptyOnly) return val == null || String(val).trim() === "";
  if (!text) return true;
  if (val == null) return false;
  return matchesAllTokens(String(val), String(text));
};

export const dateRangeFilterFn = (row: Row<any>, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const { from, to, emptyOnly } = filterValue;
  const val = row.getValue(columnId) as string | null;
  if (emptyOnly) return val == null || val === "";
  if (!from && !to) return true;
  if (!val) return false;
  const iso = String(val).slice(0, 10);
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
};

export const numberRangeFilterFn = (row: Row<any>, columnId: string, filterValue: any) => {
  if (!filterValue) return true;
  const { min, max, emptyOnly } = filterValue;
  const raw = row.getValue(columnId);
  const isEmpty = raw == null || raw === "" || (typeof raw === "number" && Number.isNaN(raw));
  if (emptyOnly) return isEmpty;
  if (min == null && max == null) return true;
  if (isEmpty) return false;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (Number.isNaN(num)) return false;
  if (min != null && num < min) return false;
  if (max != null && num > max) return false;
  return true;
};

export interface StageProgressFilterValue {
  start?: StageState[];
  alarm?: AlarmState[];
  finish?: StageState[];
}

export const stageProgressFilterFn = (
  row: Row<any>,
  _columnId: string,
  filterValue: StageProgressFilterValue | undefined,
) => {
  if (!filterValue) return true;
  const { start, alarm, finish } = filterValue;
  const anySelected =
    (start && start.length > 0) ||
    (alarm && alarm.length > 0) ||
    (finish && finish.length > 0);
  if (!anySelected) return true;
  const r = row.original as Record<string, unknown>;
  const dd = (r as any).data_date ?? null;
  if (start && start.length > 0) {
    const s = classifyStart(r, dd);
    if (!start.includes(s)) return false;
  }
  if (alarm && alarm.length > 0) {
    const a = classifyAlarm(r);
    if (!alarm.includes(a)) return false;
  }
  if (finish && finish.length > 0) {
    const f = classifyFinish(r, dd);
    if (!finish.includes(f)) return false;
  }
  return true;
};

export const globalSearchFilterFn = (row: Row<any>, _columnId: string, filterValue: string) => {
  if (tokenizeAnd(filterValue).length === 0) return true;
  const original = row.original as Record<string, unknown>;
  return TM_SEARCH_FIELDS.some((field) => matchesAllTokens(String(original[field] ?? ""), filterValue));
};