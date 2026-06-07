# RainGuard Firebase → Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate RainGuard's backend from Firebase Realtime DB to Supabase (PostgreSQL + Auth + Realtime), with full login and live read-back.

**Architecture:** A single Postgres schema (`profiles`, `sensor_readings`, `current_status`) behind RLS. Only `admin` (the ESP32-connected browser) writes; any authenticated user reads. The dashboard subscribes to `current_status` via Supabase Realtime for live read-back. Auth replaces the hardcoded client login. The Supabase JS client loads from an ESM CDN (no build step), mirroring the old `window._firebaseDB` global as `window._supabase`.

**Tech Stack:** Vanilla JS, Supabase (Postgres 17, Auth, Realtime), `@supabase/supabase-js@2` via esm.sh, Chart.js (unchanged).

> **Testing note:** This project has **no test framework** and is browser/hardware-driven (Web Serial, Auth, Realtime). Adding a headless harness is out of scope (YAGNI). Logic-only checks use `node`; everything else uses concrete **manual verification** steps (SQL queries via MCP `execute_sql`/dashboard, and browser checks). Each task ends with an explicit verification + commit.

---

## Prerequisites (gating — must be satisfied before Tasks 1–2 and live verification)

- [ ] **P0a — Supabase access.** Re-run MCP `list_projects`; confirm `zhfehohjkafrcwwqexdy` appears. If not, use the **fallback**: user runs all SQL in Supabase dashboard → SQL Editor, and pastes the anon key.
- [ ] **P0b — Anon key.** With MCP access: call `get_publishable_keys` for the project. Without: user copies it from **Project Settings → API → `anon` `public`**. Record it for Task 3.

> Tasks 3–9 (client code, README) are access-independent and can be written with the anon key as a placeholder, but their **live verification** needs P0a/P0b done.

---

## Task 1: Database schema + RLS + Realtime

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/0001_init.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

With MCP access: `apply_migration({ project_id: "zhfehohjkafrcwwqexdy", name: "0001_init", query: <file contents> })`.
Fallback: paste the file into Supabase → SQL Editor → Run.

- [ ] **Step 3: Verify schema + RLS**

Run (MCP `list_tables` with `verbose:true`, or in SQL Editor):
```sql
select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;
```
Expected: `current_status`, `profiles`, `sensor_readings`, all `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): add Supabase schema, RLS, and realtime for sensor data"
```

---

## Task 2: Seed the three demo users

**Files:** none (data only)

- [ ] **Step 1: Create the auth users**

In Supabase dashboard → **Authentication → Users → Add user** (enable *Auto Confirm User*), create:
- `admin@rainguard.io` / `admin123`
- `user@rainguard.io` / `user123`
- `lgu@rainguard.io` / `lgu123`

The `on_auth_user_created` trigger creates a matching `profiles` row for each (default role `user`).

- [ ] **Step 2: Set roles + usernames**

Run (MCP `execute_sql` or SQL Editor):
```sql
update public.profiles set role='admin', username='admin' where email='admin@rainguard.io';
update public.profiles set role='user',  username='user'  where email='user@rainguard.io';
update public.profiles set role='lgu',   username='lgu'   where email='lgu@rainguard.io';
```

- [ ] **Step 3: Verify**

```sql
select email, username, role, status from public.profiles order by role;
```
Expected: 3 rows — admin/user/lgu with matching roles, status `active`.

---

## Task 3: Supabase client bootstrap (both pages) + CSP

**Files:**
- Modify: `dashboard.html` (replace Firebase module block, ~lines 1253–1274)
- Modify: `index.html` (add init before existing `<script>`, ~line 64; update CSP at line 6)

- [ ] **Step 1: Add the Supabase init to `dashboard.html`**

Replace the entire Firebase `<script type="module">…</script>` block with:

