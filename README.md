# 💧 RainGuard — Rainwater Monitoring System
### User & Setup Guide

---

## Requirements

| Requirement | Details |
|---|---|
| **Python** | Version 3.x (to run local web server) |
| **Browser** | Google Chrome or Microsoft Edge 89+ (required for sensor connection) |
| **Internet** | Needed for Supabase (login, database, realtime) and the weather forecast (Open-Meteo API) |
| **ESP32 + Sensors** | Optional — for live hardware data (see Hardware section below) |
| **Supabase project** | Backend database + auth (project `zhfehohjkafrcwwqexdy`); anon key configured in the app (see Backend Setup) |

---

## Backend Setup (Supabase) — one time

The app uses Supabase (PostgreSQL + Auth + Realtime) as its backend.

1. **Apply the schema:** run `supabase/migrations/0001_init.sql` in your Supabase project
   (dashboard → SQL Editor, or via the Supabase CLI/MCP). It creates the `profiles`,
   `sensor_readings`, and `current_status` tables with RLS and realtime.
2. **Create the demo users** (dashboard → Authentication → Add user, *Auto Confirm*):
   `admin@rainguard.io` / `admin123`, `user@rainguard.io` / `user123`,
   `lgu@rainguard.io` / `lgu123`. Then set their roles:
   ```sql
   update public.profiles set role='admin', username='admin' where email='admin@rainguard.io';
   update public.profiles set role='user',  username='user'  where email='user@rainguard.io';
   update public.profiles set role='lgu',   username='lgu'   where email='lgu@rainguard.io';
   ```
3. **Add your anon key:** copy it from Project Settings → API → `anon` `public`, and
   replace `__SUPABASE_ANON_KEY__` in both `index.html` and `dashboard.html`.

---

## How to Open the App

### Step 1 — Open a Terminal

- Press `Win + R`, type `cmd`, press Enter
- Or search **Command Prompt** / **PowerShell** in the Start menu

---

### Step 2 — Navigate to the Project Folder

```
cd Desktop\RainGuard
```

> If your folder is elsewhere, adjust the path. Example:
> `cd C:\Users\YourName\Documents\Thesis`

---

### Step 3 — Start the Web Server

```
python -m http.server 8080
```

You should see:
```
Serving HTTP on 0.0.0.0 port 8080 (http://0.0.0.0:8080/) ...
```

> If `python` is not recognised, try `python3 -m http.server 8080`

---

### Step 4 — Open in Browser

Open **Google Chrome** or **Microsoft Edge** and go to:

```
http://localhost:8080
```

You will see the **RainGuard login page**.

---

### Step 5 — Log In

Use one of the demo accounts below:

| Email | Password | Role | Access |
|---|---|---|---|
| `admin@rainguard.io` | `admin123` | Administrator | Full access — all pages including Sensor Connect, AMDA Config, Device Management |
| `user@rainguard.io` | `user123` | Regular User | Overview, Tank Monitoring, Alerts, Analytics, Settings |
| `lgu@rainguard.io` | `lgu123` | LGU Official | LGU Dashboard, Alerts, Analytics |

> 💡 You can click the coloured credential badges on the login page to auto-fill.

---

### Step 6 — Stop the Server (When Done)

Go back to the terminal window and press:

```
Ctrl + C
```

You will see:
```
Keyboard interrupt received, exiting.
```

---

## Features Overview

| Page | Who Can Access | What It Does |
|---|---|---|
| **Overview** | All | Live tank level, AMDA score, recommendations |
| **Tank Monitoring** | All | Real-time level chart, inflow/outflow, AMDA analysis |
| **Alerts** | All | Alert history (persisted), notification preferences, push test |
| **Analytics** | All | Usage charts, weekly/monthly trends |
| **Settings** | All | Tank capacity, threshold levels |
| **Admin Dashboard** | Admin | System overview stats |
| **User Management** | Admin | Add/edit/disable user accounts |
| **Device Management** | Admin | Sensor device list — status auto-updates when ESP32 connects |
| **AMDA Configuration** | Admin | Forecast horizon, alert sensitivity, weather toggle |
| **Sensor Connect** | Admin | ESP32 hardware wiring guide + live serial connection |
| **LGU Dashboard** | LGU | Area-wide charts for local government use |

---

## AMDA — How It Works

The **Adaptive Multi-parameter Decision Algorithm** analyses 5 real inputs:

