
REVOKE EXECUTE ON FUNCTION public.tm_thresholds() FROM anon;

DO $do$
DECLARE
  r record;
  src text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tm_items_search','tm_items_search_ids','tm_items_facets','tm_items_counts','tm_kpi_judgment')
  LOOP
    src := pg_get_functiondef(r.oid);
    src := replace(src,
      'COALESCE((_thresholds->>''worsen_gap'')::numeric, -0.15)',
      'public.tm_resolve_worsen((_thresholds->>''worsen_gap'')::numeric)');
    src := replace(src,
      'COALESCE((_thresholds->>''caution_gap_buffer'')::numeric, 0.05)',
      'public.tm_resolve_caution((_thresholds->>''caution_gap_buffer'')::numeric)');
    src := replace(src, '_caution_buffer numeric DEFAULT 0.05',
      '_caution_buffer numeric DEFAULT NULL::numeric');
    src := replace(src, '_worsen_gap numeric DEFAULT ''-0.15''::numeric',
      '_worsen_gap numeric DEFAULT NULL::numeric');
    src := replace(src, 'COALESCE(_worsen_gap, -0.15)', 'public.tm_resolve_worsen(_worsen_gap)');
    src := replace(src, 'COALESCE(_caution_buffer, 0.05)', 'public.tm_resolve_caution(_caution_buffer)');
    -- tm_kpi_judgment 는 IMMUTABLE 이었으나 설정 조회를 위해 STABLE 로 완화
    src := replace(src, E' IMMUTABLE\n', E' STABLE\n');
    EXECUTE src;
  END LOOP;
END
$do$;
