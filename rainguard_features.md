# RainGuard — Feature Enhancement Tasks

> New feature requests (separate from `rainguard_errors.md`, which tracks bugs/fixes).
> **Created:** 2026-06-08 · **Status:** ✅ **implemented 2026-06-08** — all sections built and verified by the E2E suite (25/25 checks).
>
> **Decisions used while building:** landing at `index.html`, login → `login.html`, register → `register.html`; registration handles email-confirmation **either way** (the on/off toggle is a Supabase dashboard setting); Day/Week/Month drives from real `sensor_readings` history (shows gaps where empty); threshold interval default **1 min**, configurable via `amdaConfig.thresholdIntervalMin`.
> **Backend:** Supabase (Auth + Postgres + Realtime). **App:** vanilla JS (no build step).
> Check off each item as it's completed.

---

## 1. 🔐 Authentication & Landing Page

### 1.1 Remove the demo credentials from the login page
- [x] Remove the three demo credential badges (`admin` / `user` / `lgu`) and the "Demo Credentials" block from the login page.
- **Files:** `index.html` (or `login.html` after §1.3 routing).
- **Why:** production-style login; don't advertise demo logins on a public page.
- **Acceptance:** login page shows only Email, Password, **Log In**, and a **Register** link — no demo badges.

### 1.2 Add user registration (sign-up)
- [x] Add a **Register / Create account** button on the login page that opens a registration form.
- [x] Registration form (email, password, confirm password, username) → `supabase.auth.signUp({ email, password, options:{ data:{ username } } })`. The existing `handle_new_user` trigger auto-creates the `profiles` row (role defaults to `user`).
- **Files:** new `register.html` (or a modal), JS wiring, Supabase Auth.
- **Acceptance:** a brand-new email can register, then log in and land on the user Overview.
- **Open questions:**
  - **Email confirmation** — Supabase Auth defaults to requiring email confirmation. Decide: keep it on (user clicks a link in their inbox) **or** turn it off for the thesis demo (instant login).
  - New users get role `user` by default; `admin`/`lgu` are assigned manually (SQL or dashboard). OK?
  - No client-side `profiles` insert needed — the signup trigger (SECURITY DEFINER) handles it under RLS.

### 1.3 Public landing page
- [x] Create a landing/home page that introduces RainGuard and has **Log In** and **Register** call-to-action buttons.
- **Files:** new `landing.html` + adjusted redirects.
- **Recommended routing:** `index.html` → **landing**, `login.html` → login, `register.html` → register. An already-authenticated session skips straight to `dashboard.html`.
- **Acceptance:** visiting the site shows the landing page; Login/Register navigate correctly; a logged-in user is redirected to the dashboard.
- **Open question:** confirm the routing above (make `index.html` the landing and move login to `login.html`), or keep `index.html` as login and add a separate `landing.html`.

---

## 2. 📊 Overview vs. Tank Monitoring — make the two pages behave differently

The two pages should feel distinct: **Overview = periodic "last updated" snapshot**, **Tank Monitoring = live realtime**.

### 2.1 Overview — "last updated" history for every function
- [x] Show a **"Last updated: <time>"** indicator on each Overview widget/function (water level, active alerts, AMDA prediction, inflow/outflow, etc.), reflecting the timestamp of the latest data that fed it.
- **Source:** `sensor_readings.recorded_at` / `current_status.updated_at` from Supabase.
- **Files:** `dashboard.html` (overview cards), `script.js` (`updateOverview`).
- **Acceptance:** each Overview card displays when its data was last updated; Overview refreshes on a periodic snapshot cadence (not every second — see §3).

### 2.2 Tank Monitoring — realtime / live
- [x] Tank Monitoring updates in **realtime** (live), visibly distinct from the Overview snapshot.
- [x] Add a clear live cue (e.g. a **🔴 LIVE** badge / pulsing dot) so the difference between the two pages is obvious.
- **Files:** `dashboard.html`, `script.js` (`startTankSimulation` + Supabase Realtime subscription).
- **Acceptance:** Tank Monitoring reflects new readings live via Realtime; Overview shows periodic "last updated" snapshots. The two pages are clearly differentiated.

### 2.3 Overview — Day / Week / Month range selector
- [x] Add a **Day / Week / Month** toggle on the Overview that changes the time range of the charts and summary stats.
- **Files:** `dashboard.html` (toggle UI), `script.js` (query + aggregate `sensor_readings` by range).
- **Note:** requires querying real `sensor_readings` history and aggregating per day/week/month (current charts use hardcoded demo data).
- **Acceptance:** selecting Day/Week/Month re-renders the Overview charts/stats for that period from real Supabase data (graceful "no data yet" when a range is empty).

---

## 3. ⏱ Throttle threshold / alert evaluation

- [x] The AMDA **threshold/alert evaluation must not run every second** — throttle it to **every 1–3 minutes** (configurable; default 1 min).
- **Files:** `script.js` (`checkAndFireAlert` and the interval that evaluates thresholds).
- **Why:** thresholds change slowly; per-second evaluation is wasteful and risks alert churn.
- **Acceptance:** threshold/alert checks fire at most once per configured interval (1–3 min), **while the live tank display can still refresh more often** (keep display cadence separate from threshold cadence).
- **Open question:** default interval — **1 min or 3 min**? Expose it in the AMDA Config page?

---

## Open decisions to confirm before building
1. **Routing** — make `index.html` the landing page (login → `login.html`)? (§1.3)
2. **Email confirmation** on registration — on or off? (§1.2)
3. **Day/Week/Month** — drive from real `sensor_readings` history; OK to show "no data yet" for empty ranges? (§2.3)
4. **Threshold interval** default — 1 min or 3 min, and configurable in AMDA Config? (§3)

## Suggested build order
1. **§3** (threshold throttle) — small, self-contained, immediate win.
2. **§2.1 / §2.2** (Overview last-updated + Tank Monitoring live distinction).
3. **§1.1–1.3** (remove demo creds → registration → landing) — auth/routing changes; do as one unit.
4. **§2.3** (Day/Week/Month) — largest; needs history aggregation queries.

> When we implement, each section is worth a quick brainstorm → plan → build → **E2E** cycle (the existing `tests/e2e.mjs` suite can be extended to cover registration, last-updated indicators, and the throttle).
