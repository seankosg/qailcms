-- Progress cells (그룹×버킷×스테이지)
CREATE OR REPLACE FUNCTION public.abd_progress_cells_json(
  _plots text[],
  _teams text[],
  _group_by text[],
  _bucket text,
  _range_start date,
  _range_end date,
  _as_of_date date,
  _plan_mode text,
  _round text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.abd_progress_cells(
    _plots, _teams, _group_by, _bucket, _range_start, _range_end,
    _as_of_date, _plan_mode, _round
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.abd_progress_totals_json(
  _plots text[],
  _teams text[],
  _group_by text[],
  _as_of_date date,
  _plan_mode text,
  _round text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.abd_progress_totals(
    _plots, _teams, _group_by, _as_of_date, _plan_mode, _round
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_row1_json(
  _plots text[],
  _teams text[],
  _batch_no text[]
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.abd_dashboard_row1(_plots, _teams, _batch_no) t;
$$;

CREATE OR REPLACE FUNCTION public.abd_dashboard_row2_json(
  _plots text[],
  _teams text[],
  _batch_no text[]
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.abd_dashboard_row2(_plots, _teams, _batch_no) t;
$$;

GRANT EXECUTE ON FUNCTION public.abd_progress_cells_json(text[],text[],text[],text,date,date,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_progress_totals_json(text[],text[],text[],date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row1_json(text[],text[],text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abd_dashboard_row2_json(text[],text[],text[]) TO authenticated;