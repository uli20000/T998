-- T998 only. Candidate migration; do not apply without deployment approval.
-- Legacy singleton table and all legacy RPCs remain unchanged.
begin;

create schema if not exists t998_month_reply_private;
revoke all on schema t998_month_reply_private from public, anon, authenticated;

create table if not exists t998_month_reply_private.month_links (
  reply_month date primary key check (extract(day from reply_month) = 1),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  generation bigint not null default 1 check (generation > 0)
);
alter table t998_month_reply_private.month_links enable row level security;
revoke all on t998_month_reply_private.month_links from public, anon, authenticated;

-- The shared lock serializes valid requests with same-month token rotation.
-- No time-based expiry: validity is determined only by the current month row hash.
create or replace function t998_month_reply_private.lock_link(p_token text)
returns date language plpgsql security definer set search_path = '' as $$
declare v_month date;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid reply link' using errcode = '22023';
  end if;
  select l.reply_month into v_month
  from t998_month_reply_private.month_links l
  where l.token_hash = encode(sha256(convert_to(p_token,'UTF8')), 'hex')
  for share;
  if not found then raise exception 'Invalid reply link' using errcode = '22023'; end if;
  return v_month;
end;
$$;
revoke all on function t998_month_reply_private.lock_link(text) from public, anon, authenticated;

create or replace function public.t998_issue_month_reply_link(p_month date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_month date; v_token text;
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_month is null then raise exception 'Reply month required' using errcode = '22023'; end if;
  v_month := date_trunc('month', p_month::timestamp)::date;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into t998_month_reply_private.month_links as l
    (reply_month, token_hash, issued_by, issued_at)
  values (v_month, encode(sha256(convert_to(v_token,'UTF8')), 'hex'), auth.uid(), now())
  on conflict(reply_month) do update set
    token_hash = excluded.token_hash,
    issued_by = excluded.issued_by,
    issued_at = excluded.issued_at,
    generation = l.generation + 1;
  return jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'token', v_token);
end;
$$;
revoke all on function public.t998_issue_month_reply_link(date) from public, anon, authenticated;
grant execute on function public.t998_issue_month_reply_link(date) to authenticated;

create or replace function public.t998_public_list_month_delay_orders(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_month date;
begin
  v_month := t998_month_reply_private.lock_link(p_token);
  return jsonb_build_object(
    'restaurant_name', '所有餐廳', 'month', to_char(v_month, 'YYYY-MM'), 'link_kind', 'month',
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'record_date', d.record_date, 'store_code', d.store_code,
      'restaurant_name', d.restaurant_name, 'order_number', d.order_number
    ) order by d.record_date, d.store_code, d.order_number)
    from public.t998_delay_orders d
    where d.status = 'pending' and d.responded_at is null and coalesce(btrim(d.reason), '') = ''
      and d.record_date >= v_month and d.record_date < (v_month + interval '1 month')::date), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.t998_public_list_month_delay_orders(text) from public, anon, authenticated;
grant execute on function public.t998_public_list_month_delay_orders(text) to anon, authenticated;

create or replace function public.t998_public_submit_month_delay_reasons(p_token text, p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_month date; v_item jsonb; v_id uuid; v_reason text; v_ids uuid[] := '{}';
        v_reasons text[] := '{}'; v_index integer; v_row record; v_seen integer := 0; v_changed integer;
begin
  v_month := t998_month_reply_private.lock_link(p_token);
  if jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Updates must be a nonempty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_updates) not between 1 and 100 then
    raise exception 'Submit 1 to 100 orders' using errcode = '22023';
  end if;
  -- Validate the entire batch before locking or changing any order.
  for v_item in select value from jsonb_array_elements(p_updates) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item->'id') is distinct from 'string'
      or jsonb_typeof(v_item->'reason') is distinct from 'string' then
      raise exception 'Invalid reply payload' using errcode = '22023';
    end if;
    begin v_id := (v_item->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid reply payload' using errcode = '22023';
    end;
    v_reason := btrim(v_item->>'reason');
    if length(v_reason) not between 1 and 500 or v_id = any(v_ids) then
      raise exception 'Invalid or duplicate reply item' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_id); v_reasons := array_append(v_reasons, v_reason);
  end loop;
  -- Lock in deterministic UUID order. Concurrent submissions recheck the current
  -- row state after waiting; already answered rows cannot be overwritten.
  for v_row in
    select d.id, d.record_date, d.status, d.reason, d.responded_at
    from public.t998_delay_orders d where d.id = any(v_ids) order by d.id for update
  loop
    v_seen := v_seen + 1;
    if v_row.record_date < v_month or v_row.record_date >= (v_month + interval '1 month')::date
      or v_row.status <> 'pending' or v_row.responded_at is not null
      or coalesce(btrim(v_row.reason), '') <> '' then
      raise exception 'Order is not available for this reply link' using errcode = '22023';
    end if;
  end loop;
  if v_seen <> cardinality(v_ids) then
    raise exception 'Order is not available for this reply link' using errcode = '22023';
  end if;
  for v_index in 1..cardinality(v_ids) loop
    update public.t998_delay_orders d set reason = v_reasons[v_index], status = 'completed', responded_at = now()
    where d.id = v_ids[v_index] and d.status = 'pending' and d.responded_at is null
      and coalesce(btrim(d.reason), '') = '' and d.record_date >= v_month
      and d.record_date < (v_month + interval '1 month')::date;
    get diagnostics v_changed = row_count;
    if v_changed <> 1 then
      raise exception 'Order is not available for this reply link' using errcode = '22023';
    end if;
  end loop;
  return public.t998_public_list_month_delay_orders(p_token);
end;
$$;
revoke all on function public.t998_public_submit_month_delay_reasons(text,jsonb) from public, anon, authenticated;
grant execute on function public.t998_public_submit_month_delay_reasons(text,jsonb) to anon, authenticated;

comment on table t998_month_reply_private.month_links is
  'T998 fixed-month reply token hashes. One active generation per month; no automatic expiry. Legacy singleton untouched.';
notify pgrst, 'reload schema';
commit;
