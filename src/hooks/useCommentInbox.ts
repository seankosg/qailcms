import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertNoTruncation } from "@/lib/data/assertNoSilentTruncation";

export type InboxModule = "tm" | "sm" | "abd" | "sp";

export interface InboxComment {
  id: string;
  module: InboxModule;
  category: string | null;
  message: string;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  edited: boolean;
  parent_id: string; // task_raw_id / defect_raw_id / abd_item_id / doc_ref
  parent_ref: string | null; // 표시용 short id (task_no, source_issue_no, abd_number, doc_ref)
  parent_label: string | null; // 표시용 부제 (task_name, location_raw 등)
  author_is_vp_pd: boolean; // 작성자가 admin 역할이거나 user_type in (pm_pd) 일 때 true
}

interface InboxScope {
  userId: string | null | undefined;
  scope: "pic" | "team";
  filterValue: string | null; // hdec_pic_name 또는 team 이름
  isAdmin: boolean;
}

/** 각 모듈별 부모 ID 목록을 담당 기준으로 조회. Admin이면 null 반환(= 전체). */
async function fetchOwnedParentIds(scope: InboxScope) {
  const { isAdmin, filterValue, scope: mode, userId } = scope;

  async function idsFrom<T extends string>(
    table: T,
    idCol: string,
    labelCols: string,
    filter: (q: any) => any,
  ): Promise<Array<Record<string, any>>> {
    // range 루프 표준안: offset += batch.length. 종료 조건: batch.length < CHUNK.
    // 이전 .limit(5000) 은 PostgREST 상한(1,000)에 먼저 잘려 조용한 데이터 손실 발생.
    const CHUNK = 1000;
    const MAX_ITER = 50; // 안전선: 최대 50,000행
    const collected: any[] = [];
    let offset = 0;
    let iter = 0;
    // count는 정확도 위해 exact. 최대 1회만 요청.
    let total: number | null = null;
    while (true) {
      if (++iter > MAX_ITER) {
        throw new Error(`useCommentInbox idsFrom(${table}) 청크 루프 상한 초과`);
      }
      let q = (supabase as any)
        .from(table)
        .select(`${idCol},${labelCols}`, iter === 1 ? { count: "exact" } : undefined)
        .range(offset, offset + CHUNK - 1);
      q = filter(q);
      const { data, error, count } = await q;
      if (error) throw error;
      const batch = (data ?? []) as any[];
      if (iter === 1 && typeof count === "number") total = count;
      collected.push(...batch);
      if (batch.length < CHUNK) break;
      offset += batch.length;
    }
    assertNoTruncation(`useCommentInbox.idsFrom(${table})`, collected, total);
    return collected;
  }

  // R4: 4개 모듈 부모 ID 조회 병렬화 (Promise.all).
  const [tmParents, smParents, abdParents, spParents] = await Promise.all([
    isAdmin ? Promise.resolve(null) : idsFrom("task_management_raw", "id", "task_no,task_name", (q) =>
      mode === "team" ? q.eq("team", filterValue) : q.eq("hdec_pic_name", filterValue),
    ),
    isAdmin ? Promise.resolve(null) : idsFrom("defect_items_raw", "id", "source_issue_no,location_raw", (q) =>
      mode === "team" ? q.eq("team", filterValue) : q.eq("hdec_pic_name", filterValue),
    ),
    isAdmin ? Promise.resolve(null) : idsFrom("abd_items_raw", "id", "abd_number,document_title", (q) =>
      mode === "team" ? q.eq("team", filterValue) : q.eq("hdec_pic_name", filterValue),
    ),
    isAdmin ? Promise.resolve(null) : idsFrom("spare_parts_raw", "doc_ref", "subject,plot", (q) =>
      mode === "team" ? q.eq("team", filterValue) : q.eq("owner_user_id", userId ?? "__none__"),
    ),
  ]);

  const map = (rows: Array<Record<string, any>> | null, idKey: string, refKey: string, labelKey: string) => {
    if (!rows) return null;
    const m = new Map<string, { ref: string | null; label: string | null }>();
    for (const r of rows) {
      m.set(String(r[idKey]), {
        ref: r[refKey] != null ? String(r[refKey]) : null,
        label: r[labelKey] != null ? String(r[labelKey]) : null,
      });
    }
    return m;
  };

  return {
    tm: map(tmParents, "id", "task_no", "task_name"),
    sm: map(smParents, "id", "source_issue_no", "location_raw"),
    abd: map(abdParents, "id", "abd_number", "document_title"),
    sp: map(spParents, "doc_ref", "subject", "plot"),
  };
}

