import { supabase } from "@/integrations/supabase/client";

const DELETE_CHUNK = 200;

export interface SplDeleteResult {
  requested: number;
  deleted: number;
  failed: number;
  blocked: number;
  /** 참조 무결성(연결된 RSP/OCS/문서)으로 막힌 행 수 */
  linked: number;
  firstError: string | null;
}

/**
 * SPL 원본 행 영구 삭제.
 * - 권한은 서버 RLS(`rcl_can(..., 'delete')`)가 정본이다. 차단된 행은 에러 없이 0행으로 돌아오므로
 *   요청 수 대비 반환 수 차이를 `blocked` 로 계산한다.
 * - RSP / OCS 링크 / 문서 링크는 FK RESTRICT 이므로 연결이 있으면 삭제가 실패한다(23503).
 */
export async function applySplBulkHardDelete(ids: string[]): Promise<SplDeleteResult> {
  let deleted = 0;
  let failed = 0;
  let linked = 0;
  let firstError: string | null = null;

  const runOne = async (id: string) => {
    const { data, error } = await (supabase as any)
      .from("spl_items")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      failed += 1;
      if ((error as any).code === "23503") linked += 1;
      if (!firstError) firstError = error.message;
      return;
    }
    deleted += (data ?? []).length;
  };

  for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
    const slice = ids.slice(i, i + DELETE_CHUNK);
    const { data, error } = await (supabase as any)
      .from("spl_items")
      .delete()
      .in("id", slice)
      .select("id");
    if (error) {
      // 청크 중 한 행이라도 FK 로 막히면 청크 전체가 실패한다 → 행 단위로 재시도해 원인 행만 남긴다.
      for (const id of slice) {
        // eslint-disable-next-line no-await-in-loop
        await runOne(id);
      }
      continue;
    }
    deleted += (data ?? []).length;
  }

  return {
    requested: ids.length,
    deleted,
    failed,
    linked,
    blocked: Math.max(0, ids.length - deleted - failed),
    firstError,
  };
}
