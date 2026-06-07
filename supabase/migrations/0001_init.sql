-- RainGuard — Supabase schema (Firebase → Supabase migration)
-- Apply via MCP apply_migration or the Supabase dashboard SQL Editor.

-- ============ TABLES ============
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  email      text,
  role       text not null default 'user'   check (role   in ('admin','user','lgu')),
  status     text not null default 'active'  check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table public.sensor_readings (
  id            bigint generated always as identity primary key,
  level_percent real,
  inflow_lph    real,
  outflow_lph   real,
  temp_c        real,
  source        text not null default 'esp32',
  recorded_at   timestamptz not null default now()
);
create index sensor_readings_recorded_at_idx on public.sensor_readings (recorded_at desc);

create table public.current_status (
  id                  smallint primary key default 1 check (id = 1),
  amda_score          int,
  amda_state          text,
  recommendation      text,
  days_remaining      int,
  trend               text,
  time_to_overflow_hr real,
  time_to_deplete_hr  real,
  updated_at          timestamptz not null default now()
);
insert into public.current_status (id) values (1) on conflict (id) do nothing;

-- ============ HELPER + SIGNUP TRIGGER ============
create or replace function public.current_user_role()
returns text language sql security definer set search_path = public stable as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'user')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS ============
alter table public.profiles        enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.current_status  enable row level security;

create policy "profiles read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles admin manage" on public.profiles
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "readings authenticated read" on public.sensor_readings
  for select to authenticated using (true);
create policy "readings admin insert" on public.sensor_readings
  for insert to authenticated with check (public.current_user_role() = 'admin');

create policy "status authenticated read" on public.current_status
  for select to authenticated using (true);
create policy "status admin upsert" on public.current_status
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============ REALTIME ============
alter publication supabase_realtime add table public.current_status;
alter publication supabase_realtime add table public.sensor_readings;
