/**
 * Storage/Admin 접근 어댑터. 엔진은 이 최소 인터페이스만 사용한다:
 *   list(bucket, prefix, {limit, offset}) -> entries[]
 *   download(bucket, path) -> Uint8Array | AsyncIterable
 */
import { createClient } from "@supabase/supabase-js";

export function makeSupabaseStorageClient({ url, serviceRoleKey }) {
  const sb = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    raw: sb,
    async list(bucket, prefix, { limit, offset }) {
      const { data, error } = await sb.storage.from(bucket).list(prefix, { limit, offset });
      if (error) throw new Error(`목록 조회 실패 (${bucket}/${prefix}): ${error.message}`);
      return data ?? [];
    },
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path);
      if (error) throw new Error(`다운로드 실패 (${bucket}/${path}): ${error.message}`);
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    },
    async listUsers() {
      const users = [];
      for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw new Error(`사용자 목록 조회 실패: ${error.message}`);
        const batch = data?.users ?? [];
        users.push(
          ...batch.map((u) => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            providers: u.app_metadata?.providers ?? [],
          })),
        );
        if (batch.length < 200) break;
      }
      return { note: "참고자료입니다. 정본은 DB dump 의 auth 스키마입니다.", count: users.length, users };
    },
  };
}
