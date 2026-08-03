import { supabase } from "@/integrations/supabase/client";

/** Fetch all rows for a given upload_id in pages (Supabase caps at 1000/req). */
export async function fetchAllByUploadId<T>(
  table: string,
  columns: string,
  uploadId: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns)
      .eq("upload_id", uploadId)
      .order("processed_at", { ascending: true })
      .range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** import_field_logs 전용 페이지네이션 조회 (1,000행 상한 우회). */
export async function fetchAllFieldLogs<T>(
  uploadId: string,
  kind: string,
  columns: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await (supabase as any)
      .from("import_field_logs")
      .select(columns)
      .eq("upload_id", uploadId)
      .eq("kind", kind)
      .order("raw_row_no", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}