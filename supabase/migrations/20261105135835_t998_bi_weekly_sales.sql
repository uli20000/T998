-- T998 weekly BI SSSG only. No T995 calendar or restaurant-scope exceptions.
create table public.t998_bi_weekly_sales (
 week_start date primary key,
 week_end date not null,
 source_file text not null check(length(source_file) between 1 and 255),
 source_sheet text not null check(length(source_sheet) between 1 and 31),
 source_row integer not null check(source_row>0),
 center_sssg numeric not null check(center_sssg::text not in ('NaN','Infinity','-Infinity')),
 stores jsonb not null check(jsonb_typeof(stores)='array' and stores<>'[]'::jsonb),
 imported_at timestamptz not null default now(),
 check(extract(isodow from week_start)=1 and week_end=week_start+6)
);
alter table public.t998_bi_weekly_sales enable row level security;
revoke all on public.t998_bi_weekly_sales from public,anon,authenticated;
grant select on public.t998_bi_weekly_sales to authenticated;
grant insert(week_start,week_end,source_file,source_sheet,source_row,center_sssg,stores)
 on public.t998_bi_weekly_sales to authenticated;
create policy t998_bi_weekly_sales_read on public.t998_bi_weekly_sales
 for select to authenticated using((select public.is_admin()));
create policy t998_bi_weekly_sales_import on public.t998_bi_weekly_sales
 for insert to authenticated with check((select public.is_admin()) and not exists(
 select 1 from public.t998_operations_daily_reports d
 where d.record_date between week_start and week_end and d.score_excluded and d.record_date<>date '2026-10-23'));
comment on table public.t998_bi_weekly_sales is
 'T998完整ISO週SSSG；保留來源；相同週衝突不覆寫；不拆分日月、不套用其他中心例外';
