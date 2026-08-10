
create or replace function public.abd_ocs_can_manage(_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.has_role(_uid, 'admin'), false)
      or exists (
        select 1 from public.profiles p
        where p.id = _uid and p.user_type = 'hdec_pic' and p.team = 'DESN'
      )
$$;

grant execute on function public.abd_ocs_can_manage(uuid) to authenticated, service_role;

create or replace function public.abd_ocs_assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.abd_ocs_can_manage(auth.uid()) then
    raise exception 'admin only';
  end if;
end $$;

-- public schema policies
drop policy if exists abd_ocs_att_link_admin_write on public.abd_ocs_attachment_comment_links;
create policy abd_ocs_att_link_admin_write on public.abd_ocs_attachment_comment_links
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists abd_ocs_attachments_admin_insert on public.abd_ocs_attachments;
create policy abd_ocs_attachments_admin_insert on public.abd_ocs_attachments
  for insert with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_attachments_admin_update on public.abd_ocs_attachments;
create policy abd_ocs_attachments_admin_update on public.abd_ocs_attachments
  for update using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_attachments_select on public.abd_ocs_attachments;
create policy abd_ocs_attachments_select on public.abd_ocs_attachments
  for select using (
    public.abd_ocs_can_manage()
    or (link_status = 'linked' and comment_id is not null and public.abd_ocs_comment_visible(comment_id))
  );

drop policy if exists abd_ocs_comment_abd_links_admin_write on public.abd_ocs_comment_abd_links;
create policy abd_ocs_comment_abd_links_admin_write on public.abd_ocs_comment_abd_links
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists abd_ocs_groups_admin_write on public.abd_ocs_comment_groups;
create policy abd_ocs_groups_admin_write on public.abd_ocs_comment_groups
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_groups_read on public.abd_ocs_comment_groups;
create policy abd_ocs_groups_read on public.abd_ocs_comment_groups
  for select using (
    public.abd_ocs_can_manage()
    or exists (
      select 1 from public.abd_ocs_comments c
      where c.comment_group_id = abd_ocs_comment_groups.id and public.abd_ocs_comment_visible(c.id)
    )
  );

drop policy if exists abd_ocs_comments_admin_insert on public.abd_ocs_comments;
create policy abd_ocs_comments_admin_insert on public.abd_ocs_comments
  for insert with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_comments_admin_update on public.abd_ocs_comments;
create policy abd_ocs_comments_admin_update on public.abd_ocs_comments
  for update using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_comments_select on public.abd_ocs_comments;
create policy abd_ocs_comments_select on public.abd_ocs_comments
  for select using (
    public.abd_ocs_can_manage()
    or (is_active and abd_item_id is not null and link_status = 'linked'
        and public.rcl_can(auth.uid(), 'ABD', abd_item_id, 'read'))
  );

drop policy if exists abd_ocs_compliance_log_admin_insert on public.abd_ocs_compliance_log;
create policy abd_ocs_compliance_log_admin_insert on public.abd_ocs_compliance_log
  for insert with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_compliance_log_admin_select on public.abd_ocs_compliance_log;
create policy abd_ocs_compliance_log_admin_select on public.abd_ocs_compliance_log
  for select using (public.abd_ocs_can_manage());

drop policy if exists abd_ocs_import_logs_admin_insert on public.abd_ocs_import_logs;
create policy abd_ocs_import_logs_admin_insert on public.abd_ocs_import_logs
  for insert with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_import_logs_admin_select on public.abd_ocs_import_logs;
create policy abd_ocs_import_logs_admin_select on public.abd_ocs_import_logs
  for select using (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_import_logs_admin_update on public.abd_ocs_import_logs;
create policy abd_ocs_import_logs_admin_update on public.abd_ocs_import_logs
  for update using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists "admin manages ocs inc verify receipts" on public.abd_ocs_inc_verify_receipts;
create policy "admin manages ocs inc verify receipts" on public.abd_ocs_inc_verify_receipts
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists resp_links_admin_write on public.abd_ocs_response_comment_links;
create policy resp_links_admin_write on public.abd_ocs_response_comment_links
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists resp_segments_admin_write on public.abd_ocs_response_segments;
create policy resp_segments_admin_write on public.abd_ocs_response_segments
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists abd_ocs_source_files_admin_write on public.abd_ocs_source_files;
create policy abd_ocs_source_files_admin_write on public.abd_ocs_source_files
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

drop policy if exists abd_ocs_v3_stage_attachments_admin_all on public.abd_ocs_v3_stage_attachments;
create policy abd_ocs_v3_stage_attachments_admin_all on public.abd_ocs_v3_stage_attachments
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_v3_stage_comments_admin_all on public.abd_ocs_v3_stage_comments;
create policy abd_ocs_v3_stage_comments_admin_all on public.abd_ocs_v3_stage_comments
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_v3_stage_groups_admin_all on public.abd_ocs_v3_stage_groups;
create policy abd_ocs_v3_stage_groups_admin_all on public.abd_ocs_v3_stage_groups
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());
drop policy if exists abd_ocs_v3_stage_response_admin_all on public.abd_ocs_v3_stage_response;
create policy abd_ocs_v3_stage_response_admin_all on public.abd_ocs_v3_stage_response
  for all using (public.abd_ocs_can_manage()) with check (public.abd_ocs_can_manage());

-- storage object policies for OCS buckets
drop policy if exists "ocs imports admin select" on storage.objects;
create policy "ocs imports admin select" on storage.objects
  for select using (bucket_id = 'abd-ocs-imports' and public.abd_ocs_can_manage());
drop policy if exists "ocs imports admin insert" on storage.objects;
create policy "ocs imports admin insert" on storage.objects
  for insert with check (bucket_id = 'abd-ocs-imports' and public.abd_ocs_can_manage());

drop policy if exists abd_ocs_att_admin_insert on storage.objects;
create policy abd_ocs_att_admin_insert on storage.objects
  for insert with check (bucket_id = 'abd-ocs-attachments' and public.abd_ocs_can_manage());
drop policy if exists abd_ocs_att_read on storage.objects;
create policy abd_ocs_att_read on storage.objects
  for select using (
    bucket_id = 'abd-ocs-attachments' and (
      public.abd_ocs_can_manage()
      or exists (
        select 1 from public.abd_ocs_attachments a
        where a.storage_path = objects.name and a.link_status = 'linked'
          and a.comment_id is not null and public.abd_ocs_comment_visible(a.comment_id)
      )
      or exists (
        select 1 from public.abd_ocs_attachments a
        join public.abd_ocs_attachment_comment_links l on l.attachment_id = a.id
        where a.storage_path = objects.name and public.abd_ocs_comment_visible(l.comment_id)
      )
    )
  );

drop policy if exists abd_ocs_src_admin_insert on storage.objects;
create policy abd_ocs_src_admin_insert on storage.objects
  for insert with check (bucket_id = 'abd-ocs-source-files' and public.abd_ocs_can_manage());
drop policy if exists abd_ocs_src_read on storage.objects;
create policy abd_ocs_src_read on storage.objects
  for select using (
    bucket_id = 'abd-ocs-source-files' and (
      public.abd_ocs_can_manage()
      or exists (
        select 1 from public.abd_ocs_source_files f
        join public.abd_ocs_comments c on c.source_file_name = f.file_name
        where f.storage_path = objects.name and public.abd_ocs_comment_visible(c.id)
      )
    )
  );