```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window._supabase = createClient(
    'https://zhfehohjkafrcwwqexdy.supabase.co',
    '__SUPABASE_ANON_KEY__'   // P0b: replace with the anon public key
  );
  console.log('Supabase ready');
</script>
```

- [ ] **Step 2: Add the same init to `index.html`** (immediately after `<script>\n 'use strict';`, but as its own module so the login script can use it):

```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window._supabase = createClient(
    'https://zhfehohjkafrcwwqexdy.supabase.co',
    '__SUPABASE_ANON_KEY__'
  );
</script>
```

- [ ] **Step 3: Update `index.html` CSP** (line 6) to allow the CDN + Supabase (REST over https, Realtime over wss):

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://zhfehohjkafrcwwqexdy.supabase.co wss://zhfehohjkafrcwwqexdy.supabase.co;">
```

- [ ] **Step 4: Verify**

Serve (`python -m http.server 8080`), open `index.html`, DevTools console: `window._supabase` is defined, no CSP violations. On dashboard: `Supabase ready` logged.

- [ ] **Step 5: Commit**

```bash
git add index.html dashboard.html
git commit -m "feat(web): bootstrap Supabase JS client and update CSP"
```

---

## Task 4: Login via Supabase Auth (`index.html`)

**Files:** Modify `index.html` (login `<script>`, ~lines 98, 134–137; demo badges ~lines 53–58)

- [ ] **Step 1: Replace the credential constant + login handler**

Remove `const CREDENTIALS = {…}` (line 98). Replace the success/failure block (lines 134–148) so the submit handler is `async` and uses Supabase:

```js
if (CREDENTIALS_REMOVED) {}                       // (delete old block)
const { data, error } = await window._supabase.auth.signInWithPassword({
  email: rawUser, password: rawPass               // rawUser is now the email field
});
if (!error && data.session) {
  window.location.href = 'dashboard.html';
} else {
  RateLimiter.record();
  document.getElementById('password').value = '';
  const lock = RateLimiter.locked();
  if (lock) startCountdown(lock);
  else {
    const left = RateLimiter.left();
    errEl.textContent = 'Invalid email or password. ' + left + ' attempt' + (left !== 1 ? 's' : '') + ' remaining.';
  }
}
```

Change the username field to email: in the markup set `<input type="email" id="username" …>` label "Email", and update the redirect-if-logged-in check (line 96) to:
```js
window._supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.href = 'dashboard.html';
});
```

- [ ] **Step 2: Update demo badges** (lines 53–58) to prefill emails:

```html
<span class="status-badge normal" style="cursor:pointer;"
  onclick="document.getElementById('username').value='user@rainguard.io';document.getElementById('password').value='user123';">user</span>
<span class="status-badge critical" style="cursor:pointer;"
  onclick="document.getElementById('username').value='admin@rainguard.io';document.getElementById('password').value='admin123';">admin</span>
<span class="status-badge low" style="cursor:pointer;"
  onclick="document.getElementById('username').value='lgu@rainguard.io';document.getElementById('password').value='lgu123';">lgu</span>
```

- [ ] **Step 3: Verify (needs P0a/P0b + Task 2)**

Click each badge → Log In → lands on dashboard. Wrong password → error + decrementing attempts; 5 fails → 60s lockout (rate limiter intact).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(auth): replace hardcoded login with Supabase signInWithPassword"
```

---

## Task 5: Session + role resolution in the app (`script.js`)

**Files:** Modify `script.js` — `checkAuth` (lines 605–610), `logout` (612–615), `init` (1702–1725)

- [ ] **Step 1: Make `checkAuth` async + Supabase-based**

```js
async function checkAuth() {
  const sb = window._supabase;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return false; }
  const { data: profile } = await sb
    .from('profiles').select('username, role').eq('id', session.user.id).single();
  state.role = profile?.role || 'user';
  state.user = profile?.username || session.user.email;
  return true;
}
```

- [ ] **Step 2: Update `logout`**

