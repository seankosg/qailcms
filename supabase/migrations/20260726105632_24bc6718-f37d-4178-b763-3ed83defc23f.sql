DROP FUNCTION IF EXISTS public.abd_items_search(
  _team text,
  _status_group text,
  _include_inactive boolean,
  _q text,
  _filters jsonb,
  _sort jsonb,
  _offset integer,
  _limit integer,
  _plot text
);