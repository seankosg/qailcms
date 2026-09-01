/**
 * 논리 DR 공개 API 공통 처리.
 * - 이 경로는 사이트 인증을 우회하므로 핸들러 안에서 반드시 DR 토큰을 검증한다.
 * - 오류 응답에는 토큰·키를 절대 싣지 않는다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { maskDrSecret } from "@/lib/backup/dr-export-contract";

export function drJsonError(code: string, message: string, status = 400) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

type Ctx = { admin: SupabaseClient<Database>; run: any; token: string };

export async function withDrToken(request: Request, fn: (ctx: Ctx) => Promise<Response>): Promise<Response> {
  let token = "";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mod = await import("@/lib/backup/dr-export.server");
    const auth = await mod.authenticateDrToken(supabaseAdmin as any, request);
    token = auth.token;
    return await fn({ admin: supabaseAdmin as any, run: auth.run, token });
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    return drJsonError(e.code ?? "DR_EXPORT_FAILED", maskDrSecret(e.message ?? "요청을 처리할 수 없습니다.", [token]), e.status ?? 500);
  }
}

/** Blob 을 스트리밍 응답으로 되돌린다(전체 버퍼 적재 금지). */
export function streamBlob(blob: Blob, filename: string, extraHeaders: Record<string, string> = {}) {
  return new Response(blob.stream(), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${filename.replace(/["\r\n]/g, "")}"`,
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