```js
async function logout() {
  await window._supabase.auth.signOut();
  window.location.href = 'index.html';
}
```

- [ ] **Step 3: Make `init` await auth**

Change the boot to await `checkAuth()`:
```js
async function init() {
  if (!(await checkAuth())) return;
  state.settings = loadFromStorage('settings', DEFAULT_SETTINGS);
  state.waterLevel = 3400;
  setupUI();
  handleRoute();
  window.addEventListener('hashchange', handleRoute);
  /* weather geolocation block unchanged */
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => SensorHub.fetchWeather(pos.coords.latitude, pos.coords.longitude),
      ()  => SensorHub.fetchWeather(14.5995, 120.9842));
  } else { SensorHub.fetchWeather(14.5995, 120.9842); }
}
```

- [ ] **Step 4: Verify (needs P0a/P0b + Task 2)**

Log in as each role: admin → `admin-overview`, lgu → `lgu-dashboard`, user → `overview` (matches `getDefaultPage`). Admin-only pages hidden for user/lgu. Logout returns to login and a direct visit to `dashboard.html` redirects when logged out.

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "feat(auth): resolve session and role from Supabase profiles"
```

---

## Task 6: Write path — `_writeToSupabase` replaces `_writeToFirebase` (`script.js`)

**Files:** Modify `script.js` — `ingest` call site (line 362) and the `_writeToFirebase` method (365–405)

- [ ] **Step 1: Replace the method**

Replace `_writeToFirebase() {…}` with:

```js
async _writeToSupabase() {
  const sb = window._supabase;
  if (!sb) return;
  try {
    const amda = this.runAmda();
    const { error: e1 } = await sb.from('sensor_readings').insert({
      level_percent: this.latest.levelPct,
      inflow_lph:    this.latest.inflowLPH,
      outflow_lph:   this.latest.outflowLPH,
      temp_c:        this.latest.tempC,
    });
    const { error: e2 } = await sb.from('current_status').upsert({
      id: 1,
      amda_score:          amda.score,
      amda_state:          amda.state.label,
      recommendation:      amda.recommendations[0]?.text || '',
      days_remaining:      amda.daysRemaining,
      trend:               amda.predictions.trend,
      time_to_overflow_hr: amda.predictions.timeToOverflowH,
      time_to_deplete_hr:  amda.predictions.timeToDepleteH,
      updated_at:          new Date().toISOString(),
    });
    if (e1 || e2) console.warn('Supabase write failed:', (e1 || e2).message);
    else console.log('Supabase synced — level:', this.latest.levelPct + '%', 'AMDA:', amda.score);
  } catch (err) {
    console.warn('Supabase write error:', err.message);
  }
}
```

- [ ] **Step 2: Update the call site in `ingest()`** (line 362): change `this._writeToFirebase();` → `this._writeToSupabase();`

- [ ] **Step 3: Verify syntax**

Run: `node --check script.js`
Expected: no output (exit 0).

- [ ] **Step 4: Verify live (needs P0a/P0b + admin login + ESP32 or simulated serial)**

As admin, connect ESP32 (or feed a serial line). Then:
```sql
select count(*) from public.sensor_readings;            -- increases
select amda_score, amda_state, updated_at from public.current_status;  -- fresh
```

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "feat(db): write sensor data to Supabase instead of Firebase"
```

---

## Task 7: Live read-back via Realtime (`script.js`)

**Files:** Modify `script.js` — add to `SensorHub` and call from `init` (after `handleRoute()`)

- [ ] **Step 1: Add a subscribe method to `SensorHub`**

