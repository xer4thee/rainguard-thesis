-- RainGuard — alerts table (server-persisted, shared, realtime)
create table public.alerts (
  id         bigint generated always as identity primary key,
  type       text not null default 'info',   -- info | warning | critical | danger
  title      text not null,
  message    text,
  created_at timestamptz not null default now()
);
create index alerts_created_at_idx on public.alerts (created_at desc);

alter table public.alerts enable row level security;

-- Any authenticated user reads; only admin writes (generates/clears) — matches sensor RLS.
create policy "alerts authenticated read" on public.alerts
  for select to authenticated using (true);
create policy "alerts admin write" on public.alerts
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

alter publication supabase_realtime add table public.alerts;

-- Demo alerts (inserted only if the table is empty so re-running is safe).
insert into public.alerts (type, title, message, created_at)
select v.type, v.title, v.message, v.created_at
from (values
  ('warning'::text,  '⚠️ Low Water Level'::text, 'Tank level dropped below the low threshold.'::text, now() - interval '12 minutes'),
  ('critical'::text, '🔶 Critical Level'::text,   'Tank approaching the critical threshold.'::text,    now() - interval '40 minutes'),
  ('info'::text,     'ℹ️ AMDA Active'::text,       'AMDA v2 monitoring is active.'::text,               now() - interval '2 hours')
) as v(type, title, message, created_at)
where not exists (select 1 from public.alerts);
