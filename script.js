/**
 * RainGuard — Main Application Script
 * AMDA v2 • SensorHub • Web Serial API • XSS-hardened
 * Modular structure: Auth, Router, Data, Dashboard, Tank, Alerts, Analytics,
 * Admin, User Mgmt, Device Mgmt, Settings, LGU
 */

const RainGuard = (function () {
  'use strict';

  /* ──────────────────────────────────────────
     CONFIGURATION & STATE
     ────────────────────────────────────────── */
  const DEFAULT_SETTINGS = {
    capacity: 20,
    lowThreshold: 30,
    criticalThreshold: 15,
    overflowThreshold: 95,
    refreshInterval: 5,
    amdaSensitivity: 'medium',
    weatherApi: true,
  };

  const DEFAULT_USERS = [
    { id: 1, username: 'admin',     email: 'admin@rainguard.io',    role: 'admin', status: 'active'   },
    { id: 2, username: 'jdoe',      email: 'jdoe@example.com',      role: 'user',  status: 'active'   },
    { id: 3, username: 'msmith',    email: 'msmith@example.com',    role: 'user',  status: 'active'   },
    { id: 4, username: 'lgu_viewer',email: 'lgu@cityoffice.gov',    role: 'lgu',   status: 'active'   },
    { id: 5, username: 'apark',     email: 'apark@example.com',     role: 'user',  status: 'inactive' },
    { id: 6, username: 'bcruz',     email: 'bcruz@example.com',     role: 'admin', status: 'active'   },
  ];

  const DEFAULT_DEVICES = [
    { id: 'SNS-001', type: 'Water Level', status: 'online',  lastData: '2026-02-16 20:30', calibration: '2026-01-10', assignedTo: 'Tank A' },
    { id: 'SNS-002', type: 'Flow Rate',   status: 'online',  lastData: '2026-02-16 20:28', calibration: '2026-01-10', assignedTo: 'Tank A' },
    { id: 'SNS-003', type: 'Water Level', status: 'offline', lastData: '2026-02-15 14:12', calibration: '2025-12-20', assignedTo: 'Tank B' },
    { id: 'SNS-004', type: 'Quality',     status: 'online',  lastData: '2026-02-16 20:25', calibration: '2026-02-01', assignedTo: 'Tank A' },
    { id: 'SNS-005', type: 'Flow Rate',   status: 'maintenance', lastData: '2026-02-14 09:00', calibration: '2025-11-15', assignedTo: 'Tank C' },
  ];

  /* Live alerts — loaded from Supabase at runtime (see loadAlerts). */
  const DEFAULT_ALERTS = [];

  /* Early-access storage helper (before $ helpers are defined) */
  function loadFromStorageEarly(key, fallback) {
    try { const v = localStorage.getItem('rg_' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }

  let state = {
    role: null,
    user: null,
    currentPage: 'overview',
    waterLevel: 3400,
    settings: {},
    users: [],
    devices: [],
    charts: {},
    intervals: [],
    monitoringPaused: false,  // when true, the live auto-refresh loops stop ticking
  };

  /* ──────────────────────────────────────────
     HELPERS
     ────────────────────────────────────────── */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const fmt = (n) => n.toLocaleString();

  function loadFromStorage(key, fallback) {
    try { const v = localStorage.getItem('rg_' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function saveToStorage(key, val) { localStorage.setItem('rg_' + key, JSON.stringify(val)); }

  /* PH mobile number helpers (mirror the SQL normalize_ph_phone()). */
  function normalizePHPhone(raw) {
    if (!raw) return null;
    const d = String(raw).replace(/[^0-9]/g, '');
    let n;
    if (d.length === 11 && d.startsWith('09')) n = '63' + d.slice(1);
    else if (d.length === 12 && d.startsWith('639')) n = d;
    else if (d.length === 10 && d.startsWith('9')) n = '63' + d;
    else return null;
    return /^639\d{9}$/.test(n) ? '+' + n : null;
  }
  /* +639171234567 → 0917 123 4567 for display. */
  function formatPHPhone(e164) {
    const m = /^\+63(9\d{9})$/.exec(e164 || '');
    if (!m) return e164 || '—';
    const x = '0' + m[1];
    return x.slice(0, 4) + ' ' + x.slice(4, 7) + ' ' + x.slice(7);
  }

  function showToast(msg) {
    let t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1A2138;color:#fff;padding:.7rem 1.5rem;border-radius:8px;font-size:.88rem;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.2);animation:fadeUp .3s ease';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 2500);
  }

  function randBetween(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

  /* ──────────────────────────────────────────
     SECURITY — INPUT SANITIZER
     Never let user-supplied strings reach innerHTML.
     ────────────────────────────────────────── */
  function sanitizeText(str) {
    const d = document.createElement('div');
    d.textContent = String(str == null ? '' : str);
    return d.innerHTML; // entity-encoded, safe for innerHTML use
  }

  /* ──────────────────────────────────────────
     AMDA ENGINE
     Adaptive Multi-parameter Decision Algorithm
     5 weighted parameters + temporal context → score 0-100 → 5 states
     Predictive analytics + actionable recommendations
     ────────────────────────────────────────── */
  const AMDA = {
    /*
     * Parameter weights — must sum to 1.0
     *   P1 Water Level        30%  — current tank fill %
     *   P2 Flow Rate (inflow) 20%  — rate of water coming in
     *   P3 Rate of Change     20%  — trend: is level rising or falling?
     *   P4 Days of Supply     15%  — how long until depletion at current net rate
     *   P5 Historical Pattern 15%  — deviation from the rolling average baseline
     */
    WEIGHTS: { level: 0.30, inflow: 0.20, rateOfChange: 0.20, daysSupply: 0.15, historical: 0.15 },

    /* 5-state output thresholds */
    STATES: [
      { min: 90, label: 'Critical High', cls: 'overflow',   icon: '✅' },
      { min: 70, label: 'High',   cls: 'warning',   icon: '🟡' },
      { min: 30, label: 'Normal',        cls: 'normal',      icon: '🟠' },
      { min: 20, label: 'Low',   cls: 'low', icon: '🔴' },
      { min: 0,  label: 'Critical Low',  cls: 'critical', icon: '⛔' },
    ],

    /**
     * Full AMDA computation.
     * @param {object} p
     * @param {number}   p.levelPct    Tank fill %  (0-100)
     * @param {number}   p.inflowLPH   Inflow  L/hr
     * @param {number}   p.outflowLPH  Outflow L/hr
     * @param {number}   p.capacityL   Tank capacity in litres
     * @param {Array}    p.history     SensorHub._history snapshot
     * @returns {{score, state, breakdown, predictions, recommendations, daysRemaining}}
     */
    compute(p) {
      const { levelPct, inflowLPH, outflowLPH, capacityL, history = [], horizonDays = 7 } = p;
      const W = this.WEIGHTS;

      /* ── P1: Water Level (0-100) ── */
      const s1 = Math.min(100, Math.max(0, levelPct));

      /* ── P2: Flow Rate — inflow normalised to 80 L/hr = 100% excellent ── */
      const s2 = Math.min(100, (inflowLPH / 80) * 100);

      /* ── P3: Rate of Change — is the tank trending up or down? ──
         Uses the last 5 history points.
         +10%/window → score 100, -10%/window → score 0, neutral → 50 */
      let s3 = 50; // neutral when no history
      if (history.length >= 2) {
        const slice = history.slice(-Math.min(6, history.length));
        const delta = slice[slice.length - 1].levelPct - slice[0].levelPct;
        s3 = Math.min(100, Math.max(0, 50 + delta * 4));
      }

      /* ── P4: Days of Supply ──
         Scored against the configured forecast horizon (default 7 days).
         If outflow > inflow → draining → compute depletion time
         If inflow >= outflow → filling → assume horizon+1 days (max score) */
      const currentL      = (levelPct / 100) * capacityL;
      const netHourlyDef  = outflowLPH - inflowLPH; // positive = draining
      const daysRemaining = netHourlyDef > 0 ? currentL / (netHourlyDef * 24) : (horizonDays + 1);
      const s4 = Math.min(100, (daysRemaining / horizonDays) * 100); // horizon days = 100 score

      /* ── P5: Historical Pattern — deviation from rolling 20-reading baseline ──
         If current level is above historical average → good (score > 50)
         If below → bad (score < 50) */
      let s5 = 50;
      if (history.length >= 5) {
        const window = history.slice(-Math.min(20, history.length));
        const avg = window.reduce((sum, h) => sum + h.levelPct, 0) / window.length;
        const deviation = levelPct - avg;          // positive = above average
        s5 = Math.min(100, Math.max(0, 50 + deviation * 2));
      }

      /* ── Temporal Context Multiplier ──
         Peak usage hours (morning 6-9am, evening 6-9pm) → slight penalty
         Night hours → slight bonus (low usage expected) */
      const hour = new Date().getHours();
      const isPeak  = (hour >= 6 && hour <= 9) || (hour >= 18 && hour <= 21);
      const isNight = hour >= 22 || hour < 5;
      const tempMult = isPeak ? 0.96 : isNight ? 1.02 : 1.0;

      /* ── Composite Score ── */
      const raw   = (s1 * W.level) + (s2 * W.inflow) + (s3 * W.rateOfChange) + (s4 * W.daysSupply) + (s5 * W.historical);
      const score = Math.round(Math.min(100, Math.max(0, raw * tempMult)));
      const state = this.STATES.find(st => score >= st.min) || this.STATES[4];

      /* ── Predictive Analytics ── */
      const netFillHourly   = inflowLPH - outflowLPH; // positive = filling
      const spaceLeft       = capacityL - currentL;
      const timeToOverflowH = netFillHourly > 0 ? spaceLeft / netFillHourly : null;
      const timeToDepleteH  = netHourlyDef > 0  ? currentL / netHourlyDef   : null;
      const trend           = this._getTrend(history);
      const consumptionTrend= this._getConsumptionTrend(history);

      /* ── Actionable Recommendations ── */
      const recommendations = this._getRecommendations({
        levelPct, inflowLPH, outflowLPH, score,
        daysRemaining, timeToOverflowH, timeToDepleteH, trend,
      });

      return {
        score,
        state,
        breakdown: {
          s1: Math.round(s1), s2: Math.round(s2), s3: Math.round(s3),
          s4: Math.round(s4), s5: Math.round(s5),
          temporalCtx: isPeak ? 'Peak Usage' : isNight ? 'Night (low usage)' : 'Normal',
        },
        daysRemaining: Math.round(Math.min(30, daysRemaining)),
        predictions: {
          timeToOverflowH: timeToOverflowH !== null ? +timeToOverflowH.toFixed(1) : null,
          timeToDepleteH:  timeToDepleteH  !== null ? +timeToDepleteH.toFixed(1)  : null,
          trend,
          consumptionTrend,
        },
        recommendations,
      };
    },

    /* Returns level trend based on recent history */
    _getTrend(history) {
      if (history.length < 3) return 'stable';
      const slice = history.slice(-Math.min(8, history.length));
      const delta = slice[slice.length - 1].levelPct - slice[0].levelPct;
      if (delta >  3) return 'rising';
      if (delta < -3) return 'falling';
      return 'stable';
    },

    /* Returns consumption trend: increasing / stable / decreasing */
    _getConsumptionTrend(history) {
      if (history.length < 6) return 'stable';
      const half = Math.floor(history.length / 2);
      const older = history.slice(0, half);
      const newer = history.slice(half);
      const avgOld = older.reduce((s, h) => s + h.outflowLPH, 0) / older.length;
      const avgNew = newer.reduce((s, h) => s + h.outflowLPH, 0) / newer.length;
      const diff = avgNew - avgOld;
      if (diff >  5) return 'increasing';
      if (diff < -5) return 'decreasing';
      return 'stable';
    },

    /**
     * Generate specific, context-aware actionable recommendations.
     * These go beyond simple status — they tell users exactly what to do.
     */
    _getRecommendations({ levelPct, inflowLPH, outflowLPH, score,
                          daysRemaining, timeToOverflowH, timeToDepleteH, trend }) {
      const recs = [];

      /* ── Overflow prevention ── */
      if (timeToOverflowH !== null && timeToOverflowH < 2) {
        recs.push({ priority: 'danger',  text: '⛔ Stop rainwater collection NOW — overflow in ~' + timeToOverflowH + ' hr(s).' });
      } else if (timeToOverflowH !== null && timeToOverflowH < 8) {
        recs.push({ priority: 'warning', text: '⚠️ Prepare to divert or stop collection — overflow in ~' + timeToOverflowH + ' hr(s).' });
      } else if (levelPct >= 90) {
        recs.push({ priority: 'warning', text: '⚠️ Tank above 90% — consider stopping collection to prevent overflow.' });
      }

      /* ── Depletion prevention ── */
      if (daysRemaining < 1) {
        recs.push({ priority: 'danger',  text: '🚨 Tank will be EMPTY within hours. Activate backup water supply immediately.' });
        recs.push({ priority: 'danger',  text: '📞 Report critical shortage to LGU water management office.' });
      } else if (daysRemaining < 2) {
        recs.push({ priority: 'danger',  text: '🛢️ Only ~' + daysRemaining.toFixed(1) + ' day(s) of supply remaining. Deploy backup supply now.' });
        recs.push({ priority: 'warning', text: '🚿 Immediately stop all non-essential usage (gardening, washing vehicles).' });
      } else if (daysRemaining < 5) {
        recs.push({ priority: 'warning', text: '💧 ~' + Math.round(daysRemaining) + ' day(s) remaining — reduce consumption by at least 30%.' });
        recs.push({ priority: 'info',    text: '🛢️ Prepare a backup water supply in advance.' });
      } else if (daysRemaining < 7) {
        recs.push({ priority: 'info',    text: '👁️ ~' + Math.round(daysRemaining) + ' day(s) of supply — monitor usage and avoid waste.' });
      }

      /* ── Collection guidance ── */
      if (trend === 'falling' && inflowLPH < outflowLPH * 0.5) {
        recs.push({ priority: 'warning', text: '📉 Inflow is much lower than outflow. Check for blocked collection pipes or dry conditions.' });
      }
      if (trend === 'rising' && levelPct < 80) {
        recs.push({ priority: 'info',    text: '📈 Tank is filling well. Continue normal collection.' });
      }

      /* ── Healthy state ── */
      if (score >= 80 && recs.length === 0) {
        recs.push({ priority: 'success', text: '✅ System is healthy. Continue current collection and usage patterns.' });
        if (inflowLPH > outflowLPH * 1.5) {
          recs.push({ priority: 'info', text: '💡 Strong inflow detected — good time to increase usage or fill reserves.' });
        }
      }

      /* ── Fallback ── */
      if (levelPct >= 90) {
  recs.push({ priority: 'success', text: '🌱 Tank is full — great time to water your garden or plants (non-potable use only).' });
  recs.push({ priority: 'success', text: '🚗 Good time for car washing, driveway, or outdoor area cleaning.' });
  recs.push({ priority: 'success', text: '🪣 Consider filling reserve containers before overflow occurs.' });
} else if (levelPct >= 70) {
  recs.push({ priority: 'info', text: '🌻 Good for garden irrigation, potted plants, and lawn care.' });
  recs.push({ priority: 'info', text: '🧹 Suitable for outdoor cleaning: pathways, fences, outdoor furniture.' });
  recs.push({ priority: 'info', text: '🚽 Safe for toilet flushing and non-contact household cleaning.' });
} else if (levelPct >= 30) {
  recs.push({ priority: 'info', text: '✅ Normal range — safe for toilet flushing, floor mopping, and garden watering.' });
  recs.push({ priority: 'info', text: '🧺 Suitable for pre-rinsing laundry or washing non-food items.' });
} else if (levelPct >= 20) {
  recs.push({ priority: 'warning', text: '⚠️ Running low — prioritize toilet flushing only. Suspend gardening and car washing.' });
  recs.push({ priority: 'warning', text: '🚫 Avoid large-volume tasks: mopping large areas, laundry pre-rinse.' });
} else {
  recs.push({ priority: 'danger', text: '🚨 CRITICAL — suspend all non-essential water use immediately.' });
  recs.push({ priority: 'danger', text: '📞 Alert all household members. Switch to municipal or backup water source.' });
}

/* ── Non-potable disclaimer — ALWAYS shown last ── */
recs.push({ priority: 'info', text: '⚠️ Reminder: All collected rainwater is for non-potable use only — not for drinking or cooking.' });

/* ── Fallback if no recs were added at all ── */
if (recs.length === 1) { // only disclaimer was added
  recs.unshift({ priority: 'info', text: '👁️ Monitor tank levels. Maintain current consumption.' });
}

      return recs;
    },
  };

  /* ──────────────────────────────────────────
     SENSOR HUB
     Central store for live sensor readings.
     Falls back to simulation when no hardware connected.
     ────────────────────────────────────────── */
  const SensorHub = {
    live: false,  // true when real serial data is flowing
    latest: {
      levelPct:   68,
      inflowLPH:  45,
      outflowLPH: 30,
      tempC:      28,
      ts:         Date.now(),
    },
    _history: [],
    MAX_HISTORY: 120,

    /** Called by SerialManager when a valid JSON packet arrives */
    ingest(packet) {
      if (typeof packet.level   === 'number') this.latest.levelPct   = Math.min(100, Math.max(0, packet.level));
      if (typeof packet.inflow  === 'number') this.latest.inflowLPH  = Math.max(0, packet.inflow);
      if (typeof packet.outflow === 'number') this.latest.outflowLPH = Math.max(0, packet.outflow);
      if (typeof packet.temp    === 'number') this.latest.tempC       = packet.temp;
      this.latest.ts = Date.now();
      this.live      = true;

      /* Keep rolling history */
      this._history.push({ ...this.latest, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
      if (this._history.length > this.MAX_HISTORY) this._history.shift();

      /* Sync waterLevel state so existing functions still work */
     state.waterLevel = Math.round((this.latest.levelPct / 100) * (state.settings.capacity || 20));

      /* Write to Supabase */
      this._writeToSupabase();
    },

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
    },

    /* Remote read-back state — when fresh, the dashboard renders live Supabase
       data instead of the local simulation. */
    remoteActive: false,
    remoteTs: 0,
    remoteStatus: null,
    REMOTE_STALE_MS: 30000,
    isRemoteFresh() { return this.remoteActive && (Date.now() - this.remoteTs) < this.REMOTE_STALE_MS; },

    /** Live read-back: subscribe to sensor_readings (raw values) and current_status
     *  (AMDA summary) so any logged-in device reflects live data without a serial feed. */
    subscribeRemote() {
      const sb = window._supabase;
      if (!sb) return;
      /* seed once so a fresh page isn't blank */
      sb.from('sensor_readings').select('*').order('recorded_at', { ascending: false }).limit(1)
        .then(({ data }) => { if (data && data[0]) this._applyRemoteReading(data[0]); });
      sb.from('current_status').select('*').eq('id', 1).single()
        .then(({ data }) => { if (data) this._applyRemoteStatus(data); });

      sb.channel('rg-readings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
            payload => this._applyRemoteReading(payload.new))
        .subscribe();
      sb.channel('rg-status')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'current_status' },
            payload => this._applyRemoteStatus(payload.new))
        .subscribe();
    },

    /* Populate latest sensor values from a remote reading (local serial always wins). */
    _applyRemoteReading(row) {
      if (this.live || !row) return;
      if (typeof row.level_percent === 'number') this.latest.levelPct   = row.level_percent;
      if (typeof row.inflow_lph    === 'number') this.latest.inflowLPH  = row.inflow_lph;
      if (typeof row.outflow_lph   === 'number') this.latest.outflowLPH = row.outflow_lph;
      if (typeof row.temp_c        === 'number') this.latest.tempC      = row.temp_c;
      this.latest.ts    = Date.now();
      this.remoteActive = true;
      this.remoteTs     = Date.now();
      this._history.push({ ...this.latest, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
      if (this._history.length > this.MAX_HISTORY) this._history.shift();
      state.waterLevel = Math.round((this.latest.levelPct / 100) * (state.settings.capacity || 20));
    },

    /* Store remote AMDA summary + flag freshness for the "Remote" indicator. */
    _applyRemoteStatus(row) {
      if (this.live || !row) return;
      this.remoteStatus = row;
      this.remoteActive = true;
      this.remoteTs     = Date.now();
      const upd = document.getElementById('tankLastUpdated');
      if (upd && row.updated_at) upd.textContent = '🛰 Remote — ' + new Date(row.updated_at).toLocaleTimeString();
    },

    /** Tick the simulation one step (used when live === false) */
    simulate() {
      const cap = state.settings.capacity || 20;
      /* Per-tick flow scaled to tank size so it works for any capacity (e.g. a 20 L prototype). */
      const inflow  = randBetween(0, Math.max(1, Math.round(cap * 0.12)));
      const outflow = randBetween(0, Math.max(1, Math.round(cap * 0.10)));
      state.waterLevel = Math.max(Math.round(cap * 0.05), Math.min(cap, state.waterLevel + (inflow - outflow)));
      this.latest.levelPct   = Math.min(100, Math.round((state.waterLevel / cap) * 100));
      this.latest.inflowLPH  = inflow;
      this.latest.outflowLPH = outflow;
      this.latest.ts = Date.now();
      this._history.push({ ...this.latest, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
      if (this._history.length > this.MAX_HISTORY) this._history.shift();
    },

    /** Run AMDA on latest readings, passing full history for context */
    runAmda() {
      const cfg = loadFromStorage('amdaConfig', { horizon: 7 });
      return AMDA.compute({
        levelPct:    this.latest.levelPct,
        inflowLPH:   this.latest.inflowLPH  + (this.weatherBonus || 0),
        outflowLPH:  this.latest.outflowLPH,
        capacityL:   state.settings.capacity || 20,
        history:     this._history,
        horizonDays: cfg.horizon || 7,
      });
    },

    /** Fetch rain forecast via Open-Meteo (free, no key, CORS-ok)
     *  Updates this.weatherBonus — extra inflow L/hr expected from rain */
    async fetchWeather(lat, lon) {
      const cfg = loadFromStorage('amdaConfig', { weather: true, horizon: 7 });
      if (!cfg.weather) { this.weatherBonus = 0; return; }
      try {
        const days = Math.min(16, cfg.horizon || 7);
        const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum&forecast_days=${days}&timezone=auto`;
        const res  = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const precip = data.daily?.precipitation_sum || [];
        /* Average daily rainfall mm → rough inflow L/hr bonus
           Assume 1mm rain over a 10m² collection area → 10L per mm
           Spread over 24 hrs → mm * 10 / 24 L/hr extra inflow */
        const avgMM = precip.slice(0, 3).reduce((s, v) => s + (v || 0), 0) / Math.max(1, Math.min(3, precip.length));
        this.weatherBonus  = +(avgMM * 10 / 24).toFixed(2);
        this.weatherSummary = precip.slice(0, 3).map((mm, i) => `Day ${i+1}: ${(mm||0).toFixed(1)}mm`).join(' | ');
        /* Update UI if element exists */
        const el = document.getElementById('weatherForecastText');
        if (el) el.textContent = `☔ Rain forecast: ${this.weatherSummary} → +${this.weatherBonus} L/hr inflow bonus`;
        const wb = document.getElementById('weatherBonusBadge');
        if (wb) wb.textContent = '+' + this.weatherBonus + ' L/hr (rain)';
      } catch (e) {
        console.warn('Open-Meteo fetch failed:', e.message);
        this.weatherBonus = 0;
        const el = document.getElementById('weatherForecastText');
        if (el) el.textContent = '⚠ Weather forecast unavailable (check internet connection).';
      }
    },
  };

  /* ──────────────────────────────────────────
     SERIAL MANAGER
     Web Serial API — connects to ESP32 over USB.
     ────────────────────────────────────────── */
  const SerialManager = {
    port:   null,
    reader: null,
    active: false,
    _buf:   '',
    _logEl: null,  // textarea for serial monitor

    supported() { return 'serial' in navigator; },

    async connect() {
      if (!this.supported()) { showToast('Web Serial API not supported. Use Chrome/Edge 89+.'); return; }
      try {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: 115200 });
        this.active = true;
        this._updateUI(true);
        /* Mark first flow-rate or water-level sensor device as online */
        this._syncDeviceStatus('online');
        showToast('ESP32 connected! Receiving sensor data.');
        this._readLoop();
      } catch (err) {
        if (err.name !== 'NotFoundError') showToast('Connection failed: ' + err.message);
      }
    },

    async disconnect() {
      this.active = false;
      try {
        if (this.reader) { await this.reader.cancel(); this.reader = null; }
        if (this.port)   { await this.port.close();    this.port   = null; }
      } catch (_) {}
      SensorHub.live = false;
      this._syncDeviceStatus('offline');
      this._updateUI(false);
      showToast('ESP32 disconnected. Simulation mode active.');
    },

    /* Update the status of hardware sensor devices in the device list */
    _syncDeviceStatus(status) {
      const targets = ['Water Level', 'Flow Rate'];
      let changed = false;
      state.devices.forEach(d => {
        if (targets.includes(d.type)) {
          d.status  = status;
          d.lastData = status === 'online' ? new Date().toISOString().slice(0, 16).replace('T', ' ') : d.lastData;
          changed = true;
        }
      });
      if (changed) {
        saveToStorage('devices', state.devices);
        /* Re-render device table if on that page */
        if (state.currentPage === 'device-mgmt') {
          if (typeof renderDeviceTable === 'function') renderDeviceTable();
        }
      }
    },

    async _readLoop() {
      const decoder = new TextDecoder();
      try {
        while (this.port && this.port.readable && this.active) {
          this.reader = this.port.readable.getReader();
          try {
            while (true) {
              const { value, done } = await this.reader.read();
              if (done) break;
              this._buf += decoder.decode(value, { stream: true });
              let nl;
              while ((nl = this._buf.indexOf('\n')) !== -1) {
                const line = this._buf.slice(0, nl).trim();
                this._buf  = this._buf.slice(nl + 1);
                this._parseLine(line);
              }
            }
          } finally {
            this.reader.releaseLock();
          }
        }
      } catch (err) {
        if (this.active) { showToast('Serial error: ' + err.message); this.disconnect(); }
      }
    },

    _parseLine(line) {
      /* Log to serial monitor textarea */
      if (this._logEl) {
        /* textContent append — XSS safe */
        this._logEl.textContent += line + '\n';
        this._logEl.scrollTop = this._logEl.scrollHeight;
      }
      if (!line.startsWith('{')) return; // skip comment lines
      try {
        const pkt = JSON.parse(line);
        /* Validate: all numeric sensor fields must be finite numbers */
        const safeKeys = ['level', 'inflow', 'outflow', 'temp'];
        const validated = {};
        safeKeys.forEach(k => {
          if (k in pkt && Number.isFinite(pkt[k])) validated[k] = pkt[k];
        });
        if ('level' in validated) SensorHub.ingest(validated);
        this._updatePacketDisplay(pkt);
      } catch (_) { /* malformed JSON — ignore */ }
    },

    _updateUI(connected) {
      const btn     = document.getElementById('serialConnectBtn');
      const status  = document.getElementById('serialStatus');
      const indicator = document.getElementById('serialIndicator');
      if (btn)       { btn.textContent = connected ? 'Disconnect ESP32' : 'Connect ESP32'; }
      if (status)    { status.textContent = connected ? 'Connected' : 'Disconnected'; }
      if (indicator) { indicator.className = 'status-badge ' + (connected ? 'normal' : 'inactive'); }
    },

    _updatePacketDisplay(pkt) {
      const el = document.getElementById('serialLastPacket');
      if (el) {
        /* Use textContent — no HTML injection from serial data */
        el.textContent = 'Level: ' + (pkt.level ?? '—') + '%  |  '
          + 'Inflow: ' + (pkt.inflow ?? '—') + ' L/hr  |  '
          + 'Outflow: ' + (pkt.outflow ?? '—') + ' L/hr  |  '
          + 'Temp: ' + (pkt.temp ?? '—') + '°C';
      }
      /* Update live sensor cards */
      const liveLevel = document.getElementById('liveLevel');
      const liveIn    = document.getElementById('liveInflow');
      const liveOut   = document.getElementById('liveOutflow');
      if (liveLevel) liveLevel.textContent = (pkt.level ?? '—') + '%';
      if (liveIn)    liveIn.textContent    = (pkt.inflow  ?? '—') + ' L/hr';
      if (liveOut)   liveOut.textContent   = (pkt.outflow ?? '—') + ' L/hr';
    },
  };

  /* ──────────────────────────────────────────
     AUTH
     ────────────────────────────────────────── */
  async function checkAuth() {
    const sb = window._supabase;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return false; }
    const { data: profile } = await sb
      .from('profiles').select('username, role, status').eq('id', session.user.id).single();
    if (profile && profile.status === 'inactive') {
      await sb.auth.signOut();
      window.location.href = 'login.html';
      return false;
    }
    state.role = profile?.role || 'user';
    state.user = profile?.username || session.user.email;
    return true;
  }

  async function logout() {
    await window._supabase.auth.signOut();
    window.location.href = 'index.html';
  }

  /* ──────────────────────────────────────────
     ROUTER
     ────────────────────────────────────────── */
  function navigate(page) {
    window.location.hash = page;
  }

  function handleRoute() {
    let hash = window.location.hash.replace('#', '') || getDefaultPage();
    // Validate the page exists
    if (!$('#page-' + hash)) hash = getDefaultPage();
    // Access check
    if (!canAccess(hash)) hash = getDefaultPage();

    state.currentPage = hash;
    // Hide all sections
    $$('.page-section').forEach(s => s.classList.add('hidden'));
    // Show target
    const target = $('#page-' + hash);
    if (target) target.classList.remove('hidden');
    // Update sidebar active
    $$('#sidebarNav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-page') === hash);
    });
    // Update navbar active
    $$('#navbarLinks a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-nav') === hash);
    });
    // Update bottom nav
    $$('#bottomNavItems a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-nav') === hash);
    });
    // Close mobile sidebar
    if ($('#sidebar')) $('#sidebar').classList.remove('open');
    if ($('#sidebarOverlay')) $('#sidebarOverlay').classList.remove('show');

    // Initialise page-specific content
    initPage(hash);
  }

  function getDefaultPage() {
    if (state.role === 'admin') return 'admin-overview';
    if (state.role === 'lgu') return 'lgu-dashboard';
    return 'overview';
  }

  function canAccess(page) {
    const adminPages = ['admin-overview', 'user-mgmt', 'device-mgmt', 'amda-config', 'sensor-connect'];
    const lguPages = ['lgu-dashboard'];
    /* LGU may also view the shared monitoring + reporting pages (read-only). */
    const lguAllowed = ['overview', 'tank', 'analytics', 'alerts'];
    if (adminPages.includes(page) && state.role !== 'admin') return false;
    if (lguPages.includes(page) && state.role !== 'lgu') return false;
    if (state.role === 'lgu' && !lguPages.includes(page) && !lguAllowed.includes(page)) return false;
    return true;
  }

  /* ──────────────────────────────────────────
     UI SETUP
     ────────────────────────────────────────── */
  function setupUI() {
    // User info
    const name = state.user || 'User';
    $('#navUserName').textContent = name.charAt(0).toUpperCase() + name.slice(1);
    $('#navUserRole').textContent = state.role;
    $('#navAvatar').textContent = name.charAt(0).toUpperCase();

    // Role-based sidebar visibility
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', state.role !== 'admin'));
    $$('.lgu-only').forEach(el => el.classList.toggle('hidden', state.role !== 'lgu'));

    // Hide settings in navbar for LGU
    if (state.role === 'lgu') {
      const settingsLink = document.querySelector('#navbarLinks a[data-nav="settings"]');
      if (settingsLink) settingsLink.parentElement.classList.add('hidden');
    }

    // For user role → show user-related items in sidebar, hide admin sidebar items already handled
    // For LGU → update bottom nav
    if (state.role === 'lgu') {
      const bottomItems = $('#bottomNavItems');
      bottomItems.innerHTML = `
        <li><a href="#lgu-dashboard" data-nav="lgu-dashboard" class="active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Home</a></li>
        <li><a href="#alerts" data-nav="alerts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Alerts</a></li>
        <li><a href="#analytics" data-nav="analytics">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Analytics</a></li>
      `;
    }

    // Hamburger
    $('#hamburgerBtn').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
      $('#sidebarOverlay').classList.toggle('show');
    });
    $('#sidebarOverlay').addEventListener('click', () => {
      $('#sidebar').classList.remove('open');
      $('#sidebarOverlay').classList.remove('show');
    });

    // Logout
    $('#logoutBtn').addEventListener('click', logout);

    // Sidebar nav clicks
    $$('#sidebarNav a').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(a.getAttribute('data-page'));
      });
    });

    // Navbar link clicks
    $$('#navbarLinks a').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(a.getAttribute('data-nav'));
      });
    });

    // Bottom nav clicks  
    document.addEventListener('click', (e) => {
      const link = e.target.closest('#bottomNavItems a');
      if (link) {
        e.preventDefault();
        navigate(link.getAttribute('data-nav'));
      }
    });

    // Modal close
    $('#modalCloseBtn').addEventListener('click', closeModal);
    $('#modalCancelBtn').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
  }

  /* ──────────────────────────────────────────
     PAGE-SPECIFIC INIT
     ────────────────────────────────────────── */
  let pagesInitialized = {};

  function initPage(page) {
    switch (page) {
      case 'overview':
        if (!pagesInitialized.overview) { initOverviewCharts(); pagesInitialized.overview = true; }
        updateOverview();
        break;
      case 'tank':
        if (!pagesInitialized.tank) { initTankCharts(); startTankSimulation(); pagesInitialized.tank = true; }
        break;
      case 'alerts':
        loadAlerts();
        initAlertPrefs();
        break;
      case 'analytics':
        if (!pagesInitialized.analytics) { initAnalyticsCharts(); pagesInitialized.analytics = true; }
        break;
      case 'admin-overview':
        break;
      case 'user-mgmt':
        initUserMgmt();
        break;
      case 'device-mgmt':
        initDeviceMgmt();
        break;
      case 'settings':
        initSettings();
        break;
      case 'amda-config':
        initAmdaConfig();
        break;
      case 'sensor-connect':
        initSensorConnect();
        break;
      case 'lgu-dashboard':
        if (!pagesInitialized.lgu) { initLguCharts(); pagesInitialized.lgu = true; }
        break;
    }
  }

  /* ──────────────────────────────────────────
     OVERVIEW DASHBOARD
     ────────────────────────────────────────── */
  function updateOverview() {
    if (!SensorHub.live && !SensorHub.isRemoteFresh()) SensorHub.simulate();
    const cap    = state.settings.capacity || 20;
    const pct    = SensorHub.latest.levelPct;
    const status = getStatus(pct);
    const amda   = SensorHub.runAmda();

    $('#statWaterLevel').textContent = fmt(state.waterLevel) + ' L';
    $('#statTankStatus').textContent = status.label;
    $('#statStatusBadge').className  = 'status-badge ' + status.cls;
    $('#statStatusBadge').innerHTML  = '<span class="dot"></span>' + sanitizeText(status.label);

    $('#tankWater').style.height  = pct + '%';
    $('#tankPercent').textContent = pct + '%';
    $('#tankCapacity').textContent = fmt(cap) + ' L';
    $('#tankLastUpdated').textContent = (SensorHub.live ? '🟢 Live — ' : SensorHub.isRemoteFresh() ? '🛰 Remote — ' : '⚙ Simulated — ') + new Date().toLocaleTimeString();

    $('#tankInflow').textContent  = SensorHub.latest.inflowLPH.toFixed(1)  + ' L/hr';
    $('#tankOutflow').textContent = SensorHub.latest.outflowLPH.toFixed(1) + ' L/hr';

    const tbadge = $('#tankStatusBadge');
    tbadge.className = 'status-badge ' + status.cls;
    tbadge.innerHTML = '<span class="dot"></span>' + sanitizeText(status.label);

    /* AMDA overview widgets — score + state */
    const amdaScore = $('#statAMDA');
    if (amdaScore) amdaScore.textContent = amda.score + '% — ' + amda.state.icon + ' ' + amda.state.label;
    const amdaPred = $('#amdaPrediction');
    if (amdaPred)  amdaPred.textContent  = amda.score + '%';
    const amdaBar  = $('#amdaProgressBar');
    if (amdaBar)   amdaBar.style.width   = amda.score + '%';

    /* Predictions summary */
    const amdaText = $('#amdaInsightText');
    if (amdaText) {
      const p = amda.predictions;
      let summary = amda.state.icon + ' ' + amda.state.label + ' | Days of supply: ~' + amda.daysRemaining + 'd';
      if (p.timeToOverflowH !== null) summary += ' | Overflow in: ~' + p.timeToOverflowH + 'hr';
      if (p.timeToDepleteH  !== null) summary += ' | Depletion in: ~' + (p.timeToDepleteH / 24).toFixed(1) + 'd';
      summary += ' | Trend: ' + p.trend + ' | Consumption: ' + p.consumptionTrend;
      amdaText.textContent = summary;
    }

    /* Render actionable recommendations */
    renderRecommendations('amdaRecommendations', amda.recommendations);

    /* Active-alerts count + analytics AMDA confidence (kept in sync from the overview tick) */
    const statAlertsEl = $('#statAlerts');
    if (statAlertsEl) statAlertsEl.textContent = DEFAULT_ALERTS.length;
    const analyticsAmdaEl = $('#analyticsAmdaPct');
    if (analyticsAmdaEl) analyticsAmdaEl.textContent = amda.score + '%';

    /* Per-card "last updated" timestamps (Overview = snapshot view) */
    const _upd = 'Updated ' + new Date(SensorHub.latest.ts).toLocaleTimeString();
    ['statWaterUpdated', 'statAlertsUpdated', 'statAmdaUpdated'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = _upd;
    });
    const ovLast = document.getElementById('overviewLastUpdated');
    if (ovLast) ovLast.textContent = '(as of ' + new Date(SensorHub.latest.ts).toLocaleTimeString() + ')';

    /* State-change alert — fires from Overview page too */
    checkAndFireAlert(amda, getStatus(pct));

    /* Auto push-notify on critical / emergency */
    if (amda.score < 40) pushNotify(amda.state.icon + ' RainGuard ' + amda.state.label, amda.recommendations[0]?.text || '');
  }

  function getStatus(pct) {
    const s = state.settings;
    if (pct >= (s.overflowThreshold || 95)) return { label: 'Overflow', cls: 'overflow' };
    if (pct <= (s.criticalThreshold || 15)) return { label: 'Critical', cls: 'critical' };
    if (pct <= (s.lowThreshold || 30)) return { label: 'Low', cls: 'low' };
    return { label: 'Normal', cls: 'normal' };
  }

  /* Fetch sensor_readings since `sinceMs`, bucketed into `count` buckets of `bucketMs`,
     returning { labels, data } (avg or sum of `metric` per bucket; null where empty). */
  async function fetchBuckets({ metric = 'level_percent', sinceMs, bucketMs, count, agg = 'avg', fmtLabel }) {
    const sb = window._supabase;
    let rows = [];
    if (sb) {
      try {
        const { data } = await sb.from('sensor_readings')
          .select(metric + ', recorded_at')
          .gte('recorded_at', new Date(sinceMs).toISOString())
          .order('recorded_at', { ascending: true })
          .limit(5000);
        rows = data || [];
      } catch (_) { rows = []; }
    }
    const b = new Map();
    for (const r of rows) {
      const k = Math.floor((new Date(r.recorded_at).getTime() - sinceMs) / bucketMs);
      const e = b.get(k) || { sum: 0, n: 0 };
      e.sum += (r[metric] || 0); e.n++; b.set(k, e);
    }
    const labels = [], data = [];
    for (let i = 0; i < count; i++) {
      labels.push(fmtLabel(new Date(sinceMs + i * bucketMs), i));
      const e = b.get(i);
      data.push(e ? (agg === 'sum' ? Math.round(e.sum) : Math.round(e.sum / e.n)) : null);
    }
    return { labels, data };
  }

  /* Update an existing chart's first dataset with bucketed Supabase history. */
  async function loadChartHistory(chart, opts) {
    if (!chart) return;
    const { labels, data } = await fetchBuckets(opts);
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    if (opts.label) chart.data.datasets[0].label = opts.label;
    chart.data.datasets[0].spanGaps = true;
    chart.update();
  }

  /* Overview/Analytics Day/Week/Month "Water Usage" (avg tank level %). */
  async function loadRangeChart(chart, range) {
    if (!chart) return;
    const now = Date.now();
    let sinceMs, bucketMs, fmtLabel;
    if (range === 'week') {
      sinceMs = now - 7 * 24 * 3600e3; bucketMs = 24 * 3600e3;
      fmtLabel = d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    } else if (range === 'month') {
      sinceMs = now - 30 * 24 * 3600e3; bucketMs = 24 * 3600e3;
      fmtLabel = d => (d.getMonth() + 1) + '/' + d.getDate();
    } else {
      sinceMs = now - 24 * 3600e3; bucketMs = 3600e3;
      fmtLabel = d => String(d.getHours()).padStart(2, '0') + ':00';
    }
    const count = Math.max(1, Math.ceil((now - sinceMs) / bucketMs));
    await loadChartHistory(chart, { metric: 'level_percent', sinceMs, bucketMs, count, agg: 'avg', fmtLabel, label: 'Avg Tank Level % — ' + range });
  }

  function initOverviewCharts() {
    /* ── Daily Usage Chart ──
       Built from SensorHub history OR fixed weekly baseline.
       NEVER randomized on interval — refreshes only when new data arrives from sensor. */
    const ctxDaily = $('#chartDailyUsage');
    if (ctxDaily) {
      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      /* Use last-7-days history if enough data exists, otherwise fixed baseline */
      const baseline  = [420, 380, 510, 450, 470, 320, 390];
      state.charts.dailyUsage = new Chart(ctxDaily, {
        type: 'line',
        data: {
          labels: dayLabels,
          datasets: [{
            label: 'Usage (L)',
            data: [...baseline],
            borderColor: '#1976D2',
            backgroundColor: 'rgba(25,118,210,.1)',
            fill: true, tension: .4,
            pointBackgroundColor: '#1976D2', pointRadius: 4,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });

      /* Day / Week / Month range toggle → load real history from Supabase */
      const rangeEl = $('#overviewRange');
      if (rangeEl) {
        rangeEl.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => {
          rangeEl.querySelectorAll('.range-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          loadRangeChart(state.charts.dailyUsage, b.dataset.range);
        }));
      }
      loadRangeChart(state.charts.dailyUsage, 'day');
    }

    /* ── Weekly Consumption Chart ──
       Also static — not randomized. */
    const ctxWeekly = $('#chartWeeklyConsumption');
    if (ctxWeekly) {
      state.charts.weeklyConsumption = new Chart(ctxWeekly, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Outflow (L/hr)',
            data: [],
            backgroundColor: 'rgba(25,118,210,.7)',
            borderRadius: 6,
          }]
        },
        options: chartOptions('Avg Outflow (L/hr)')
      });
      loadChartHistory(state.charts.weeklyConsumption, {
        metric: 'outflow_lph', sinceMs: Date.now() - 6 * 7 * 24 * 3600e3,
        bucketMs: 7 * 24 * 3600e3, count: 6, agg: 'avg',
        fmtLabel: (_d, i) => 'W' + (i + 1), label: 'Avg Outflow (L/hr)'
      });
    }

    /* ── Overview auto-refresh interval ──
       Updates: live sensor readings, tank visual, AMDA score.
       Does NOT touch the daily/weekly charts. */
    const iv = setInterval(() => {
      if (state.currentPage === 'overview' && !state.monitoringPaused) {
        /* Tick simulation ONLY if no real hardware AND no fresh remote data */
        if (!SensorHub.live && !SensorHub.isRemoteFresh()) SensorHub.simulate();
        updateOverview();
        /* Daily chart: only append a new point when live hardware sends data */
        if (SensorHub.live && state.charts.dailyUsage) {
          const now = new Date();
          const hour = now.getHours();
          /* Only update at the start of each new hour (first tick after hour boundary) */
          if (hour !== state._lastChartHour) {
            state._lastChartHour = hour;
            const consumed = SensorHub.latest.outflowLPH; // L used in this reading period
            state.charts.dailyUsage.data.datasets[0].data.push(Math.round(consumed));
            if (state.charts.dailyUsage.data.datasets[0].data.length > 7)
              state.charts.dailyUsage.data.datasets[0].data.shift();
            state.charts.dailyUsage.update('none');
          }
        }
        /* ⚠ Do NOT randomize daily chart in simulation mode */
      }
    }, 5000);
    state.intervals.push(iv);
    state._lastChartHour = new Date().getHours();
  }

  /* ──────────────────────────────────────────
     TANK MONITORING
     ────────────────────────────────────────── */
  function initTankCharts() {
    const ctx = $('#chartTankHistory');
    if (ctx) {
      const labels = [];
      const data = [];
      for (let i = 24; i >= 0; i--) {
        const d = new Date(); d.setHours(d.getHours() - i);
        labels.push(d.getHours() + ':00');
        data.push(randBetween(2500, 4500));
      }
      state.charts.tankHistory = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Water Level (L)',
            data,
            borderColor: '#1976D2',
            backgroundColor: 'rgba(25,118,210,.08)',
            fill: true,
            tension: .3,
            pointRadius: 2,
          }]
        },
        options: chartOptions('Water Level (Liters)')
      });
    }
  }

  /* ──────────────────────────────────────────
     TANK MONITORING REAL-TIME LOOP
     Updates every 3 seconds. Updates ONLY:
       - Live sensor readings display
       - AMDA score + recommendations
       - Real-time tank level chart (rolling 30-point history)
     Does NOT randomize historical/daily charts.
  ────────────────────────────────────────── */
  function renderTankMonitoring() {
    /* Tick simulation only when no real hardware AND no fresh remote data */
    if (!SensorHub.live && !SensorHub.isRemoteFresh()) SensorHub.simulate();

    const cap    = state.settings.capacity || 20;
    const pct    = SensorHub.latest.levelPct;
    const inflow = SensorHub.latest.inflowLPH;
    const outflow= SensorHub.latest.outflowLPH;
    const net    = inflow - outflow;
    const status = getStatus(pct);
    const amda   = SensorHub.runAmda();

    /* ── Mode indicator ── */
    const modeEl = $('#tmSimMode');
    if (modeEl) modeEl.textContent = SensorHub.live ? '🟢 Live Sensor Data' : SensorHub.isRemoteFresh() ? '🛰 Remote (Supabase)' : '⚡ Simulation Mode';

    $('#tmWaterLevel').textContent = fmt(state.waterLevel) + ' L';
    $('#tmCapacity').textContent   = fmt(cap) + ' L';
    $('#tmInflow').textContent     = inflow.toFixed(1) + ' L/hr';
    $('#tmOutflow').textContent    = outflow.toFixed(1) + ' L/hr';
    $('#tmTankWater').style.height = pct + '%';
    $('#tmTankPercent').textContent= pct + '%';
    $('#tmFillLevel').textContent  = pct + '%';
    $('#tmNetFlow').textContent    = (net >= 0 ? '+' : '') + net.toFixed(1) + ' L/hr';

    const timeToFull = net > 0 ? ((cap - state.waterLevel) / Math.max(0.1, net)).toFixed(1) : '∞';
    $('#tmTimeToFull').textContent = net > 0 ? '~' + timeToFull + ' hrs' : 'N/A';

    const si = $('#tmStatusIndicator');
    if (si) {
      si.className = 'status-badge ' + status.cls;
      si.innerHTML = '<span class="dot"></span>' + sanitizeText(status.label);
    }

    const ow = $('#tmOverflowWarning');
    if (ow) ow.classList.toggle('hidden', pct < (state.settings.overflowThreshold || 95));

    /* Real AMDA output */
    $('#tmAmdaBar').style.width    = amda.score + '%';
    $('#tmAmdaPercent').textContent = amda.score + '%';
    const tmText = $('#tmAmdaText');
    if (tmText) tmText.textContent = amda.state.icon + ' ' + amda.state.label
      + ' — ' + (amda.recommendations[0]?.text || '') + ' Days remaining: ~' + amda.daysRemaining + 'd.';

    /* Alert on state change (not just threshold) */
    checkAndFireAlert(amda, status);

    /* Real-time rolling chart */
    if (state.charts.tankHistory) {
      const d = state.charts.tankHistory.data;
      d.labels.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      d.datasets[0].data.push(state.waterLevel);
      if (d.labels.length > 30) { d.labels.shift(); d.datasets[0].data.shift(); }
      state.charts.tankHistory.update('none');
    }
  }

  function startTankSimulation() {
    renderTankMonitoring(); /* immediate first paint — no ~3s blank */
    wirePauseToggle();
    const iv = setInterval(() => {
      if (state.currentPage !== 'tank' || state.monitoringPaused) return;
      renderTankMonitoring();
    }, 3000);
    state.intervals.push(iv);
  }

  /* ── Pause / Resume the live auto-refresh loops (tank + overview) ──
     Lets the user freeze the dashboard so values stop changing every few seconds. */
  function applyMonitoringState() {
    const paused = state.monitoringPaused;
    const btn   = $('#tmPauseBtn');
    const badge = $('#tmLiveBadge');
    if (btn) {
      btn.textContent = paused ? '▶ Resume Live' : '⏸ Pause Live';
      btn.classList.toggle('paused', paused);
      btn.setAttribute('aria-pressed', String(paused));
    }
    if (badge) {
      badge.classList.toggle('paused', paused);
      badge.innerHTML = '<span class="live-dot"></span>' + (paused ? 'PAUSED' : 'LIVE');
    }
    const tmMode = $('#tmSimMode');
    if (tmMode && paused) tmMode.textContent = '⏸ Paused';
  }

  function wirePauseToggle() {
    const btn = $('#tmPauseBtn');
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', () => {
      state.monitoringPaused = !state.monitoringPaused;
      applyMonitoringState();
      /* On resume, refresh immediately so values aren't stale until the next tick */
      if (!state.monitoringPaused) {
        renderTankMonitoring();
        if (state.currentPage === 'overview') updateOverview();
      }
    });
    applyMonitoringState();
  }

  /* ──────────────────────────────────────────
     STATE-CHANGE ALERT SYSTEM
     Fires whenever the AMDA state OR tank status changes
     (e.g. Normal → Low, Low → Critical, anything → Overflow).
     No score threshold needed — any state change = alert.
  ────────────────────────────────────────── */
  let _lastAlertedState = null;  // tracks previous AMDA state label
  let _lastAlertedStatus = null; // tracks previous tank status label
  let _alertCooldownMap = {};
  let _lastThresholdEval = 0; // throttles threshold/alert evaluation (see checkAndFireAlert)

  function checkAndFireAlert(amda, status) {
  const cfg = loadFromStorage('amdaConfig', { autoAlert: true });
  if (!cfg.autoAlert) return;

  /* Throttle: evaluate thresholds at most once per interval (default 1 min;
     configurable via amdaConfig.thresholdIntervalMin) — NOT every render tick. */
  const _nowEval = Date.now();
  const _intervalMs = (cfg.thresholdIntervalMin || 1) * 60000;
  if (_nowEval - _lastThresholdEval < _intervalMs) return;
  _lastThresholdEval = _nowEval;

    const badStates   = ['Critical', 'Emergency'];
  const badStatuses = ['Critical', 'Overflow'];

   const isBad = badStates.includes(amda.state.label) 
             || badStatuses.includes(status.label);

    if (!isBad) {
      _lastAlertedState  = amda.state.label;
      _lastAlertedStatus = status.label;
      return;
    }

    const stateChanged = amda.state.label !== _lastAlertedState;

    if (!stateChanged) return;

    /* Fire alert on ANY degradation or on Overflow */
    const stateKey = amda.state.label + '_' + status.label;
    const now = Date.now();
    const lastFired = _alertCooldownMap[stateKey] || 0;
    if (now - lastFired < 600000) return; // 10 min per state

    _lastAlertedState  = amda.state.label;
    _lastAlertedStatus = status.label;

    _alertCooldownMap[stateKey] = now;

    pushAmdaAlert(amda, status);
  }

  /* Push an AMDA-generated alert — written to Supabase (admin only); realtime fans it out. */
  let _lastAmdaAlert = 0;
  function pushAmdaAlert(amda, status) {
    /* Allow same state to re-alert after 5 minutes */
    const now = Date.now();
    if (now - _lastAmdaAlert < 300000) return;
    _lastAmdaAlert = now;

    const statusLabel = status?.label || amda.state.label;
    const rec = {
      type:    amda.score < 20 || statusLabel === 'Overflow' ? 'danger' : amda.score < 40 ? 'critical' : 'warning',
      title:   amda.state.icon + ' ' + statusLabel + ' — AMDA Alert',
      message: (amda.recommendations[0]?.text || amda.state.label)
               + ' Score: ' + amda.score + '/100.'
               + ' Days of supply: ~' + amda.daysRemaining + 'd.'
               + (amda.predictions?.timeToDepleteH ? ' Depletion in ~' + (amda.predictions.timeToDepleteH/24).toFixed(1) + 'd.' : ''),
    };

    /* Only the admin (device-connected) browser writes alerts; the realtime
       subscription in loadAlerts() then updates every viewer's list. */
    const sb = window._supabase;
    if (sb && state.role === 'admin') {
      sb.from('alerts').insert({ type: rec.type, title: rec.title, message: rec.message })
        .then(({ error }) => { if (error) console.warn('alert insert failed:', error.message); });

      /* Critical/emergency → blast SMS to every opted-in registered number.
         Server-side Edge Function holds the gateway key and looks up recipients. */
      if (rec.type === 'critical' || rec.type === 'danger') {
        sb.functions.invoke('send-sms', { body: { type: rec.type, title: rec.title, message: rec.message } })
          .then(({ data, error }) => {
            if (error) console.warn('SMS broadcast failed:', error.message);
            else if (data && typeof data.sent === 'number') console.log(`SMS broadcast: ${data.sent}/${data.total} sent`);
          });
      }
    }

    /* Browser push notification (immediate, local) */
    pushNotify(rec.title, rec.message);
  }

  /* ──────────────────────────────────────────
     ALERTS
     ────────────────────────────────────────── */
  /* Relative time like "10 min ago" from an ISO timestamp. */
  function timeAgo(iso) {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60); if (h < 24) return h + ' hr' + (h > 1 ? 's' : '') + ' ago';
    const d = Math.floor(h / 24); return d + ' day' + (d > 1 ? 's' : '') + ' ago';
  }

  /* Load alerts from Supabase and subscribe to new ones (realtime). */
  let _alertsSubscribed = false;
  async function loadAlerts() {
    const sb = window._supabase;
    if (!sb) return;
    const { data } = await sb.from('alerts').select('*').order('created_at', { ascending: false }).limit(20);
    DEFAULT_ALERTS.length = 0;
    if (data) data.forEach(a => DEFAULT_ALERTS.push({ type: a.type, title: a.title, message: a.message, time: timeAgo(a.created_at) }));
    renderAlerts();
    const sa = document.getElementById('statAlerts'); if (sa) sa.textContent = DEFAULT_ALERTS.length;
    if (!_alertsSubscribed) {
      _alertsSubscribed = true;
      sb.channel('rg-alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (p) => {
          const a = p.new;
          DEFAULT_ALERTS.unshift({ type: a.type, title: a.title, message: a.message, time: timeAgo(a.created_at) });
          if (DEFAULT_ALERTS.length > 20) DEFAULT_ALERTS.pop();
          renderAlerts();
          const s2 = document.getElementById('statAlerts'); if (s2) s2.textContent = DEFAULT_ALERTS.length;
        })
        .subscribe();
    }
  }

  /* Clear all alert history (admin only — RLS-enforced). */
  async function clearAlerts() {
    if (!confirm('Clear all alert history?')) return;
    const sb = window._supabase;
    if (!sb || state.role !== 'admin') { showToast('Only an admin can clear alert history.'); return; }
    const { error } = await sb.from('alerts').delete().gte('id', 0);
    if (error) { showToast('Clear failed: ' + error.message); return; }
    DEFAULT_ALERTS.length = 0;
    renderAlerts();
    const sa = document.getElementById('statAlerts'); if (sa) sa.textContent = 0;
    showToast('Alert history cleared.');
  }

  function renderAlerts() {
    const list = $('#alertList');
    if (!list) return;
    const icons = { warning: '⚠️', critical: '🔶', danger: '🔴', info: 'ℹ️' };
    if (!DEFAULT_ALERTS.length) {
      list.innerHTML = '<div class="text-sm text-muted" style="padding:1rem;text-align:center;">No alerts yet.</div>';
    } else {
      list.innerHTML = DEFAULT_ALERTS.map(a => `
        <div class="alert-item ${a.type}">
          <div class="alert-icon">${icons[a.type] || '📌'}</div>
          <div class="alert-content">
            <div class="alert-title">${sanitizeText(a.title)}</div>
            <div class="alert-message">${sanitizeText(a.message)}</div>
          </div>
          <div class="alert-time">${sanitizeText(a.time)}</div>
        </div>
      `).join('');
    }
    const cnt = $('#alertCount'); if (cnt) cnt.textContent = DEFAULT_ALERTS.length + ' alerts';
  }

  /* ─────────────────────────────────────────
     NOTIFICATIONS
     Renders recommendations + fires real browser
     push notifications via the Web Notifications API.
  ───────────────────────────────────────── */
  function renderRecommendations(containerId, recs) {
    const el = document.getElementById(containerId);
    if (!el || !recs) return;
    const colourMap = { danger: '#F44336', warning: '#FF9800', info: '#1976D2', success: '#4CAF50' };
    el.innerHTML = recs.map(r =>
      `<div style="display:flex;align-items:flex-start;gap:.5rem;padding:.5rem .75rem;
        background:${colourMap[r.priority] || '#1976D2'}18;
        border-left:3px solid ${colourMap[r.priority] || '#1976D2'};
        border-radius:6px;margin:.35rem 0;font-size:.85rem;color:var(--text);">
        ${sanitizeText(r.text)}</div>`
    ).join('');
  }

  /* Fire a real browser push notification (requires permission) */
  function pushNotify(title, body) {
    const prefs = loadFromStorage('alertPrefs', { push: false });
    if (!prefs.push) return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💧</text></svg>' });
    }
  }

  let _alertPrefsBound = false;
  async function initAlertPrefs() {
    /* email/push stay browser-local; the SMS opt-in + phone live in the DB so the
       server-side Edge Function knows who to text. */
    const prefs = loadFromStorage('alertPrefs', { email: true, push: false });
    $('#prefEmail').checked = prefs.email;
    $('#prefPush').checked  = prefs.push;
    $('#prefSMS').checked   = true;

    /* Load this user's registered number + SMS opt-in from Supabase. */
    const sb = window._supabase;
    if (sb) {
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const { data: prof } = await sb.from('profiles')
            .select('phone, sms_opt_in').eq('id', user.id).single();
          if (prof) {
            if ($('#prefPhone')) $('#prefPhone').value = prof.phone ? formatPHPhone(prof.phone) : '';
            $('#prefSMS').checked = prof.sms_opt_in !== false;
          }
        }
      } catch (e) { console.warn('load contact prefs failed:', e?.message || e); }
    }

    if (!_alertPrefsBound) {
      _alertPrefsBound = true;

      /* Push toggle — request browser permission when enabled */
      $('#prefPush').addEventListener('change', async function() {
        if (this.checked && 'Notification' in window && Notification.permission === 'default') {
          const result = await Notification.requestPermission();
          if (result !== 'granted') {
            this.checked = false;
            showToast('Browser notification permission was denied.');
          } else {
            showToast('Push notifications enabled! ✅');
            new Notification('RainGuard Notifications Active', {
              body: 'You will receive alerts when AMDA detects critical conditions.',
            });
          }
        } else if (this.checked && 'Notification' in window && Notification.permission === 'denied') {
          this.checked = false;
          showToast('Notifications blocked. Enable them in browser site settings.');
        }
      });

      /* Warn if notifications not supported */
      const pushRow = $('#prefPush')?.closest('.toggle-row');
      if (pushRow && !('Notification' in window)) {
        const note = document.createElement('small');
        note.style.color = 'var(--text-muted)';
        note.textContent = ' (Not supported in this browser)';
        pushRow.appendChild(note);
      }
    }

    $('#savePrefsBtn').onclick = async () => {
      saveToStorage('alertPrefs', { email: $('#prefEmail').checked, push: $('#prefPush').checked });

      const rawPhone = ($('#prefPhone')?.value || '').trim();
      const smsOptIn = $('#prefSMS').checked;
      if (rawPhone && !normalizePHPhone(rawPhone)) {
        showToast('Enter a valid PH mobile number (e.g. 0917 123 4567).');
        return;
      }
      if (sb) {
        const { data, error } = await sb.rpc('update_my_contact',
          { p_phone: rawPhone || null, p_sms_opt_in: smsOptIn });
        if (error) { showToast('Save failed: ' + error.message); return; }
        if ($('#prefPhone')) $('#prefPhone').value = data ? formatPHPhone(data) : '';
      }
      showToast('Notification preferences saved!');
    };

    /* Test notification button */
    const testBtn = $('#testNotifBtn');
    if (testBtn) {
      testBtn.onclick = () => {
        const prefs2 = loadFromStorage('alertPrefs', { push: false });
        if (prefs2.push && Notification.permission === 'granted') {
          pushNotify('💧 RainGuard Test', 'Notifications are working correctly!');
          showToast('Test notification sent!');
        } else {
          showToast('Enable Push Notifications first, then test.');
        }
      };
    }
  }

  /* ──────────────────────────────────────────
     ANALYTICS
     ────────────────────────────────────────── */
  /* Fill the Analytics "Total Collected" + "Estimated Water Savings" cards from real data. */
  async function loadAnalyticsStats() {
    const sb = window._supabase;
    if (!sb) return;
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
      const { data: rows } = await sb.from('sensor_readings')
        .select('level_percent, outflow_lph, recorded_at')
        .gte('recorded_at', since).order('recorded_at', { ascending: true }).limit(5000);
      if (!Array.isArray(rows) || !rows.length) return;
      const cap = state.settings.capacity || 20;
      let collected = 0, used = 0, prevLvl = null, prevT = null;
      for (const r of rows) {
        const t = new Date(r.recorded_at).getTime();
        if (prevLvl !== null && r.level_percent > prevLvl) collected += ((r.level_percent - prevLvl) / 100) * cap;
        if (prevT !== null) used += (r.outflow_lph || 0) * Math.min((t - prevT) / 3600e3, 3);
        prevLvl = r.level_percent; prevT = t;
      }
      const totalEl = document.getElementById('analyticsTotal');
      if (totalEl) totalEl.textContent = fmt(Math.round(collected)) + ' L';
      const saveEl = document.getElementById('analyticsSavings');
      if (saveEl) saveEl.textContent = fmt(Math.round(used)) + ' L';
    } catch (_) { /* leave placeholders */ }
  }

  function initAnalyticsCharts() {
    // Daily line
    const c1 = $('#chartAnalyticsDaily');
    if (c1) {
      state.charts.analyticsDaily = new Chart(c1, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Tank Level (%)',
            data: [],
            borderColor: '#1976D2',
            backgroundColor: 'rgba(25,118,210,.1)',
            fill: true, tension: .4, pointRadius: 4,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });

      /* Day / Week / Month range toggle (Analytics) → real Supabase history */
      const aRange = $('#analyticsRange');
      if (aRange) {
        aRange.querySelectorAll('.range-btn').forEach(b => b.addEventListener('click', () => {
          aRange.querySelectorAll('.range-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          loadRangeChart(state.charts.analyticsDaily, b.dataset.range);
        }));
      }
      loadRangeChart(state.charts.analyticsDaily, 'day');
    }

    // Weekly bar
    const c2 = $('#chartAnalyticsWeekly');
    if (c2) {
      state.charts.analyticsWeekly = new Chart(c2, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Level % (weekly)',
            data: [],
            backgroundColor: 'rgba(25,118,210,.7)',
            borderRadius: 6,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });
      loadChartHistory(state.charts.analyticsWeekly, {
        metric: 'level_percent', sinceMs: Date.now() - 6 * 7 * 24 * 3600e3,
        bucketMs: 7 * 24 * 3600e3, count: 6, agg: 'avg',
        fmtLabel: (_d, i) => 'W' + (i + 1), label: 'Avg Level % (weekly)'
      });
    }

    // Monthly bar
    const c3 = $('#chartAnalyticsMonthly');
    if (c3) {
      state.charts.analyticsMonthly = new Chart(c3, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Level % (monthly)',
            data: [],
            backgroundColor: 'rgba(0,188,212,.6)',
            borderRadius: 6,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });
      loadChartHistory(state.charts.analyticsMonthly, {
        metric: 'level_percent', sinceMs: Date.now() - 6 * 30 * 24 * 3600e3,
        bucketMs: 30 * 24 * 3600e3, count: 6, agg: 'avg',
        fmtLabel: d => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()],
        label: 'Avg Level % (monthly)'
      });
    }

    // AMDA predictive
    const c4 = $('#chartAmdaPredictive');
    if (c4) {
      new Chart(c4, {
        type: 'line',
        data: {
          labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'],
          datasets: [
            {
              label: 'Predicted Level (L)',
              data: [3400, 3250, 3100, 3000, 2850, 2780, 2700],
              borderColor: '#00BCD4',
              borderDash: [5, 5],
              tension: .3,
              pointRadius: 3,
            },
            {
              label: 'Actual (L)',
              data: [3400, 3300, 3150, null, null, null, null],
              borderColor: '#1976D2',
              tension: .3,
              pointRadius: 4,
            }
          ]
        },
        options: chartOptions('Predicted vs Actual (L)')
      });
    }

    // CSV download — real sensor_readings (last 30 days)
    $('#downloadCsvBtn').addEventListener('click', async () => {
      const sb = window._supabase;
      let rows = [['recorded_at', 'level_percent', 'inflow_lph', 'outflow_lph', 'temp_c']];
      if (sb) {
        const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
        const { data, error } = await sb.from('sensor_readings')
          .select('recorded_at, level_percent, inflow_lph, outflow_lph, temp_c')
          .gte('recorded_at', since)
          .order('recorded_at', { ascending: true })
          .limit(10000);
        if (error) { showToast('Export failed: ' + error.message); return; }
        if (!data || !data.length) { showToast('No sensor data to export yet.'); return; }
        rows = rows.concat(data.map(r => [r.recorded_at, r.level_percent, r.inflow_lph, r.outflow_lph, r.temp_c]));
      }
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rainguard_sensor_readings.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV exported (' + (rows.length - 1) + ' rows)!');
    });

    loadAnalyticsStats();
  }

  /* ──────────────────────────────────────────
     USER MANAGEMENT
     ────────────────────────────────────────── */
  async function initUserMgmt() {
    await loadProfiles();
    $('#userSearch').addEventListener('input', renderUserTable);
    $('#userFilterRole').addEventListener('change', renderUserTable);
    $('#userFilterStatus').addEventListener('change', renderUserTable);
    /* Users self-register via the sign-up page; admins can't create auth users from the browser. */
    const addBtn = $('#addUserBtn');
    if (addBtn) { addBtn.textContent = 'Users self-register'; addBtn.disabled = true; addBtn.style.opacity = '.6'; addBtn.style.cursor = 'default'; }
  }

  /* Load all profiles from Supabase (admin RLS allows reading every row). */
  async function loadProfiles() {
    const sb = window._supabase;
    if (sb) {
      const { data, error } = await sb.from('profiles')
        .select('id, username, email, phone, role, status').order('role', { ascending: true });
      state.users = (!error && data) ? data : [];
    }
    renderUserTable();
  }

  function renderUserTable() {
    const search = ($('#userSearch')?.value || '').toLowerCase();
    const roleFilter = $('#userFilterRole')?.value || '';
    const statusFilter = $('#userFilterStatus')?.value || '';

    let filtered = state.users.filter(u => {
      if (search && !u.username.toLowerCase().includes(search) && !u.email.toLowerCase().includes(search)) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      return true;
    });

    const tbody = $('#userTableBody');
    if (!tbody) return;
    tbody.innerHTML = filtered.map(u => `
      <tr>
        <td><strong>${sanitizeText(u.username)}</strong></td>
        <td>${sanitizeText(u.email)}</td>
        <td>${sanitizeText(u.phone ? formatPHPhone(u.phone) : '—')}</td>
        <td><span class="status-badge ${u.role === 'admin' ? 'critical' : u.role === 'lgu' ? 'low' : 'normal'}">${sanitizeText(u.role)}</span></td>
        <td><span class="status-badge ${u.status === 'active' ? 'active' : 'inactive'}"><span class="dot"></span>${sanitizeText(u.status)}</span></td>
        <td class="table-actions">
          <button class="btn btn-secondary btn-sm" onclick="RainGuard.editUser('${u.id}')">Edit</button>
          <button class="btn ${u.status === 'active' ? 'btn-danger' : 'btn-success'} btn-sm" onclick="RainGuard.toggleUser('${u.id}')">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
        </td>
      </tr>
    `).join('');
  }

  function openUserModal(user) {
    if (!user) return; /* "Add" is disabled — users self-register */
    $('#modalTitle').textContent = 'Edit User Role & Status';
    $('#modalBody').innerHTML = `
      <div class="form-row"><label>Username</label><input type="text" value="${sanitizeText(user.username || '')}" readonly style="opacity:.6"></div>
      <div class="form-row"><label>Email</label><input type="text" value="${sanitizeText(user.email || '')}" readonly style="opacity:.6"></div>
      <div class="form-row"><label>Role</label>
        <select id="mUserRole">
          <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="lgu" ${user.role === 'lgu' ? 'selected' : ''}>LGU</option>
        </select>
      </div>
      <div class="form-row"><label>Status</label>
        <select id="mUserStatus">
          <option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${user.status === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      </div>
    `;
    $('#modalSaveBtn').onclick = async () => {
      const role = $('#mUserRole').value;
      const status = $('#mUserStatus').value;
      const sb = window._supabase;
      const { error } = await sb.from('profiles').update({ role, status }).eq('id', user.id);
      if (error) { showToast('Update failed: ' + error.message); return; }
      await loadProfiles();
      closeModal();
      showToast('User updated!');
    };
    openModal();
  }

  function editUser(id) {
    const u = state.users.find(u => String(u.id) === String(id));
    if (u) openUserModal(u);
  }

  async function toggleUser(id) {
    const u = state.users.find(u => String(u.id) === String(id));
    if (!u) return;
    const newStatus = u.status === 'active' ? 'inactive' : 'active';
    const sb = window._supabase;
    const { error } = await sb.from('profiles').update({ status: newStatus }).eq('id', u.id);
    if (error) { showToast('Update failed: ' + error.message); return; }
    await loadProfiles();
    showToast('User ' + (newStatus === 'active' ? 'enabled' : 'disabled') + '!');
  }

  /* ──────────────────────────────────────────
     DEVICE MANAGEMENT
     ────────────────────────────────────────── */
  function initDeviceMgmt() {
    state.devices = loadFromStorage('devices', DEFAULT_DEVICES);
    renderDeviceTable();

    $('#deviceSearch').addEventListener('input', renderDeviceTable);
    $('#deviceFilterStatus').addEventListener('change', renderDeviceTable);
    $('#addDeviceBtn').addEventListener('click', () => openDeviceModal());
  }

  function renderDeviceTable() {
    const search = ($('#deviceSearch')?.value || '').toLowerCase();
    const statusFilter = $('#deviceFilterStatus')?.value || '';

    let filtered = state.devices.filter(d => {
      if (search && !d.id.toLowerCase().includes(search) && !d.type.toLowerCase().includes(search)) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      return true;
    });

    const tbody = $('#deviceTableBody');
    if (!tbody) return;
    tbody.innerHTML = filtered.map(d => {
      const statusCls = d.status === 'online' ? 'active' : d.status === 'offline' ? 'inactive' : 'pending';
      return `
        <tr>
          <td><strong>${d.id}</strong></td>
          <td>${d.type}</td>
          <td><span class="status-badge ${statusCls}"><span class="dot"></span>${d.status}</span></td>
          <td>${d.lastData}</td>
          <td>${d.calibration}</td>
          <td>${d.assignedTo}</td>
          <td class="table-actions">
            <button class="btn btn-secondary btn-sm" onclick="RainGuard.editDevice('${d.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="RainGuard.deleteDevice('${d.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openDeviceModal(dev) {
    const isEdit = !!dev;
    $('#modalTitle').textContent = isEdit ? 'Edit Device' : 'Add New Device';
    $('#modalBody').innerHTML = `
      <div class="form-row"><label>Sensor ID</label><input type="text" id="mDevId" value="${dev?.id || ''}" ${isEdit ? 'readonly style="opacity:.6"' : ''}></div>
      <div class="form-row"><label>Type</label>
        <select id="mDevType">
          <option value="Water Level" ${dev?.type === 'Water Level' ? 'selected' : ''}>Water Level</option>
          <option value="Flow Rate" ${dev?.type === 'Flow Rate' ? 'selected' : ''}>Flow Rate</option>
          <option value="Quality" ${dev?.type === 'Quality' ? 'selected' : ''}>Quality</option>
          <option value="Pressure" ${dev?.type === 'Pressure' ? 'selected' : ''}>Pressure</option>
        </select>
      </div>
      <div class="form-row"><label>Status</label>
        <select id="mDevStatus">
          <option value="online" ${dev?.status === 'online' ? 'selected' : ''}>Online</option>
          <option value="offline" ${dev?.status === 'offline' ? 'selected' : ''}>Offline</option>
          <option value="maintenance" ${dev?.status === 'maintenance' ? 'selected' : ''}>Maintenance</option>
        </select>
      </div>
      <div class="form-row"><label>Assigned To</label><input type="text" id="mDevAssign" value="${dev?.assignedTo || ''}"></div>
    `;
    $('#modalSaveBtn').onclick = () => {
      const id = $('#mDevId').value.trim();
      const type = $('#mDevType').value;
      const status = $('#mDevStatus').value;
      const assignedTo = $('#mDevAssign').value.trim();
      if (!id) { showToast('Please provide a Sensor ID'); return; }

      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      if (isEdit) {
        const d = state.devices.find(d => d.id === dev.id);
        if (d) { d.type = type; d.status = status; d.assignedTo = assignedTo; }
      } else {
        state.devices.push({ id, type, status, lastData: now, calibration: now.slice(0, 10), assignedTo });
      }
      saveToStorage('devices', state.devices);
      renderDeviceTable();
      closeModal();
      showToast(isEdit ? 'Device updated!' : 'Device added!');
    };
    openModal();
  }

  function editDevice(id) {
    const d = state.devices.find(d => d.id === id);
    if (d) openDeviceModal(d);
  }

  function deleteDevice(id) {
    if (!confirm('Delete device ' + id + '?')) return;
    state.devices = state.devices.filter(d => d.id !== id);
    saveToStorage('devices', state.devices);
    renderDeviceTable();
    showToast('Device deleted!');
  }

  /* ──────────────────────────────────────────
     SETTINGS
     ────────────────────────────────────────── */
  function initSettings() {
    const s = state.settings;
    $('#setCapacity').value = s.capacity || 20;
    $('#setLow').value = s.lowThreshold || 30;
    $('#setCritical').value = s.criticalThreshold || 15;
    $('#setOverflow').value = s.overflowThreshold || 95;
    $('#setRefresh').value = s.refreshInterval || 5;
    $('#setAmdaSensitivity').value = s.amdaSensitivity || 'medium';
    $('#setWeatherApi').checked = s.weatherApi !== false;

    $('#saveSettingsBtn').onclick = () => {
      state.settings = {
        capacity: parseInt($('#setCapacity').value) || 20,
        lowThreshold: parseInt($('#setLow').value) || 30,
        criticalThreshold: parseInt($('#setCritical').value) || 15,
        overflowThreshold: parseInt($('#setOverflow').value) || 95,
        refreshInterval: parseInt($('#setRefresh').value) || 5,
        amdaSensitivity: $('#setAmdaSensitivity').value,
        weatherApi: $('#setWeatherApi').checked,
      };
      saveToStorage('settings', state.settings);
      showToast('Settings saved successfully!');
    };
  }

  function initAmdaConfig() {
    const cfg = loadFromStorage('amdaConfig', {
      horizon: 7, confidence: '95',
      weather: true, historical: true, seasonal: true, community: false,
      autoAlert: true, alertThreshold: 30,
    });

    /* No model selector — AMDA is the only algorithm */
    if ($('#amdaHorizon'))   $('#amdaHorizon').value   = cfg.horizon;
    if ($('#amdaConfidence'))$('#amdaConfidence').value = cfg.confidence;
    if ($('#amdaWeather'))   $('#amdaWeather').checked  = cfg.weather;
    if ($('#amdaHistorical'))$('#amdaHistorical').checked = cfg.historical;
    if ($('#amdaSeasonal'))  $('#amdaSeasonal').checked  = cfg.seasonal;
    if ($('#amdaCommunity')) $('#amdaCommunity').checked  = cfg.community;
    if ($('#amdaAutoAlert')) $('#amdaAutoAlert').checked  = cfg.autoAlert;
    if ($('#amdaAlertThreshold'))$('#amdaAlertThreshold').value = cfg.alertThreshold;

    $('#saveAmdaBtn').onclick = () => {
      const saved = {
        horizon:        parseInt($('#amdaHorizon')?.value)   || 7,
        confidence:     $('#amdaConfidence')?.value          || '95',
        weather:        $('#amdaWeather')?.checked            ?? true,
        historical:     $('#amdaHistorical')?.checked         ?? true,
        seasonal:       $('#amdaSeasonal')?.checked           ?? true,
        community:      $('#amdaCommunity')?.checked          ?? false,
        autoAlert:      $('#amdaAutoAlert')?.checked          ?? true,
        alertThreshold: parseInt($('#amdaAlertThreshold')?.value) || 30,
      };
      saveToStorage('amdaConfig', saved);
      showToast('AMDA configuration saved!');
    };
  }

  /* ──────────────────────────────────────────
     SENSOR CONNECT PAGE
     ────────────────────────────────────────── */
  function initSensorConnect() {
    /* Attach connect/disconnect button */
    const btn = $('#serialConnectBtn');
    if (!btn) return;
    /* Set serial monitor textarea reference */
    SerialManager._logEl = $('#serialMonitor');

    btn.onclick = async () => {
      if (SerialManager.active) {
        await SerialManager.disconnect();
      } else {
        await SerialManager.connect();
      }
    };

    /* Warn if Web Serial not supported */
    if (!SerialManager.supported()) {
      const warn = $('#serialSupportWarn');
      if (warn) warn.classList.remove('hidden');
      btn.disabled = true;
    }

    /* Show current sim values */
    const liveLevel = $('#liveLevel');
    const liveIn    = $('#liveInflow');
    const liveOut   = $('#liveOutflow');
    if (liveLevel) liveLevel.textContent = SensorHub.latest.levelPct + '%';
    if (liveIn)    liveIn.textContent    = SensorHub.latest.inflowLPH.toFixed(1)  + ' L/hr';
    if (liveOut)   liveOut.textContent   = SensorHub.latest.outflowLPH.toFixed(1) + ' L/hr';

    /* Tab switching */
    $$('.sc-tab-btn').forEach(tb => {
      tb.addEventListener('click', () => {
        $$('.sc-tab-btn').forEach(b => b.classList.remove('active'));
        $$('.sc-tab-pane').forEach(p => p.classList.add('hidden'));
        tb.classList.add('active');
        const pane = $('#sc-pane-' + tb.dataset.tab);
        if (pane) pane.classList.remove('hidden');
      });
    });

    /* Clear serial monitor */
    const clearBtn = $('#serialClearBtn');
    if (clearBtn) clearBtn.onclick = () => {
      if (SerialManager._logEl) SerialManager._logEl.textContent = '';
    };
  }

  /* ──────────────────────────────────────────
     LGU DASHBOARD
     ────────────────────────────────────────── */
  /* Fill the LGU stat cards from real Supabase data (best-effort; leaves defaults on failure). */
  async function loadLguStats() {
    const sb = window._supabase;
    const alertEl = document.getElementById('lguActiveAlerts');
    if (alertEl) alertEl.textContent = DEFAULT_ALERTS.length;
    if (!sb) return;
    try {
      const { data: cs } = await sb.from('current_status').select('amda_score').eq('id', 1).single();
      /* Use the live AMDA score if present, else compute from the latest reading. */
      let score = (cs && typeof cs.amda_score === 'number') ? cs.amda_score : SensorHub.runAmda().score;
      if (!Number.isFinite(score)) score = 0;
      const confEl = document.getElementById('lguAmdaConfidence');
      if (confEl) confEl.textContent = score + '%';
      const barEl = document.getElementById('lguRegionalBar');
      if (barEl) barEl.style.width = score + '%';
      const pctEl = document.getElementById('lguRegionalPct');
      if (pctEl) pctEl.textContent = score + '%';

      const since = new Date(Date.now() - 30 * 24 * 3600e3).toISOString();
      const { data: rows } = await sb.from('sensor_readings')
        .select('level_percent, source, recorded_at')
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: true })
        .limit(5000);
      if (Array.isArray(rows)) {
        const sys = Math.max(1, new Set(rows.map(r => r.source || 'esp32')).size);
        const sysEl = document.getElementById('lguTotalSystems');
        if (sysEl) sysEl.textContent = String(sys);
        /* "Water collected" estimate: sum of positive level rises × tank capacity */
        const cap = state.settings.capacity || 20;
        let collected = 0, prev = null;
        for (const r of rows) {
          if (prev !== null && r.level_percent > prev) collected += ((r.level_percent - prev) / 100) * cap;
          prev = r.level_percent;
        }
        const waterEl = document.getElementById('lguTotalWater');
        if (waterEl) waterEl.textContent = fmt(Math.round(collected)) + ' L';
        const noteEl = document.getElementById('lguRegionalNote');
        if (noteEl) noteEl.textContent = sys + ' system' + (sys === 1 ? '' : 's') + ' reporting · regional confidence ' + score + '%.';
      }
    } catch (_) { /* leave the placeholder values */ }
  }

  function initLguCharts() {
    const c1 = $('#chartLguRegional');
    if (c1) {
      state.charts.lguRegional = new Chart(c1, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Level % (last 7 days)',
            data: [],
            backgroundColor: 'rgba(25,118,210,.7)',
            borderRadius: 6,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });
      loadChartHistory(state.charts.lguRegional, {
        metric: 'level_percent', sinceMs: Date.now() - 7 * 24 * 3600e3,
        bucketMs: 24 * 3600e3, count: 7, agg: 'avg',
        fmtLabel: d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
        label: 'Avg Level % (last 7 days)'
      });
    }

    const c2 = $('#chartLguAggregated');
    if (c2) {
      state.charts.lguAggregated = new Chart(c2, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Avg Level % (monthly)',
            data: [],
            borderColor: '#1976D2',
            backgroundColor: 'rgba(25,118,210,.08)',
            fill: true,
            tension: .4,
            pointRadius: 4,
          }]
        },
        options: chartOptions('Avg Tank Level (%)')
      });
      loadChartHistory(state.charts.lguAggregated, {
        metric: 'level_percent', sinceMs: Date.now() - 6 * 30 * 24 * 3600e3,
        bucketMs: 30 * 24 * 3600e3, count: 6, agg: 'avg',
        fmtLabel: d => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()],
        label: 'Avg Level % (monthly)'
      });
    }

    loadLguStats();
  }

  /* ──────────────────────────────────────────
     MODAL
     ────────────────────────────────────────── */
  function openModal() { $('#modalBackdrop').classList.remove('hidden'); }
  function closeModal() { $('#modalBackdrop').classList.add('hidden'); }

  /* ──────────────────────────────────────────
     CHART UTIL
     ────────────────────────────────────────── */
  function chartOptions(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 16, font: { family: 'Inter', size: 12 } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        y: { beginAtZero: true, title: { display: true, text: yTitle, font: { family: 'Inter', size: 12 } }, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { family: 'Inter', size: 11 } } }
      }
    };
  }

  /* ──────────────────────────────────────────
     INIT
     ────────────────────────────────────────── */
  async function init() {
    if (!(await checkAuth())) return;

    state.settings = loadFromStorage('settings', DEFAULT_SETTINGS);
    state.waterLevel = Math.round((state.settings.capacity || 20) * 0.65);

    setupUI();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    /* Live read-back from Supabase Realtime (used when no local serial feed) */
    SensorHub.subscribeRemote();

    /* Load alerts from Supabase + subscribe to new ones */
    loadAlerts();

    /* Fetch weather forecast using browser Geolocation if available,
       falling back to Metro Manila, Philippines (14.5995°N, 120.9842°E) */
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => SensorHub.fetchWeather(pos.coords.latitude, pos.coords.longitude),
        ()  => SensorHub.fetchWeather(14.5995, 120.9842)  // fallback: Manila
      );
    } else {
      SensorHub.fetchWeather(14.5995, 120.9842);
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  // Public API (for inline onclick handlers)
  return {
    navigate,
    editUser,
    toggleUser,
    editDevice,
    deleteDevice,
    connectSerial:    () => SerialManager.connect(),
    disconnectSerial: () => SerialManager.disconnect(),
    clearAlerts,
  };
})();
