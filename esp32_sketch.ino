/**
 * RainGuard — ESP32 Sensor Node (Supabase)
 * ==========================================
 * Reads:
 *   • HC-SR04 ultrasonic sensor  → water level (cm → percentage)
 *   • YF-S201 flow meter         → inflow rate  (pulses → L/hr)
 *
 * Outputs a JSON packet over USB Serial every 2 seconds AND
 * pushes data to Supabase via HTTPS REST every 10 seconds.
 *
 * ─────────────────────────────────────────────────────────────
 *  WIRING GUIDE
 * ─────────────────────────────────────────────────────────────
 *
 *  HC-SR04 Ultrasonic Sensor (Water Level)
 *  ┌──────────────────────────────────────────┐
 *  │  HC-SR04 Pin │ ESP32 Pin                 │
 *  │  VCC         │ 5V  (Vin)                 │
 *  │  GND         │ GND                        │
 *  │  TRIG        │ GPIO 13                    │
 *  │  ECHO        │ GPIO 12  (via voltage div) │
 *  └──────────────────────────────────────────┘
 *
 *  Voltage divider for ECHO pin (HC-SR04 outputs 5V):
 *    HC-SR04 ECHO ──[1kΩ]──┬──[2kΩ]── GND
 *                           └── GPIO 12 (ESP32)
 *
 *  YF-S201 Flow Meter — INFLOW
 *  ┌──────────────────────────────────────────┐
 *  │  YF-S201 Wire │ ESP32 Pin                │
 *  │  Red  (VCC)   │ 5V  (Vin)               │
 *  │  Black (GND)  │ GND                      │
 *  │  Yellow (SIG) │ GPIO 14 (+ 10kΩ pull-up) │
 *  └──────────────────────────────────────────┘
 *
 *  Board settings in Arduino IDE:
 *    Board:        ESP32 Dev Module
 *    Upload Speed: 115200
 *    Baud Rate:    115200
 *
 *  Required libraries: NONE — WiFi, HTTPClient, WiFiClientSecure
 *  are all built into the ESP32 Arduino core. No library manager
 *  installs needed.
 * ─────────────────────────────────────────────────────────────
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

/* ─────────────────────────────────────────
   WiFi credentials
───────────────────────────────────────── */
#define WIFI_SSID     "MB_WIFI_2G"
#define WIFI_PASSWORD "MB@116127"

/* ─────────────────────────────────────────
   Supabase credentials
   Project URL + anon/public key
   (same values used in your web dashboard)
───────────────────────────────────────── */
#define SUPABASE_URL "https://zhfehohjkafrcwwqexdy.supabase.co"
#define SUPABASE_KEY "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZmVob2hqa2FmcmN3d3FleGR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MzQ5MzUsImV4cCI6MjA5NjQxMDkzNX0.pDXOR0Oqb0h42FliacE14zobu8KUi-xsuBMm-qTzoWU"

#define ENDPOINT_READINGS SUPABASE_URL "/rest/v1/sensor_readings"
#define ENDPOINT_STATUS   SUPABASE_URL "/rest/v1/current_status"

/* ─────────────────────────────────────────
   Pin definitions
───────────────────────────────────────── */
#define TRIG_PIN         13
#define ECHO_PIN         12
#define FLOW_SENSOR_PIN  14

/* ─────────────────────────────────────────
   Tank configuration — YOUR PROTOTYPE
───────────────────────────────────────── */
#define TANK_HEIGHT_CM   33    // physical height of your tank in cm
#define SENSOR_OFFSET_CM  3    // sensor-to-water distance at 100% full

/* ─────────────────────────────────────────
   YF-S201 calibration
───────────────────────────────────────── */
#define PULSES_PER_LITER 450.0

/* ─────────────────────────────────────────
   Timing
───────────────────────────────────────── */
const unsigned long REPORT_INTERVAL_MS   = 2000;   // serial JSON every 2s
const unsigned long SUPABASE_INTERVAL_MS = 10000;  // push to Supabase every 10s

/* ─────────────────────────────────────────
   Globals
───────────────────────────────────────── */
volatile unsigned long inflowPulses = 0;
unsigned long lastReport   = 0;
unsigned long lastSupabase = 0;

/* ─────────────────────────────────────────
   Interrupt service routine
───────────────────────────────────────── */
void IRAM_ATTR countInflow() { inflowPulses++; }