```
Score (0-100) = 
  Water Level %   × 30%   (from sensor / simulation)
  Inflow Rate     × 20%   (L/hr — from flow meter)
  Rate of Change  × 20%   (is the tank rising or falling?)
  Days of Supply  × 15%   (based on forecast horizon setting)
  Historical Pat. × 15%   (vs. your rolling 20-reading average)
  × Temporal context multiplier (peak / normal / night hours)
```

**5 Output States:**

| Score | State | Colour |
|---|---|---|
| 80–100 | ✅ Sufficient | Green |
| 60–79  | 🟡 Adequate   | Yellow |
| 40–59  | 🟠 Low        | Orange |
| 20–39  | 🔴 Critical   | Red |
| 0–19   | ⛔ Emergency  | Dark Red |

Each state produces **specific actionable recommendations** shown on the dashboard (e.g. *"Stop rainwater collection — overflow in ~2.3 hrs"*, *"Deploy backup supply now"*).

---

## Alerts & Notifications

### In-App Alerts
- Generated automatically by AMDA when score drops below the configured threshold
- Stored in browser `localStorage` — **survive page refresh**
- Visible under **Alerts → Alert History**
- Can be cleared with the **"🗑 Clear History"** button

### Push Notifications (Browser)
1. Go to **Alerts → Notification Preferences**
2. Enable **"Push Notifications (Browser)"** toggle
3. Chrome/Edge will ask for permission — click **Allow**
4. Click **"🔔 Test Push Notification"** to verify it works
5. Real alerts fire automatically when AMDA score < 40 (Critical/Emergency)

> ⚠ Push notifications only work in **Google Chrome** or **Microsoft Edge**.
> SMS and Email toggles are saved but require a backend server to send (out of scope for this prototype).

---

## Weather Forecast Integration

- Uses **Open-Meteo API** (free, no API key needed)
- Automatically fetches the 3-day rain forecast on startup
- If your browser allows location access, it uses your real GPS coordinates
- Otherwise defaults to **Metro Manila, Philippines**
- Rain forecast adds an inflow bonus (L/hr) to the AMDA calculation
- View the live forecast result in **AMDA Configuration → Weather Forecast Integration**

---

## Connecting Real Hardware (ESP32)

> Only available when using **Google Chrome** — requires Web Serial API

### What You Need
- ESP32 Dev Module
- HC-SR04 Ultrasonic Sensor (water level)
- YF-S201 Flow Meter × 2 (inflow + outflow)
- DS18B20 Temperature Sensor (optional)
- USB cable

### Quick Start
1. Flash `esp32_sketch.ino` to your ESP32 (see full wiring guide inside the app)
2. Connect ESP32 to your PC via USB
3. Log in as **admin** → go to **Sensor Connect → Live Connection tab**
4. Click **"Connect ESP32"** → select the COM port from the browser popup
5. Watch the Serial Monitor fill with live JSON data
6. All dashboard values and AMDA scores update from real sensor readings
7. Device Management automatically shows the sensor as **Online**

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `python is not recognized` | Install Python from python.org or use `python3` instead |
| Page won't load | Make sure the server is running and you're using `http://localhost:8080` (not `https://`) |
| Login rate limit locked | Wait 60 seconds — locked after 5 failed attempts |
| Push notifications not working | Check site permissions in Chrome: address bar → 🔒 → Notifications → Allow |
| ESP32 not appearing in port list | Install CP2102 or CH340 USB driver for your ESP32 board |
| Weather shows "unavailable" | Check internet connection; the Open-Meteo API requires network access |
| AMDA score seems low | Check your tank capacity setting in Settings matches your real tank size |

---

## File Structure

```
RainGuard/
├── index.html                 ← Login page (Supabase Auth)
├── dashboard.html             ← Main application dashboard
├── script.js                  ← AMDA engine, SensorHub, SerialManager, Supabase client
├── style.css                  ← Design system and styling
├── esp32_sketch.ino           ← Arduino firmware for ESP32 + sensors
├── supabase/
│   └── migrations/
│       └── 0001_init.sql      ← Postgres schema, RLS, realtime
├── docs/superpowers/          ← Design spec + implementation plan
└── README.md                  ← This guide
```

---

## 🛠 Known Issues & Development Tasks

> **Audit date:** 2026-06-08 — from a full review of `script.js`, `dashboard.html`, `index.html`. The backend has since been **migrated from Firebase to Supabase** (Postgres + Auth + Realtime); items resolved by that migration are checked off below. Ordered by severity.

### 🔴 Critical — breaks core functionality

