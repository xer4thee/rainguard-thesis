/**
 * RainGuard — ESP32 Sensor Node
 * ==============================
 * Reads:
 *   • HC-SR04 ultrasonic sensor  → water level (cm → percentage)
 *   • YF-S201 flow meter         → inflow rate  (pulses → L/hr)
 *   • Optional second YF-S201   → outflow rate
 *
 * Outputs a JSON packet over USB Serial every 2 seconds:
 *   {"level":68.4,"inflow":42.1,"outflow":31.5,"temp":28.2,"ts":1234567890}
 *
 * The RainGuard web app reads this stream via the Web Serial API
 * and feeds the values directly into the AMDA engine.
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
 *  │  TRIG        │ GPIO 5                     │
 *  │  ECHO        │ GPIO 18  (3.3V safe via    │
 *  │              │ 1kΩ + 2kΩ voltage divider) │
 *  └──────────────────────────────────────────┘
 *
 *  Voltage divider for ECHO pin (HC-SR04 outputs 5V):
 *    HC-SR04 ECHO ──[1kΩ]──┬──[2kΩ]── GND
 *                           └── GPIO 18 (ESP32)
 *
 *  YF-S201 Flow Meter — INFLOW (Water entering tank)
 *  ┌──────────────────────────────────────────┐
 *  │  YF-S201 Wire │ ESP32 Pin                │
 *  │  Red  (VCC)   │ 5V  (Vin)               │
 *  │  Black (GND)  │ GND                      │
 *  │  Yellow (SIG) │ GPIO 14  (+ 10kΩ pull-up │
 *  │               │  to 3.3V recommended)    │
 *  └──────────────────────────────────────────┘
 *
 *  YF-S201 Flow Meter — OUTFLOW (Water leaving tank) [Optional]
 *  ┌──────────────────────────────────────────┐
 *  │  YF-S201 Wire │ ESP32 Pin                │
 *  │  Red  (VCC)   │ 5V  (Vin)               │
 *  │  Black (GND)  │ GND                      │
 *  │  Yellow (SIG) │ GPIO 27  (+ 10kΩ pull-up)│
 *  └──────────────────────────────────────────┘
 *
 *  DS18B20 Temperature Sensor [Optional — for water quality]
 *  ┌──────────────────────────────────────────┐
 *  │  DS18B20 Pin  │ ESP32 Pin                │
 *  │  VCC          │ 3.3V                     │
 *  │  GND          │ GND                      │
 *  │  DATA         │ GPIO 4  (+ 4.7kΩ pull-up │
 *  │               │  to 3.3V)                │
 *  └──────────────────────────────────────────┘
 *
 *  Required Libraries (install via Arduino Library Manager):
 *    • None for basic operation
 *    • "DallasTemperature" + "OneWire" for DS18B20
 *
 *  Board settings in Arduino IDE:
 *    Board:  "ESP32 Dev Module"
 *    Upload Speed: 115200
 *    Baud Rate: 115200 (must match Serial.begin below)
 *
 * ─────────────────────────────────────────────────────────────
 */

#include <Arduino.h>

/* DS18B20 water-temperature sensor.
   Set ENABLE_DS18B20 to 0 if you don't have the probe or its libraries
   installed — the sketch then falls back to a fixed placeholder temp and
   needs no extra libraries. Requires "OneWire" + "DallasTemperature"
   (install via Arduino Library Manager) when set to 1. */
#define ENABLE_DS18B20   1
#if ENABLE_DS18B20
  #include <OneWire.h>
  #include <DallasTemperature.h>
#endif

/* ── Pin Definitions ── */
#define TRIG_PIN      5     // HC-SR04 trigger
#define ECHO_PIN      18    // HC-SR04 echo (via voltage divider)
#define INFLOW_PIN    14    // YF-S201 inflow signal
#define OUTFLOW_PIN   27    // YF-S201 outflow signal (optional)
#define TEMP_PIN       4    // DS18B20 data line (+ 4.7kΩ pull-up to 3.3V)

/* ── Tank Configuration ── */
#define TANK_HEIGHT_CM      33   // Physical tank height in cm
#define SENSOR_OFFSET_CM      3   // Distance from sensor to water surface at 100% fill

/* ── YF-S201 Calibration ── */
// YF-S201: ~7.5 pulses per second per L/min (factory default)
// Adjust PULSES_PER_LITER for your specific sensor after calibration
#define PULSES_PER_LITER   450.0  // pulses per litre (7.5 p/s * 60s = 450 p/min per L/min)