/* ─────────────────────────────────────────
   measureDistanceCM()
───────────────────────────────────────── */
float measureDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) return -1.0;
  return (duration * 0.0343) / 2.0;
}

/* ─────────────────────────────────────────
   distanceToLevelPct()
───────────────────────────────────────── */
float distanceToLevelPct(float distCM) {
  if (distCM < 0) return -1.0;
  float waterDepth   = TANK_HEIGHT_CM - distCM;
  float usableHeight = TANK_HEIGHT_CM - SENSOR_OFFSET_CM;
  return constrain((waterDepth / usableHeight) * 100.0, 0.0, 100.0);
}

/* ─────────────────────────────────────────
   pulsesToLitresPerHr()
───────────────────────────────────────── */
float pulsesToLitresPerHr(unsigned long pulses, float intervalSec) {
  if (intervalSec <= 0) return 0.0;
  float litres = (float)pulses / PULSES_PER_LITER;
  return (litres / intervalSec) * 3600.0;
}

/* ─────────────────────────────────────────
   buildJsonPacket()
   Format the dashboard Web Serial parser expects:
   {"level":45.7,"inflow":0.0,"outflow":0.0,"temp":28.0,"ts":12345}
───────────────────────────────────────── */
String buildJsonPacket(float levelPct, float inflowLPH,
                       float outflowLPH, float tempC) {
  String s = "{";
  s += "\"level\":"   + String(levelPct,  1) + ",";
  s += "\"inflow\":"  + String(inflowLPH, 1) + ",";
  s += "\"outflow\":" + String(outflowLPH,1) + ",";
  s += "\"temp\":"    + String(tempC,     1) + ",";
  s += "\"ts\":"      + String(millis())     + "}";
  return s;
}

/* ─────────────────────────────────────────
   pushToSupabase()
   Sends data to two Supabase tables:
     sensor_readings — INSERT (history row)
     current_status  — UPSERT (latest reading, id=1)
───────────────────────────────────────── */
void pushToSupabase(float levelPct, float inflowLPH,
                    float outflowLPH, float tempC) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Supabase] WiFi not connected — skipping");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // skip SSL cert check — fine for prototype

  /* ── 1. INSERT a new row into sensor_readings ── */
  {
    HTTPClient http;
    http.begin(client, ENDPOINT_READINGS);
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("apikey",        SUPABASE_KEY);
    http.addHeader("Authorization", "Bearer " SUPABASE_KEY);
    http.addHeader("Prefer",        "return=minimal");

    String body = "{";
    body += "\"level_pct\":"   + String(levelPct,  1) + ",";
    body += "\"inflow_lph\":"  + String(inflowLPH, 1) + ",";
    body += "\"outflow_lph\":" + String(outflowLPH,1) + ",";
    body += "\"temp_c\":"      + String(tempC,     1);
    body += "}";

    int code = http.POST(body);
    if (code == 201) {
      Serial.println("[Supabase] sensor_readings INSERT OK");
    } else {
      Serial.print("[Supabase] sensor_readings error: ");
      Serial.print(code);
      Serial.print(" — ");
      Serial.println(http.getString());
    }
    http.end();
  }

  /* ── 2. UPSERT current_status (always keeps one row, id=1) ── */
  {
    HTTPClient http;
    http.begin(client, ENDPOINT_STATUS);
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("apikey",        SUPABASE_KEY);
    http.addHeader("Authorization", "Bearer " SUPABASE_KEY);
    http.addHeader("Prefer",        "resolution=merge-duplicates,return=minimal");

    String body = "{";
    body += "\"id\":1,";
    body += "\"level_pct\":"   + String(levelPct,  1) + ",";
    body += "\"inflow_lph\":"  + String(inflowLPH, 1) + ",";
    body += "\"outflow_lph\":" + String(outflowLPH,1) + ",";
    body += "\"temp_c\":"      + String(tempC,     1);
    body += "}";

    int code = http.POST(body);
    if (code == 200 || code == 201) {
      Serial.println("[Supabase] current_status UPSERT OK");
    } else {
      Serial.print("[Supabase] current_status error: ");
      Serial.print(code);
      Serial.print(" — ");
      Serial.println(http.getString());
    }
    http.end();
  }
}

