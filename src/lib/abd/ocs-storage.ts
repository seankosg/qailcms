import { supabase } from "@/integrations/supabase/client";

/** 로그인 사용자 client 로 private bucket 을 재귀 조회해 정확한 object path 집합을 만든다. */
export async function listBucketPaths(bucket: string, roots: string[]): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = (roots.length ? roots : [""]).slice();
  const seen = new Set<string>();

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    let offset = 0;

    for (;;) {
      const { data: items, error } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(error.message);
      const list = items ?? [];
      for (const it of list) {
        const path = prefix ? `${prefix}/${it.name}` : it.name;
        if ((it as { id?: string | null }).id) out.push(path);
        else queue.push(path);
      }
      if (list.length < 1000) break;
      offset += list.length;
    }
  }
  return out;
}