/* ── Diagnostics & Level Filtering ── */
// DIAG_MODE: when 1, every cycle also prints a "# RAW ..." comment line with the
// raw pulse counts and distance. These lines start with '#' so the web app's
// serial parser ignores them — but you can SEE them in the in-app Serial Monitor.
// Use it to verify flow-meter wiring: run water (or spin the rotor) through each
// meter and watch inflowPulses / outflowPulses climb. If they stay 0, the problem
// is wiring/power/sensor — not this code. Set to 0 for production.
#define DIAG_MODE              1
// The HC-SR04 is read DISTANCE_SAMPLES times per cycle; timeouts and echoes outside
// [DIST_MIN_CM, DIST_MAX_CM] are discarded and the median of the rest is used.
// This kills the spurious "0%" glitch readings caused by single bad echoes.
#define DISTANCE_SAMPLES       5
#define DIST_MIN_CM          2.0    // reject echoes closer than this (noise / sensor face)
#define DIST_MAX_CM         40.0    // reject echoes beyond empty-tank distance + margin

/* ── Globals ── */
volatile unsigned long inflowPulses  = 0;
volatile unsigned long outflowPulses = 0;
unsigned long lastReport = 0;
const unsigned long REPORT_INTERVAL_MS = 2000;

/* ── DS18B20 temperature ── */
const float TEMP_FALLBACK_C = 28.0;   // used when no DS18B20 is detected
#if ENABLE_DS18B20
OneWire oneWire(TEMP_PIN);
DallasTemperature tempSensor(&oneWire);
bool ds18b20Present = false;          // set true in setup() if a probe is found
#endif

/* ── Interrupt Service Routines ── */
void IRAM_ATTR countInflow()  { inflowPulses++;  }
void IRAM_ATTR countOutflow() { outflowPulses++; }

/* ─────────────────────────────────────────
   measureDistanceCM()
   Fires HC-SR04 and returns distance in cm.
   Returns -1 on timeout.
───────────────────────────────────────── */
float measureDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000UL); // 30ms timeout
  if (duration == 0) return -1.0;
  return (duration * 0.0343) / 2.0; // speed of sound = 343 m/s = 0.0343 cm/µs
}

/* ─────────────────────────────────────────
   measureDistanceMedian()
   Takes DISTANCE_SAMPLES readings, discards timeouts and
   out-of-range echoes, and returns the median of what remains.
   Returns -1 if no valid sample was obtained (true sensor error).
   The median rejects the occasional bad echo that otherwise
   showed up as a spurious 0% reading in the stored data.
───────────────────────────────────────── */
float measureDistanceMedian() {
  float valid[DISTANCE_SAMPLES];
  int count = 0;
  for (int i = 0; i < DISTANCE_SAMPLES; i++) {
    float d = measureDistanceCM();
    if (d >= DIST_MIN_CM && d <= DIST_MAX_CM) valid[count++] = d;
    delay(15); // let echoes dissipate between pings
  }
  if (count == 0) return -1.0;

  /* insertion sort the valid samples (small array) */
  for (int i = 1; i < count; i++) {
    float key = valid[i];
    int j = i - 1;
    while (j >= 0 && valid[j] > key) { valid[j + 1] = valid[j]; j--; }
    valid[j + 1] = key;
  }
  return valid[count / 2];
}

/* ─────────────────────────────────────────
   distanceToLevelPct()
   Converts sensor distance reading to tank
   fill percentage (0–100%).
───────────────────────────────────────── */
float distanceToLevelPct(float distCM) {
  if (distCM < 0) return -1.0;
  // Water surface is (distCM) below the sensor.
  // Empty tank → distance ≈ TANK_HEIGHT_CM
  // Full  tank → distance ≈ SENSOR_OFFSET_CM
  float waterDepth = TANK_HEIGHT_CM - distCM;
  float usableHeight = TANK_HEIGHT_CM - SENSOR_OFFSET_CM;
  float pct = (waterDepth / usableHeight) * 100.0;
  return constrain(pct, 0.0, 100.0);
}

/* ─────────────────────────────────────────
   pulsesToLitresPerHr()
   Converts pulse count over interval to L/hr.
───────────────────────────────────────── */
float pulsesToLitresPerHr(unsigned long pulses, float intervalSec) {
  if (intervalSec <= 0) return 0.0;
  float litres = (float)pulses / PULSES_PER_LITER;
  return (litres / intervalSec) * 3600.0; // convert to per-hour
}

/* ─────────────────────────────────────────
   buildJsonPacket()
   Assembles the JSON string for the serial output.
   Format:
     {"level":68.4,"inflow":42.1,"outflow":31.5,"temp":28.2,"ts":1234567}
───────────────────────────────────────── */
String buildJsonPacket(float levelPct, float inflowLPH, float outflowLPH, float tempC) {
  String s = "{";
  s += "\"level\":"   + String(levelPct,  1) + ",";
  s += "\"inflow\":"  + String(inflowLPH, 1) + ",";
  s += "\"outflow\":" + String(outflowLPH,1) + ",";
  s += "\"temp\":"    + String(tempC,     1) + ",";
  s += "\"ts\":"      + String(millis())     + "}";
  return s;
}