- [x] **Fix AMDA score evaluating to `NaN`** 🔌 — ✅ **Fixed 2026-06-08**
  `AMDA.WEIGHTS` (`script.js:118`) defined only `level`, `inflow`, `rateOfChange` (sums to 0.70), but `compute()` (`script.js:188`) also multiplied by `W.daysSupply` and `W.historical` — keys that didn't exist. Result: `score` was `NaN`. The dashboard showed **"NaN%"**, and `STATES.find()` (NaN ≥ min is always false) silently fell back to "Critical Low" for every reading.
  **Fix applied:** added `daysSupply: 0.15, historical: 0.15` to the `WEIGHTS` object — all five weights now sum to 1.0.

- [x] **Fix silent Firebase write failures for `monitored_state` & `computed_values`** 🔌 — ✅ **Fixed 2026-06-08**
  `_writeToFirebase()` sent `amda_score: NaN` and other NaN-derived fields; Firebase `set()` **throws** on `NaN`, and the error was swallowed by the `catch` (only `console.warn`). So with a real ESP32 connected, `sensor_readings` were written but the AMDA state and computed values **never reached the backend**.
  **Fix applied:** root cause resolved by the weights fix above, **plus** a defensive `clean()` guard now coerces any non-finite number to `null` before every `set()` call, so a single bad value can never abort a write again.

### 🟠 High — architecture & connection gaps

- [x] **Dashboard now reads back live data** — ✅ **Resolved by Supabase migration**
  The dashboard subscribes to `current_status` via Supabase Realtime (`SensorHub.subscribeRemote()`), so any authenticated device reflects live data — fixing the old write-only gap.

- [x] **Database access is now authenticated (RLS)** — ✅ **Resolved by Supabase migration**
  Replaced the publicly read/writable Firebase rules with Supabase Auth + RLS: any authenticated user reads; only `admin` writes (`supabase/migrations/0001_init.sql`).

- [ ] **Backend only updates when an ESP32 is physically connected**
  `SensorHub.simulate()` still never calls `_writeToSupabase()` (`script.js`). With no hardware the backend goes stale. Decide whether simulation should also publish (useful for demoing the remote dashboard).

- [ ] **`sensor_readings` grows unbounded**
  Every reading inserts a row into `public.sensor_readings` (~every 2 s) with no pruning — storage/query cost grows over time.
  **Fix:** schedule periodic pruning/aggregation, or add a retention policy.

### 🟡 Medium — logic & correctness

- [ ] **AMDA state-change alerts never fire**
  `checkAndFireAlert()` (`script.js:1052`) compares `badStates = ['Critical','Emergency']` against `amda.state.label`, but the actual labels are `Critical High / High / Normal / Low / Critical Low` (`script.js:121-127`). They never match, so AMDA-driven alerts are dead code — only tank-status alerts (Overflow/Critical) fire.

- [ ] **AMDA states/labels don't match this README**
  Code uses thresholds 90/70/30/20/0 with labels Critical High/High/Normal/Low/Critical Low (`script.js:121-127`); the README table uses 80/60/40/20/0 with Sufficient/Adequate/Low/Critical/Emergency. Icons are also inconsistent (✅ at 90, 🟠 "Normal", 🔴 "Low").
  **Fix:** pick one scheme and align code + README + the alert logic above.

### 🟢 Low — polish / known limitations

- [ ] **Charts use hardcoded/random demo data** — daily/weekly/monthly/LGU/predictive charts and the CSV export are static placeholders, not yet driven by real `sensor_readings` history (intentionally out of scope for the migration).
- [ ] **`dashboard.html` has no Content-Security-Policy** while `index.html` does. Not a functional bug, but a scoped CSP allowlisting esm.sh + the Supabase origins (https + wss) would harden it.
- [x] **Auth is now server-backed** — ✅ **Resolved by Supabase migration:** real Supabase Auth (email+password) replaces the hardcoded client-side credentials; role comes from the `profiles` table.

### ✅ Completed this session
- [x] **Migrated backend: Firebase → Supabase** — Postgres schema + RLS + Realtime (`supabase/migrations/0001_init.sql`), Supabase Auth login, live read-back, and full Firebase removal. Design + plan in `docs/superpowers/`.
- [x] **ESP32 ultrasonic glitch filtering** — median-of-5 sampling + range gating (`esp32_sketch.ino`).
- [x] **ESP32 flow-meter diagnostics** — `DIAG_MODE` raw pulse output to isolate the dead outflow / intermittent inflow meters.
- [x] **DS18B20 temperature read implemented** — replaces the hardcoded 28 °C with a real, auto-detected probe read (`esp32_sketch.ino`).

---

*RainGuard — Undergraduate Thesis Project*
*AMDA v2 · Web Serial API · Open-Meteo Weather Integration*
