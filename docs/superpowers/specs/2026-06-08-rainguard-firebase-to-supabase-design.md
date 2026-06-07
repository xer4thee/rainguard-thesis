# RainGuard — Firebase → Supabase Migration (Design Spec)

- **Date:** 2026-06-08
- **Status:** Approved (design); pending spec review → implementation plan
- **Author:** Claude + user
- **Project:** RainGuard rainwater monitoring (vanilla JS web app + ESP32 firmware)

## 1. Context & problem

RainGuard currently uses Firebase Realtime Database as its backend. The web app
([dashboard.html](../../../dashboard.html), [script.js](../../../script.js)) is
**write-only** to Firebase (`sensor_readings`, `monitored_state`, `computed_values`,
`rainguard`) and never reads back, so only the machine physically wired to the ESP32
sees live data. Auth is hardcoded client-side in [index.html](../../../index.html)
(`CREDENTIALS = {admin, user, lgu}` + `sessionStorage`). The database rules are fully
public (read + write).

We are migrating the backend to **Supabase (PostgreSQL + Auth + Realtime)**.

## 2. Goals

- Replace Firebase Realtime DB with Supabase Postgres for all sensor data.
- **Live read-back:** the dashboard reflects current data pulled from Supabase, so any
  authenticated device sees live values (fixes the write-only gap).
- **Full Supabase Auth:** real email+password login replaces the hardcoded credentials.
- Preserve the existing AMDA weights bug fix (backend-agnostic).
- Cleanly remove all Firebase-specific code.

## 3. Non-goals (scope boundaries)

- Admin **User Management** and **Device Management** pages stay on `localStorage` for
  now (not wired to Postgres). Hooks noted for a later phase.
- Analytics/history **charts stay on hardcoded demo data** (not driven by Postgres yet).
- No SMS/email notification backend (unchanged, out of scope as before).

## 4. Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Security posture | **Full Supabase Auth** (real login + RLS) |
| Read-back mechanism | **Supabase Realtime** (WebSocket subscription); polling is the fallback |
| Status tables | Merge Firebase `monitored_state` + `computed_values` → one `current_status` row |
| Write authorization | **Admin only** (Sensor Connect is already admin-only); all authenticated users read |
| Login identifier | **Email** + password (demo accounts recreated with existing emails) |
| Client delivery | Supabase JS via ESM CDN, exposed as `window._supabase` (mirrors `window._firebaseDB`) |
| Project | `zhfehohjkafrcwwqexdy` (`https://zhfehohjkafrcwwqexdy.supabase.co`) |

## 5. Architecture overview

```
ESP32 ──USB serial──> admin browser ──(authenticated, anon key + JWT)──> Supabase
                          │                                                  │
                          │  insert sensor_readings + upsert current_status  │
                          ▼                                                  ▼
                    AMDA engine (script.js)                         Postgres + RLS
                                                                           │
   any authenticated browser <── Realtime (current_status, sensor_readings) ┘
```

- Only the **admin** browser (which has Sensor Connect) writes.
- Any authenticated browser **subscribes** to `current_status` for live AMDA/level, and
  optionally to new `sensor_readings` for the live chart.

## 6. Database schema (PostgreSQL DDL)

```sql
-- ── profiles: one row per auth user, holds app role ──
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  email      text,
  role       text not null default 'user'   check (role   in ('admin','user','lgu')),
  status     text not null default 'active'  check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- ── sensor_readings: time-series history ──
create table public.sensor_readings (
  id           bigint generated always as identity primary key,
  level_percent real,
  inflow_lph    real,
  outflow_lph   real,
  temp_c        real,
  source        text not null default 'esp32',
  recorded_at   timestamptz not null default now()
);
create index sensor_readings_recorded_at_idx on public.sensor_readings (recorded_at desc);

-- ── current_status: single upserted row = live AMDA snapshot ──
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
```

### Helper + signup trigger

```sql
-- role lookup that bypasses RLS (SECURITY DEFINER) to avoid policy recursion
create or replace function public.current_user_role()
returns text language sql security definer set search_path = public stable as $$
  select role from public.profiles where id = auth.uid();
$$;

-- auto-create a profile row whenever an auth user is created
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
```

## 7. RLS policies

```sql
alter table public.profiles        enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.current_status  enable row level security;

-- profiles: read own row, admin reads/manages all
create policy "profiles read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy "profiles admin manage" on public.profiles
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- sensor_readings: any authenticated reads; only admin inserts
create policy "readings authenticated read" on public.sensor_readings
  for select to authenticated using (true);
create policy "readings admin insert" on public.sensor_readings
  for insert to authenticated with check (public.current_user_role() = 'admin');

-- current_status: any authenticated reads; only admin upserts
create policy "status authenticated read" on public.current_status
  for select to authenticated using (true);
create policy "status admin upsert" on public.current_status
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
```

### Realtime