/* ─────────────────────────────────────────
   SETUP
───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), countInflow, FALLING);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Failed — serial output still works");
  }

  Serial.println("# RainGuard Sensor Node Ready (Supabase)");
  lastReport   = millis();
  lastSupabase = millis();
}

/* ─────────────────────────────────────────
   LOOP
───────────────────────────────────────── */
void loop() {
  unsigned long now     = millis();
  unsigned long elapsed = now - lastReport;

  if (elapsed >= REPORT_INTERVAL_MS) {

    /* 1. Snapshot pulse counter atomically */
    noInterrupts();
    unsigned long snapInflow = inflowPulses;
    inflowPulses = 0;
    interrupts();

    float intervalSec = elapsed / 1000.0;

    /* 2. Water level */
    float distCM   = measureDistanceCM();
    float levelPct = distanceToLevelPct(distCM);
    Serial.print("[Sensor] Raw distance: ");
    Serial.print(distCM);
    Serial.println(" cm");

    /* 3. Flow rates */
    float inflowLPH  = pulsesToLitresPerHr(snapInflow, intervalSec);
    float outflowLPH = 0.0;

    /* 4. Temperature (placeholder — replace with DS18B20 read) */
    float tempC = 28.0;

    /* 5. Emit JSON to Serial (for Web Serial API in dashboard) */
    if (levelPct >= 0) {
      Serial.println(buildJsonPacket(levelPct, inflowLPH, outflowLPH, tempC));
    } else {
      Serial.println("{\"error\":\"sensor_timeout\",\"ts\":"
                     + String(millis()) + "}");
    }

    lastReport = now;

    /* 6. Push to Supabase every 10 seconds */
    if (now - lastSupabase >= SUPABASE_INTERVAL_MS && levelPct >= 0) {
      pushToSupabase(levelPct, inflowLPH, outflowLPH, tempC);
      lastSupabase = now;
    }
  }
}

/*
 * ─────────────────────────────────────────────────────────────
 *  SUPABASE TABLE SETUP — run this SQL in Supabase SQL Editor
 * ─────────────────────────────────────────────────────────────
 *
 * CREATE TABLE sensor_readings (
 *   id           BIGSERIAL PRIMARY KEY,
 *   level_pct    NUMERIC(5,2),
 *   inflow_lph   NUMERIC(8,2),
 *   outflow_lph  NUMERIC(8,2),
 *   temp_c       NUMERIC(5,2),
 *   recorded_at  TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE TABLE current_status (
 *   id           INT PRIMARY KEY DEFAULT 1,
 *   level_pct    NUMERIC(5,2),
 *   inflow_lph   NUMERIC(8,2),
 *   outflow_lph  NUMERIC(8,2),
 *   temp_c       NUMERIC(5,2),
 *   updated_at   TIMESTAMPTZ DEFAULT now()
 * );
 *
 * ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE current_status  ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "esp32 can insert readings"
 *   ON sensor_readings FOR INSERT TO anon WITH CHECK (true);
 *
 * CREATE POLICY "esp32 can upsert status"
 *   ON current_status FOR ALL TO anon
 *   USING (true) WITH CHECK (true);
 *
 * CREATE POLICY "users can read readings"
 *   ON sensor_readings FOR SELECT TO authenticated USING (true);
 *
 * CREATE POLICY "users can read status"
 *   ON current_status FOR SELECT TO authenticated USING (true);
 *
 * ─────────────────────────────────────────────────────────────
 *  CALIBRATION GUIDE
 * ─────────────────────────────────────────────────────────────
 *
 *  1. HC-SR04 Water Level:
 *     a) Fill tank 100% → note distCM → set SENSOR_OFFSET_CM
 *     b) Empty tank     → note distCM → set TANK_HEIGHT_CM
 *     (Your values: TANK_HEIGHT_CM=33, SENSOR_OFFSET_CM=3)
 *
 *  2. YF-S201 Flow Rate:
 *     a) Pour exactly 1 litre through sensor
 *     b) Count pulses in Serial Monitor
 *     c) Set PULSES_PER_LITER to that count
 *
 *  3. Testing Supabase:
 *     Open Serial Monitor → watch for:
 *       [Supabase] sensor_readings INSERT OK
 *       [Supabase] current_status UPSERT OK
 *     Then go to Supabase Dashboard → Table Editor
 *     → sensor_readings to confirm rows are appearing.
 *
 *  4. Testing Web Serial (dashboard):
 *     Dashboard → Sensor Connect → Connect ESP32
 *     → select COM port → live JSON appears in the app.
 * ─────────────────────────────────────────────────────────────
 */