async function fetchComments(scope: InboxScope, limit: number): Promise<InboxComment[]> {
  const parents = await fetchOwnedParentIds(scope);

  async function loadTable(
    table: string,
    parentCol: string,
    messageCol: string,
    categoryCol: string | null,
    mod: InboxModule,
    parentMap: Map<string, { ref: string | null; label: string | null }> | null,
  ): Promise<InboxComment[]> {
    if (parentMap && parentMap.size === 0) return [];
    // spare_part_comments 는 author_id, edited 컬럼 없음. 그 외는 author_user_id/edited 존재.
    const isSp = table === "spare_part_comments";
    const authorCol = isSp ? "author_id" : "author_user_id";
    const colList = ["id", parentCol, messageCol];
    if (categoryCol) colList.push(categoryCol);
    colList.push(authorCol);
    if (!isSp) colList.push("edited");
    colList.push("created_at", "updated_at");
    const cols = colList.join(",");
    if (parentMap) {
      const ids = Array.from(parentMap.keys());
      if (ids.length === 0) return [];
      // Supabase URL 길이 제한 회피용 slicing
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
      const all: any[] = [];
      for (const c of chunks) {
        const { data, error } = await (supabase as any)
          .from(table)
          .select(cols)
          .in(parentCol, c)
          .order("updated_at", { ascending: false })
          .limit(limit);
        if (error) throw error;
        all.push(...(data ?? []));
      }
      return normalize(all, parentCol, messageCol, categoryCol, mod, parentMap);
    }
    // Admin: 전체 댓글을 페이지네이션으로 모두 조회 (테이블당 limit 제한 없음)
    const pageSize = 1000;
    const all: any[] = [];
    let from = 0;
    // 안전 상한: 100,000건
    while (from < 100_000) {
      const { data, error } = await (supabase as any)
        .from(table)
        .select(cols)
        .order("updated_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const chunk = data ?? [];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return normalize(all, parentCol, messageCol, categoryCol, mod, parentMap);
  }

  function normalize(
    rows: any[],
    parentCol: string,
    messageCol: string,
    categoryCol: string | null,
    mod: InboxModule,
    parentMap: Map<string, { ref: string | null; label: string | null }> | null,
  ): InboxComment[] {
    return rows.map((r) => {
      const pid = String(r[parentCol]);
      const meta = parentMap?.get(pid) ?? null;
      return {
        id: String(r.id),
        module: mod,
        category: categoryCol ? (r[categoryCol] ?? null) : null,
        message: String(r[messageCol] ?? ""),
        author_user_id: r.author_user_id ?? r.author_id ?? null,
        author_name: null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        edited: !!r.edited,
        parent_id: pid,
        parent_ref: meta?.ref ?? null,
        parent_label: meta?.label ?? null,
        author_is_vp_pd: false,
      };
    });
  }

  const [tm, sm, abd, sp] = await Promise.all([
    loadTable("task_comments", "task_raw_id", "message", "category", "tm", parents.tm),
    loadTable("defect_comments", "defect_raw_id", "message", "category", "sm", parents.sm),
    loadTable("abd_comments", "abd_item_id", "message", "category", "abd", parents.abd),
    loadTable("spare_part_comments", "doc_ref", "body", null, "sp", parents.sp),
  ]);

  const all = [...tm, ...sm, ...abd, ...sp].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

  // Admin: 부모 메타(parent_ref/label)가 비어있는 항목들을 뒤에서 채워줌
  async function enrichParents(
    mod: InboxModule,
    table: string,
    idCol: string,
    refCol: string,
    labelCol: string,
  ) {
    const need = all.filter((c) => c.module === mod && (!c.parent_ref || !c.parent_label));
    if (need.length === 0) return;
    const ids = Array.from(new Set(need.map((c) => c.parent_id)));
    const m = new Map<string, { ref: string | null; label: string | null }>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data, error } = await (supabase as any)
        .from(table)
        .select(`${idCol},${refCol},${labelCol}`)
        .in(idCol, chunk);
      if (error) continue;
      for (const r of data ?? []) {
        m.set(String(r[idCol]), {
          ref: r[refCol] != null ? String(r[refCol]) : null,
          label: r[labelCol] != null ? String(r[labelCol]) : null,
        });
      }
    }
    for (const c of need) {
      const meta = m.get(c.parent_id);
      if (meta) {
        c.parent_ref = meta.ref;
        c.parent_label = meta.label;
      }
    }
  }
  await Promise.all([
    enrichParents("tm", "task_management_raw", "id", "task_no", "task_name"),
    enrichParents("sm", "defect_items_raw", "id", "source_issue_no", "location_raw"),
    enrichParents("abd", "abd_items_raw", "id", "abd_number", "document_title"),
    enrichParents("sp", "spare_parts_raw", "doc_ref", "subject", "plot"),
  ]);

  // 작성자 이름 해석
  const authorIds = Array.from(new Set(all.map((x) => x.author_user_id).filter(Boolean))) as string[];
  if (authorIds.length > 0) {
    const { data: profs } = await (supabase as any)
      .from("profiles")
      .select("id,name,display_name,login_id,user_type")
      .in("id", authorIds);
    const nm = new Map<string, string>();
    const typeMap = new Map<string, string | null>();
    for (const p of profs ?? []) {
      nm.set(String(p.id), p.name ?? p.display_name ?? p.login_id ?? "user");
      typeMap.set(String(p.id), (p.user_type ?? null) as string | null);
    }
    for (const c of all) {
      if (c.author_user_id) {
        c.author_name = nm.get(c.author_user_id) ?? null;
        const t = typeMap.get(c.author_user_id);
        c.author_is_vp_pd = t === "admin" || t === "pm_pd";
      }
    }
  }

  return all;
}

export function useCommentInbox(scope: InboxScope, limitPerTable = 100) {
  const qc = useQueryClient();
  const key = ["mws-comment-inbox", scope.userId, scope.scope, scope.filterValue, scope.isAdmin] as const;

  const query = useQuery({
    queryKey: key,
    enabled: !!scope.userId && (scope.isAdmin || !!scope.filterValue),
    staleTime: 30_000,
    queryFn: () => fetchComments(scope, limitPerTable),
  });

  // Realtime 구독 (4개 댓글 테이블 변경 시 무효화)
  useEffect(() => {
    if (!scope.userId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => qc.invalidateQueries({ queryKey: key.slice(0, 1) as any }), 500);
    };
    const channel = supabase
      .channel(`mws-comments-${scope.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "defect_comments" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "abd_comments" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "spare_part_comments" }, invalidate)
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.userId]);

  return query;
}