```sql
alter publication supabase_realtime add table public.current_status;
alter publication supabase_realtime add table public.sensor_readings;
```

## 8. Auth flow

- **Login** ([index.html](../../../index.html)): replace the hardcoded `CREDENTIALS`
  check with `supabase.auth.signInWithPassword({ email, password })`. The existing rate
  limiter stays. Demo badges prefill emails. On success → redirect to dashboard
  (Supabase persists the session in `localStorage`).
- **Session/role** ([script.js](../../../script.js) `checkAuth`): replace the
  `sessionStorage` role read with `supabase.auth.getSession()` + a `profiles` lookup for
  the role. `canAccess`/`getDefaultPage` logic is unchanged — only the role *source*
  changes. `logout()` → `supabase.auth.signOut()`.
- **Demo users:** recreate the three demo accounts as real Supabase Auth users on a
  single consistent domain, preserving the current passwords for demo continuity:
  - `admin@rainguard.io` / `admin123` → role `admin`
  - `user@rainguard.io`  / `user123`  → role `user`
  - `lgu@rainguard.io`   / `lgu123`   → role `lgu`

  `role` and `username` go in `raw_user_meta_data` so the signup trigger populates
  `profiles`. Created via the **Auth admin API** (service key) or the dashboard —
  *not* plain SQL (password hashing). The login badges in `index.html` prefill these.

## 9. Client integration (no build step)

Both pages load Supabase JS from an ESM CDN and expose `window._supabase`:

```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window._supabase = createClient(
    'https://zhfehohjkafrcwwqexdy.supabase.co',
    '<ANON_PUBLISHABLE_KEY>'
  );
</script>
```

**CSP change required** in [index.html](../../../index.html) (dashboard.html has no CSP):

```
script-src 'self' 'unsafe-inline' https://esm.sh;
connect-src 'self' https://zhfehohjkafrcwwqexdy.supabase.co wss://zhfehohjkafrcwwqexdy.supabase.co;
```

### Write path (replaces `_writeToFirebase`)

```js
async _writeToSupabase() {
  const sb = window._supabase;
  if (!sb) return;
  const amda = this.runAmda();
  const { error: e1 } = await sb.from('sensor_readings').insert({
    level_percent: this.latest.levelPct, inflow_lph: this.latest.inflowLPH,
    outflow_lph: this.latest.outflowLPH, temp_c: this.latest.tempC,
  });
  const { error: e2 } = await sb.from('current_status').upsert({
    id: 1, amda_score: amda.score, amda_state: amda.state.label,
    recommendation: amda.recommendations[0]?.text || '',
    days_remaining: amda.daysRemaining, trend: amda.predictions.trend,
    time_to_overflow_hr: amda.predictions.timeToOverflowH,
    time_to_deplete_hr: amda.predictions.timeToDepleteH,
    updated_at: new Date().toISOString(),
  });
  if (e1 || e2) console.warn('Supabase write failed:', e1?.message || e2?.message);
}
```

(JSON serialization converts any stray `NaN`→`null`, and the weights fix keeps the score
finite, so the Firebase `clean()` guard is no longer needed.)

### Read-back (Realtime subscription)

On dashboard init, when the local serial feed is **not** live, subscribe to
`current_status` and update `SensorHub.latest` + re-render the AMDA widgets:

```js
sb.channel('status')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'current_status' },
      payload => applyRemoteStatus(payload.new))
  .subscribe();
```

## 10. Firebase removal (revert plan)

- [dashboard.html](../../../dashboard.html): delete the `firebase-app` / `firebase-database`
  module and `window._firebase*` globals → replace with the Supabase init block.
- [script.js](../../../script.js): `_writeToFirebase()` → `_writeToSupabase()`; drop the
  Firebase `clean()` helper; call site in `ingest()` updated.
- **Keep** the AMDA `WEIGHTS` fix (`daysSupply: 0.15, historical: 0.15`).
- [README.md](../../../README.md): update setup/architecture, demo credentials (email),
  and the task list.

## 11. Open items / risks

- **Access:** my Supabase MCP is connected to a different account; user is reconnecting
  it to the org that owns `zhfehohjkafrcwwqexdy`. Access re-verified before any DDL. If
  reconnect fails, fall back to running the migration SQL in the dashboard SQL Editor.
- **Anon key:** needed for the client; user supplies it (public by design).
- **Demo-user seeding** requires the Auth admin API / dashboard (not SQL).
- **Realtime** must be enabled on the tables (done via the publication statements above).

## 12. Verification plan

- DDL applied: `list_tables` shows the 3 tables + RLS enabled.
- Auth: log in as each demo role; confirm role-based page access matches today.
- Write: connect ESP32 as admin → `sensor_readings` rows appear; `current_status` updates.
- Read-back: a second logged-in browser (no serial) reflects live `current_status`.
- RLS: a `user`/`lgu` session cannot insert readings (write denied); can read.
- Regression: AMDA score finite; no Firebase references remain (`grep firebase`).