```js
subscribeRemote() {
  const sb = window._supabase;
  if (!sb) return;
  /* seed once from the current row so a fresh page isn't blank */
  sb.from('current_status').select('*').eq('id', 1).single()
    .then(({ data }) => { if (data) this._applyRemote(data); });
  sb.channel('rg-status')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'current_status' },
        payload => this._applyRemote(payload.new))
    .subscribe();
},

_applyRemote(row) {
  /* Only let remote data drive the UI when THIS browser has no live serial feed. */
  if (this.live || !row) return;
  if (typeof row.amda_score === 'number') {
    const el = document.getElementById('statAMDA');
    if (el) el.textContent = row.amda_score + '% — ' + (row.amda_state || '');
    const bar = document.getElementById('amdaProgressBar');
    if (bar) bar.style.width = row.amda_score + '%';
  }
  const upd = document.getElementById('tankLastUpdated');
  if (upd) upd.textContent = '🛰 Remote — ' + new Date(row.updated_at).toLocaleTimeString();
}
```

- [ ] **Step 2: Call it from `init`** (after `handleRoute();`): `SensorHub.subscribeRemote();`

- [ ] **Step 3: Verify syntax**

Run: `node --check script.js` → exit 0.

- [ ] **Step 4: Verify live (needs two browsers)**

Browser A (admin) streams serial → writes `current_status`. Browser B (any role, no serial) shows the AMDA score updating with a "🛰 Remote" timestamp, without manual refresh.

- [ ] **Step 5: Commit**

```bash
git add script.js
git commit -m "feat(web): live read-back via Supabase Realtime"
```

---

## Task 8: Remove Firebase + update README

**Files:** Modify `dashboard.html` (confirm no Firebase remains), `README.md`

- [ ] **Step 1: Confirm Firebase is gone**

Run: `grep -rin "firebase" index.html dashboard.html script.js`
Expected: **no matches**. (Task 3 already replaced the dashboard module; fix any stragglers.)

- [ ] **Step 2: Update `README.md`**

- Requirements/architecture: replace Firebase mentions with Supabase (Postgres + Auth + Realtime).
- Demo credentials table → emails: `admin@rainguard.io / admin123`, `user@rainguard.io / user123`, `lgu@rainguard.io / lgu123`.
- File Structure: add `supabase/migrations/0001_init.sql`.
- Known Issues list: check off the Firebase-specific items; the "public DB rules" item is now replaced by Supabase RLS (mark resolved); note read-back is now implemented.

- [ ] **Step 3: Verify**

Re-run the grep (no matches) and load the app end-to-end (login → live data → logout).

- [ ] **Step 4: Commit**

```bash
git add dashboard.html README.md
git commit -m "chore: remove Firebase, document Supabase migration"
```

---

## Task 9: Final regression sweep

- [ ] **Step 1: AMDA score finite** — on Overview the AMDA widget shows a real `%` (weights fix retained), not `NaN%`.
- [ ] **Step 2: RLS enforced** — while logged in as `user`, in DevTools console:
  ```js
  await window._supabase.from('sensor_readings').insert({level_percent:1});
  ```
  Expected: an RLS error (insert denied). As `admin`: succeeds.
- [ ] **Step 3: Read access** — `user` and `lgu` can `select` from `sensor_readings`/`current_status`.
- [ ] **Step 4: No Firebase** — `grep -rin firebase index.html dashboard.html script.js` → empty.
- [ ] **Step 5: Commit any fixes**, then the branch is ready for review/merge.

---

## Self-review notes (author)

- **Spec coverage:** schema (T1), RLS+realtime (T1), demo users (T2), client+CSP (T3), login (T4), session/role (T5), write path (T6), read-back (T7), Firebase removal + README (T8), verification (T9). All spec sections mapped.
- **Out of scope (per spec):** User/Device Management pages and demo charts remain on localStorage — intentionally untouched.
- **Type consistency:** `window._supabase`, `current_status.id=1` upsert, `current_user_role()`, `profiles.role`/`username` used consistently across tasks.
- **Known manual gates:** P0a/P0b (access + anon key) and Task 2 (dashboard user creation) require human/console action; every other step is code or SQL.
