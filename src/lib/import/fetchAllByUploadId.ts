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