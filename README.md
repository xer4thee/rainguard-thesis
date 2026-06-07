# 💧 RainGuard — Rainwater Monitoring System
### User & Setup Guide

---

## Requirements

| Requirement | Details |
|---|---|
| **Python** | Version 3.x (to run local web server) |
| **Browser** | Google Chrome or Microsoft Edge 89+ (required for sensor connection) |
| **Internet** | Needed for weather forecast feature (Open-Meteo API) |
| **ESP32 + Sensors** | Optional — for live hardware data (see Hardware section below) |

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

| Username | Password | Role | Access |
|---|---|---|---|
| `admin` | `admin123` | Administrator | Full access — all pages including Sensor Connect, AMDA Config, Device Management |
| `user` | `user123` | Regular User | Overview, Tank Monitoring, Alerts, Analytics, Settings |
| `lgu` | `lgu123` | LGU Official | LGU Dashboard, Alerts, Analytics |

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
├── index.html          ← Login page
├── dashboard.html      ← Main application dashboard
├── script.js           ← AMDA engine, SensorHub, SerialManager, all app logic
├── style.css           ← Design system and styling
├── esp32_sketch.ino    ← Arduino firmware for ESP32 + sensors
└── README.md           ← This guide
```

---

*RainGuard — Undergraduate Thesis Project*
*AMDA v2 · Web Serial API · Open-Meteo Weather Integration*
