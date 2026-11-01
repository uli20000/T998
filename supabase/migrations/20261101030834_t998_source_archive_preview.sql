-- T998 original workbook archive. No cleanup jobs or existing-data mutations.
create table public.t998_score_source_archives(
 id uuid primary key default gen_random_uuid(),
 report_type text not null check(report_type in ('ByOrder','ByDate')),
 storage_path text not null unique,
 source_file text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 file_size bigint not null check(file_size between 1 and 52428800),
 period_start date not null,period_end date not null check(period_end>=period_start),
 row_count integer not null check(row_count>0),
 uploaded_by uuid not null default auth.uid() references auth.users(id),
 uploaded_at timestamptz not null default now(),
 status text not null default 'archived' check(status in ('archived','imported','partial')),
 last_error text not null default '',
 check(storage_path like '998/'||report_type||'/'||sha256||'.%')
);
alter table public.t998_score_source_archives enable row level security;
grant select,insert,update on public.t998_score_source_archives to authenticated;
create policy t998_archive_admin_read on public.t998_score_source_archives for select to authenticated using(public.is_admin());
create policy t998_archive_admin_insert on public.t998_score_source_archives for insert to authenticated with check(public.is_admin() and uploaded_by=auth.uid());
create policy t998_archive_admin_update on public.t998_score_source_archives for update to authenticated using(public.is_admin()) with check(public.is_admin());
insert into storage.buckets(id,name,public,file_size_limit) values('t998-score-source-archive','t998-score-source-archive',false,52428800);
create policy t998_archive_objects_read on storage.objects for select to authenticated using(bucket_id='t998-score-source-archive' and name like '998/%' and public.is_admin());
create policy t998_archive_objects_insert on storage.objects for insert to authenticated with check(bucket_id='t998-score-source-archive' and name like '998/%' and public.is_admin());
-- Deliberately no UPDATE/DELETE object policy, retention, or cron.