/* ─────────────────────────────────────────
   SETUP
───────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10); // Wait for serial port (needed on some boards)

  /* HC-SR04 */
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  /* YF-S201 flow meters — use interrupt-driven pulse counting */
  pinMode(INFLOW_PIN,  INPUT_PULLUP);
  pinMode(OUTFLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(INFLOW_PIN),  countInflow,  FALLING);
  attachInterrupt(digitalPinToInterrupt(OUTFLOW_PIN), countOutflow, FALLING);

  /* DS18B20 temperature probe */
#if ENABLE_DS18B20
  tempSensor.begin();
  ds18b20Present = (tempSensor.getDeviceCount() > 0);
  if (ds18b20Present) {
    tempSensor.setResolution(11);              // 11-bit ≈ 0.125°C, ~375ms conversion
    tempSensor.setWaitForConversion(false);    // non-blocking: read prev value each cycle
    tempSensor.requestTemperatures();          // kick off the first conversion
    Serial.println("# DS18B20 detected on GPIO 4.");
  } else {
    Serial.println("# DS18B20 NOT found — using fallback temp. Check DATA->GPIO4 + 4.7k pull-up to 3.3V.");
  }
#endif

  Serial.println("# RainGuard Sensor Node Ready");
  Serial.println("# Format: {\"level\":%.1f,\"inflow\":%.1f,\"outflow\":%.1f,\"temp\":%.1f,\"ts\":%lu}");
#if DIAG_MODE
  Serial.println("# DIAG_MODE ON — '# RAW ...' lines show raw pulse counts. Run water through each meter and watch the counts. Set DIAG_MODE 0 for production.");
#endif
  lastReport = millis();
}

/* ─────────────────────────────────────────
   LOOP
───────────────────────────────────────── */
void loop() {
  unsigned long now = millis();
  unsigned long elapsed = now - lastReport;

  if (elapsed >= REPORT_INTERVAL_MS) {
    /* ── 1. Snapshot and reset pulse counters atomically ── */
    noInterrupts();
    unsigned long snapInflow  = inflowPulses;  inflowPulses  = 0;
    unsigned long snapOutflow = outflowPulses; outflowPulses = 0;
    interrupts();

    float intervalSec = elapsed / 1000.0;

    /* ── 2. Water level via ultrasonic (median-filtered, glitch-rejecting) ── */
    float distCM   = measureDistanceMedian();
    float levelPct = distanceToLevelPct(distCM);

    /* ── 3. Flow rates ── */
    float inflowLPH  = pulsesToLitresPerHr(snapInflow,  intervalSec);
    float outflowLPH = pulsesToLitresPerHr(snapOutflow, intervalSec);

    /* ── 4. Temperature via DS18B20 (non-blocking: read prior conversion, start next) ── */
    float tempC = TEMP_FALLBACK_C;
#if ENABLE_DS18B20
    if (ds18b20Present) {
      float t = tempSensor.getTempCByIndex(0);   // result of the conversion started last cycle
      if (t != DEVICE_DISCONNECTED_C && t > -55.0 && t < 125.0) tempC = t;
      tempSensor.requestTemperatures();          // kick off next conversion (ready well within 2s)
    }
#endif

    /* ── Diagnostics — raw counts so you can verify flow-meter wiring ── */
#if DIAG_MODE
    Serial.print("# RAW  inflowPulses="); Serial.print(snapInflow);
    Serial.print("  outflowPulses=");     Serial.print(snapOutflow);
    Serial.print("  distCM=");            Serial.print(distCM, 1);
    Serial.print("  levelPct=");          Serial.println(levelPct, 1);
#endif

    /* ── 5. Emit JSON packet ── */
    if (levelPct >= 0) {
      Serial.println(buildJsonPacket(levelPct, inflowLPH, outflowLPH, tempC));
    } else {
      /* Sensor error — emit error status packet */
      Serial.println("{\"error\":\"sensor_timeout\",\"ts\":" + String(millis()) + "}");
    }

    lastReport = now;
  }
}

/*
 * ─────────────────────────────────────────────────────────────
 *  CALIBRATION GUIDE
 * ─────────────────────────────────────────────────────────────
 *
 *  1. HC-SR04 Water Level Calibration:
 *     a) Fill tank to exactly 100% → note distCM value in Serial Monitor
 *        → set SENSOR_OFFSET_CM to that value
 *     b) Empty tank completely → note distCM value
 *        → set TANK_HEIGHT_CM to that value
 *
 *  2. YF-S201 Flow Rate Calibration:
 *     a) Pour exactly 1 litre through the sensor
 *     b) Count the pulses printed in the Serial Monitor
 *     c) Set PULSES_PER_LITER to that count
 *     Note: Factory default is ~450 pulses/litre but varies ±10%
 *
 *  3. Testing connection to web app:
 *     a) Flash this sketch to your ESP32
 *     b) Open RainGuard dashboard as admin
 *     c) Go to "Sensor Connect" page
 *     d) Click "Connect ESP32" → select the COM port
 *     e) Watch the Serial Monitor in the app update in real time
 *
 * ─────────────────────────────────────────────────────────────
 */
