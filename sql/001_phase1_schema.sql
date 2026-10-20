-- Phase 1: users, roles, price list, change log, sign-in log.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------

-- One row per person who can sign in. Linked to Supabase's auth.users.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 0),
  role       text not null check (role in ('worker', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Worker PINs, stored only as a hash. No one can read this table from the app.
create table public.worker_pins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  pin_hash   text not null,
  updated_at timestamptz not null default now()
);

-- The shop's price list. plu = the code on the fiscal register (1-143...).
create table public.services (
  plu          integer primary key check (plu > 0),
  name_on_list text not null check (length(trim(name_on_list)) > 0),
  item         text not null,
  category     text not null,
  service      text not null,
  line         text not null check (line in ('Casual', 'Luxury')),
  price_eur    numeric(10, 2) not null check (price_eur >= 0),
  price_type   text not null check (price_type in ('fixed', 'per_kg', 'free')),
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Every change made in the system: who, what, when, before, after, why.
create table public.change_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references public.profiles (id),
  table_name text not null,
  record_id  text not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  before     jsonb,
  after      jsonb,
  reason     text not null check (length(trim(reason)) > 0)
);

-- Every sign-in attempt, good or bad.
create table public.login_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references public.profiles (id) on delete set null,
  method     text not null check (method in ('pin', 'email')),
  success    boolean not null,
  detail     text,
  ip         text,
  user_agent text
);
create index login_log_user_time on public.login_log (user_id, created_at desc);

-- ---------------------------------------------------------------
-- Helpers used by the permission rules
-- ---------------------------------------------------------------

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ---------------------------------------------------------------
-- Row-level security: the database itself decides who sees what.
-- Writes happen only through the functions below, never directly.
-- ---------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.worker_pins enable row level security;
alter table public.services    enable row level security;
alter table public.change_log  enable row level security;
alter table public.login_log   enable row level security;

create policy "own profile or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

create policy "staff read prices" on public.services
  for select to authenticated using (public.is_staff());

create policy "admin reads change log" on public.change_log
  for select to authenticated using (public.is_admin());

create policy "admin reads login log" on public.login_log
  for select to authenticated using (public.is_admin());

-- worker_pins: no policies = nobody reads it from the app.

revoke insert, update, delete, truncate on
  public.profiles, public.worker_pins, public.services, public.change_log, public.login_log
  from anon, authenticated;
revoke select on public.worker_pins from anon, authenticated;

-- ---------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------

-- Names on the worker sign-in screen (before anyone is signed in).
create or replace function public.login_workers()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from profiles p
  where p.role = 'worker' and p.active
  order by p.full_name;
$$;

-- Checks a worker's PIN. Only the pin-login server function may call it.
create or replace function public.check_worker_pin(p_user_id uuid, p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from worker_pins w join profiles p on p.id = w.user_id
    where w.user_id = p_user_id and p.active and p.role = 'worker'
      and w.pin_hash = crypt(p_pin, w.pin_hash)
  );
$$;

-- Records an owner's successful email sign-in (IP comes from the request).
create or replace function public.log_my_login(p_user_agent text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
begin
  if not is_staff() then
    raise exception 'not allowed';
  end if;
  insert into login_log (user_id, method, success, ip, user_agent)
  values (auth.uid(), 'email', true,
          split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
          left(p_user_agent, 300));
end;
$$;

-- Admin: change a service (name, price, on/off). Reason is required.
create or replace function public.update_service(
  p_plu integer, p_name_on_list text, p_price_eur numeric, p_active boolean, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before services;
  v_after  services;
begin
  if not is_admin() then raise exception 'Vetëm pronari mund t''i ndryshojë çmimet'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Shkruani arsyen'; end if;

  select * into v_before from services where plu = p_plu for update;
  if not found then raise exception 'PLU % nuk ekziston', p_plu; end if;

  update services
     set name_on_list = trim(p_name_on_list), price_eur = p_price_eur,
         active = p_active, updated_at = now()
   where plu = p_plu
  returning * into v_after;

  insert into change_log (user_id, table_name, record_id, action, before, after, reason)
  values (auth.uid(), 'services', p_plu::text, 'update',
          to_jsonb(v_before), to_jsonb(v_after), trim(p_reason));
end;
$$;

-- Admin: add a new service. Reason is required.
create or replace function public.add_service(
  p_plu integer, p_name_on_list text, p_item text, p_category text, p_service text,
  p_line text, p_price_eur numeric, p_price_type text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_after services;
begin
  if not is_admin() then raise exception 'Vetëm pronari mund të shtojë shërbime'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Shkruani arsyen'; end if;
  if exists (select 1 from services where plu = p_plu) then
    raise exception 'PLU % ekziston tashmë', p_plu;
  end if;

  insert into services (plu, name_on_list, item, category, service, line, price_eur, price_type)
  values (p_plu, trim(p_name_on_list), trim(p_item), trim(p_category), trim(p_service),
          p_line, p_price_eur, p_price_type)
  returning * into v_after;

  insert into change_log (user_id, table_name, record_id, action, before, after, reason)
  values (auth.uid(), 'services', p_plu::text, 'insert', null, to_jsonb(v_after), trim(p_reason));
end;
$$;

-- Setup only (run by hand in the SQL editor): give a Supabase user a name,
-- a role and, for workers, a PIN of 4-6 digits.
create or replace function public.setup_user(
  p_email text, p_full_name text, p_role text, p_pin text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'No user with email %. Create it first under Authentication -> Users.', p_email;
  end if;

  insert into profiles (id, full_name, role) values (v_id, trim(p_full_name), p_role)
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, active = true;

  if p_role = 'worker' then
    if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
      raise exception 'Worker PIN must be 4-6 digits';
    end if;
    insert into worker_pins (user_id, pin_hash) values (v_id, crypt(p_pin, gen_salt('bf')))
    on conflict (user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  end if;
end;
$$;

-- Who may call which function. (Supabase lets everyone call new functions by
-- default, so we take that away and give it back only where needed.)
revoke execute on function
  public.is_staff(), public.is_admin(), public.login_workers(),
  public.check_worker_pin(uuid, text), public.log_my_login(text),
  public.update_service(integer, text, numeric, boolean, text),
  public.add_service(integer, text, text, text, text, text, numeric, text, text),
  public.setup_user(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.is_staff(), public.is_admin() to authenticated;
grant execute on function public.login_workers() to anon, authenticated;
grant execute on function public.check_worker_pin(uuid, text) to service_role;
grant execute on function public.log_my_login(text) to authenticated;
grant execute on function public.update_service(integer, text, numeric, boolean, text) to authenticated;
grant execute on function public.add_service(integer, text, text, text, text, text, numeric, text, text) to authenticated;
-- setup_user: no grant, so only the SQL editor (database owner) can run it.
