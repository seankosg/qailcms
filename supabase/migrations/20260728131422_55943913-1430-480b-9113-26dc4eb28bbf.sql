DROP FUNCTION IF EXISTS public.tm_items_search(text, jsonb, jsonb, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.tm_items_search_ids(text, jsonb, boolean, integer);
DROP FUNCTION IF EXISTS public.tm_items_facets(text[], text, jsonb, boolean);