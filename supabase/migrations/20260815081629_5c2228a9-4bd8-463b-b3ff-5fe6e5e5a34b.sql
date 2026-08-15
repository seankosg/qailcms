create or replace function public.org_demob_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'system_administrator')
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and coalesce(nullif(trim(p.hdec_pic_name),''), trim(p.name))
              in ('신원재','채홍욱','성영광','김영서','김대수','정경호','고현봉')
      );
$$;

grant execute on function public.org_demob_can_view() to authenticated;