create or replace function public.abd_items_by_numbers(_nums text[])
returns setof public.abd_items_raw
language sql
stable
security definer
set search_path = public
as $$
  select * from public.abd_items_raw where abd_number = any(_nums)
$$;

grant execute on function public.abd_items_by_numbers(text[]) to authenticated, service_role;