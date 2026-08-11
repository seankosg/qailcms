CREATE INDEX IF NOT EXISTS spl_document_pages_norm_trgm_idx ON public.spl_document_pages USING gin (normalized_text gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.spl_document_pages_search(
  _q text,
  _document_id uuid DEFAULT NULL,
  _spl_item_id uuid DEFAULT NULL,
  _limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _needle text := lower(btrim(coalesce(_q, '')));
  _rows jsonb;
  _total int;
BEGIN
  IF length(_needle) < 2 THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'total_count', 0, 'query', _needle);
  END IF;

  WITH base AS (
    SELECT p.document_id,
           p.page_number,
           p.extracted_text,
           p.normalized_text,
           d.document_number,
           d.revision,
           d.title
    FROM public.spl_document_pages p
    JOIN public.spl_documents d ON d.id = p.document_id
    WHERE coalesce(d.is_active, true)
      AND (_document_id IS NULL OR p.document_id = _document_id)
      AND (_spl_item_id IS NULL OR EXISTS (
            SELECT 1 FROM public.spl_document_item_links l
            WHERE l.document_id = p.document_id AND l.spl_item_id = _spl_item_id))
      AND p.normalized_text LIKE '%' || _needle || '%'
  ), counted AS (
    SELECT count(*)::int AS n FROM base
  ), page AS (
    SELECT b.*,
           (length(b.normalized_text) - length(replace(b.normalized_text, _needle, '')))
             / greatest(length(_needle), 1) AS hit_count,
           substring(
             b.extracted_text
             from greatest(strpos(lower(b.extracted_text), _needle) - 90, 1)
             for 260
           ) AS snippet
    FROM base b
    ORDER BY b.document_number, b.page_number
    LIMIT greatest(coalesce(_limit, 50), 1)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(page.*) - 'extracted_text' - 'normalized_text'), '[]'::jsonb),
         (SELECT n FROM counted)
  INTO _rows, _total
  FROM page;

  RETURN jsonb_build_object('rows', coalesce(_rows, '[]'::jsonb), 'total_count', coalesce(_total, 0), 'query', _needle);
END;
$$;

GRANT EXECUTE ON FUNCTION public.spl_document_pages_search(text, uuid, uuid, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.spl_document_pages_search(text, uuid, uuid, int) FROM anon;