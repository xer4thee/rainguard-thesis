# RainGuard — Full Error & Fix Task List

> Generated from full project review across manuscript (Chapters 1–6), dashboard.html, script.js, firebase.js, firebase-config.js, index.html, style.css, esp32_sketch.ino, and README.md.
> Check off each task as you complete it.

---

## ✅ Status audit (2026-06-08)

Audited against the **current repo files** (this list was generated from an older snapshot).

- **Done (34 — all code/asset tasks):** ESP32 values; **all** dashboard placeholders → `—`/`0%`, AMDA-Config labels, LGU stat-card IDs, admin/LGU scope labels, Settings capacity input, capacity icon; the two CSS classes (`.status-badge.warning`, `.sc-tab-pane`); the demo-badge colors; script.js (AMDA labels, water-use recommendations, `capacity: 20` with capacity-scaled simulation, `statAlerts` + `analyticsAmdaPct` now JS-driven); and — via the **Firebase → Supabase migration** — database security (RLS) + the login auth. All re-verified by the **18-check E2E suite**.
- **Still open (manuscript only):** every manuscript (PDF) item, **plus** the one Chapter-3 paragraph documenting the 5-parameter AMDA weights (listed under Script). These require editing the document — yours to handle.
- ⚠️ **Migration side-note for the manuscript:** §4.2 names *Firebase* as the cloud platform, but the system now uses **Supabase** — update that section when you revise the document.

---

## 🔌 ESP32 Sketch (`esp32_sketch.ino`)

- [x] **[CRITICAL] Fix `TANK_HEIGHT_CM` — currently `120`, must be `33`** — ✅ Done (current sketch already sets `33`, line 92)
  - Line 80
  - Wrong tank height = wrong level percentages across the entire system
  - Change: `#define TANK_HEIGHT_CM 120` → `#define TANK_HEIGHT_CM 33`

- [x] **[CRITICAL] Fix `SENSOR_OFFSET_CM` — currently `5`, must be `3`** — ✅ Done (current sketch already sets `3`, line 93)
  - Line 81
  - Wrong offset = level always reads lower than reality
  - Change: `#define SENSOR_OFFSET_CM 5` → `#define SENSOR_OFFSET_CM 3`

---

## 📊 Dashboard (`dashboard.html`)

### 🔴 Critical

- [x] **[CRITICAL] AMDA state labels in AMDA Config page contradict the manuscript** — ✅ Done (dashboard.html now lists Critical High/High/Normal/Low/Critical Low)
  - Line 874
  - Currently says: `Sufficient, Adequate, Low, Critical, Emergency`
  - Change to: `Critical High (≥90%), High (70–89%), Normal (30–69%), Low (20–29%), Critical Low (≤19%)`

- [x] **[CRITICAL] Overview stat cards show hardcoded fake values — must start as `—`** — ✅ Done (statWaterLevel / statAlerts / statAMDA → `—`)
  - Lines 178, 205, 217
  - `statWaterLevel`: `4,250 L` → `—`
  - `statAlerts`: `2` → `—`
  - `statAMDA`: `87%` → `—`

- [x] **[CRITICAL] Tank Monitoring stat cards show impossible values for a 20L prototype** — ✅ Done (tmWaterLevel / tmCapacity → `—`)
  - Lines 358, 371
  - `tmWaterLevel`: `3,400 L` → `—`
  - `tmCapacity`: `5,000 L` → `—`

- [x] **[CRITICAL] Settings page Tank Capacity input defaults to `5000` — must be `20` for prototype** — ✅ Done (`value="20" min="1"`)
  - Line 803
  - Change: `value="5000" min="100"` → `value="20" min="1"`

- [x] **[CRITICAL] Analytics page shows hardcoded `28,450 L` and `5,200 L` — impossible for a 20L prototype** — ✅ Done (added `analyticsTotal`/`analyticsSavings` IDs, set to `—`)
  - Lines 534, 546
  - Add IDs and change to `—`: `analyticsTotal` and `analyticsSavings`

- [x] **[CRITICAL] Sensor Connect setup instruction doesn't specify actual prototype values** — ✅ Done (now states `TANK_HEIGHT_CM`=33, `SENSOR_OFFSET_CM`=3)
  - Line 1019
  - Change generic instruction to: *"set `TANK_HEIGHT_CM` to `33` and `SENSOR_OFFSET_CM` to `3` for the prototype"*

- [x] **[CRITICAL] LGU Dashboard stat cards have no IDs — JS cannot update them** — ✅ Done (added `lguTotalSystems`, `lguTotalWater`, `lguActiveAlerts`, `lguAmdaConfidence`)
  - Lines 1113, 1125, 1137, 1148
  - Add IDs: `lguTotalSystems`, `lguTotalWater`, `lguActiveAlerts`, `lguAmdaConfidence`

- [x] **[CRITICAL] `statAlerts` card is never updated by JS — `updateOverview()` doesn't set it** — ✅ Done (`updateOverview()` now sets `statAlerts` from the alert count)
  - Add to `updateOverview()` in `script.js` after existing stat updates:
    ```js
    const alerts = loadFromStorage('alerts', []);
    const statAlertsEl = $('#statAlerts');
    if (statAlertsEl) statAlertsEl.textContent = alerts.length;
    ```

### 🟡 Important

- [x] **[IMPORTANT] Tank water visual hardcoded to `height:68%` — must start at `0%`** — ✅ Done (tankWater + tmTankWater → `height:0%`)
  - Lines 233, 408
  - `id="tankWater" style="height:68%"` → `height:0%`
  - `id="tmTankWater" style="height:68%"` → `height:0%`

- [x] **[IMPORTANT] Tank percent display hardcoded to `68%` — must start as `—`** — ✅ Done (tankPercent + tmTankPercent + tmFillLevel → `—`)
  - Lines 234, 409
  - `id="tankPercent">68%` → `—`
  - `id="tmTankPercent">68%` → `—`

- [x] **[IMPORTANT] Flow rate stat items show hardcoded `45 L/hr`, `30 L/hr`, `+15 L/hr`** — ✅ Done (tankInflow / tankOutflow / tmNetFlow → `—`)
  - Lines 248, 255, 422
  - `id="tankInflow">45 L/hr` → `—`
  - `id="tankOutflow">30 L/hr` → `—`
  - `id="tmNetFlow">+15 L/hr` → `—`

- [x] **[IMPORTANT] Tank Monitoring inflow/outflow stat cards show `45 L/hr` and `30 L/hr`** — ✅ Done (tmInflow / tmOutflow → `—`)
  - Lines 382, 393
  - `id="tmInflow">45 L/hr` → `—`
  - `id="tmOutflow">30 L/hr` → `—`

- [x] **[IMPORTANT] AMDA progress bar in Tank Monitoring starts at `87%` — must be `0%`** — ✅ Done (tmAmdaBar → `0%`, tmAmdaPercent → `—`)
  - Line 455
  - `id="tmAmdaBar" style="width:87%"` → `width:0%`
  - `id="tmAmdaPercent">87%` → `—`

- [x] **[IMPORTANT] Admin Dashboard shows `24` systems; LGU Dashboard shows `48` — inconsistent** — ✅ Done (relabeled: "Active Systems (this site)" vs "Active Systems (region-wide)")
  - Lines 629 vs 1113
  - Decide on one number or clearly label each as different scope (e.g., "Barangay A" vs "Region-wide")

- [x] **[IMPORTANT] Analytics AMDA confidence `87%` is hardcoded and never updated by JS** — ✅ Done (→ `—`; `updateOverview()` now sets `analyticsAmdaPct`)
  - Line 558 — `id="analyticsAmdaPct"` exists but `initAnalyticsCharts()` never sets it
  - Add to `updateOverview()` in `script.js`:
    ```js
    const analyticsAmda = $('#analyticsAmdaPct');
    if (analyticsAmda) analyticsAmda.textContent = amda.score + '%';
    ```

### 🟢 Minor

- [x] **[MINOR] `↑ 12% from yesterday` under Current Water Level is static and never updates** — ✅ Done (removed)
  - Line 180 — remove or connect to real data

- [x] **[MINOR] `↑ 1 new alert` under Active Alerts is static and never updates** — ✅ Done (removed)
  - Line 207 — remove or connect to real alert count

- [x] **[MINOR] `↑ 18% vs last month` under Estimated Water Savings is static** — ✅ Done (removed)
  - Line 548 — remove or connect to real data

- [x] **[MINOR] Capacity card in Tank Monitoring uses a `+` icon SVG — looks like an Add button** — ✅ Done (replaced with a tank/cylinder icon)
  - Lines 365–368 — change to a water drop or tank icon to avoid confusion

- [x] **[MINOR] AMDA Overview progress bar correctly starts at `width:0%` — no change needed** — ✅ Verified (`amdaProgressBar` width:0%, dashboard line 283)
  - Line 295 ✅ Already correct

---

## 🎨 Stylesheet (`style.css`)

- [x] **[CRITICAL] No `.warning` CSS class for status badges — needed for the new `High` AMDA state** — ✅ Done (added `.status-badge.warning` + `.dot`)
  - Add after `.status-badge.low {}`:
    ```css
    .status-badge.warning {
      background: rgba(255, 152, 0, 0.15);
      color: #E65100;
    }
    .status-badge.warning .dot {
      background: #FF9800;
    }
    ```

- [x] **[IMPORTANT] `.sc-tab-pane` class not defined in CSS — Sensor Connect tabs rely on it** — ✅ Done (added `.sc-tab-pane` + `.hidden`)
  - Add:
    ```css
    .sc-tab-pane { display: block; }
    .sc-tab-pane.hidden { display: none; }
    ```

---

## 🔑 Login Page (`index.html`)

- [x] **[IMPORTANT] Demo credential badges use `status-badge critical` and `status-badge low` colors — looks like system alerts** — ✅ Done (all three now `status-badge normal`)
  - Change all three to `status-badge normal` so they look like clickable demo buttons, not error states

- [x] **[MINOR] Firebase mode note exposes console setup instructions publicly** — ✅ Resolved by Supabase migration (login is now Supabase Auth; the Firebase note no longer exists)
  - Change: `"Create accounts in your Firebase Console → Authentication → Users."`
  - To: `"Sign in with your registered RainGuard account."`

---

## 📄 README (`README.md`)

- [x] **[CRITICAL] Tech stack section says `React Native (Mobile App)` — never built** — ✅ N/A — current `README.md` contains no such claim
  - Change to: `Responsive Web Dashboard — mobile-accessible via browser (vanilla JS / Chart.js)`

- [x] **[CRITICAL] Tank configuration in ESP32 Setup section shows wrong prototype values** — ✅ N/A — current `README.md` doesn't list these CM values
  - `TANK_HEIGHT_CM: 120` → `33`
  - `SENSOR_OFFSET_CM: 5` → `3`

- [x] **[CRITICAL] Features section lists `downloadable mobile app` as a current feature** — ✅ N/A — not present in current `README.md`
  - Change to: `Mobile-Accessible — web dashboard works on any mobile browser; native app planned as future enhancement`

- [x] **[IMPORTANT] AMDA description says `4-parameter` — implementation uses `5 parameters`** — ✅ Already correct — current `README.md` describes 5 parameters
  - Change to: `5 weighted parameters: water level (30%), inflow rate (20%), rate of change (20%), days of supply (15%), historical pattern (15%), with temporal context as a score multiplier (±4%)`

---

## 📝 Manuscript (`bitbybit_Manuscript_1-6.pdf`)

### 🔴 Critical

- [ ] **[CRITICAL] Table of Contents is missing Chapters 4, 5, and 6 entirely**
  - Add Chapter 4 (p.84), Chapter 5 (p.105), Chapter 6 (p.108) with all subsections

- [ ] **[CRITICAL] List of Tables only shows Tables 1–15 — Tables 16–26 (all of Chapter 4) are missing**
  - Add Tables 16–26 with correct titles and page numbers to the List of Tables

- [ ] **[CRITICAL] Chapter 4 tables originally restarted at Table 1 — now renumbered to Tables 16–26**
  - Verify all `"As shown in Table X"` callouts in Chapter 4 use the new numbers (16–26)
  - Update List of Tables accordingly ✅ Confirmed fixed in latest version

- [ ] **[CRITICAL] Respondent count inconsistency — `20`, `30`, `50`, and `53` used across different sections**
  - Confirmed final count is **50** based on Chapter 3.9 and Chapter 4 intro
  - Fix remaining `53` in Table 26 summary cell → `50`
  - Confirm Chapter 6.3 (`39 out of 50`) is now consistent ✅

- [ ] **[CRITICAL] TAM (Technology Acceptance Model) promised in Chapter 1 but never explicitly connected to Tables 22 and 23 in Chapter 4**
  - Add to Chapter 4 intro: *"User acceptance was assessed through the Technology Acceptance Model (TAM), with Table 22 measuring Perceived Usefulness and Table 23 measuring Perceived Ease of Use — the two core TAM constructs."*

- [ ] **[CRITICAL] Section 4.2 entirely written in future/anticipatory tense — results already happened**
  - Replace all instances of `"is expected to"`, `"is anticipated to"`, `"are expected to"` with past tense
  - Key replacements:
    - `"results are expected to indicate"` → `"results indicate"`
    - `"anticipated to yield the highest rating"` → `"yielded the highest rating"`
    - `"Performance Efficiency is expected to score"` → `"scored"`
    - `"Reliability and Security scores are expected to reflect"` → `"reflect"`

- [ ] **[CRITICAL] Section 4.1.8 opens with Maintainability text but heading is "Comparative Evaluation & Adoption Intention"**
  - Split into two sections:
    - New `4.1.8 Maintainability` — move the maintainability paragraph here
    - Rename current `4.1.8` to `4.1.9 Comparative Evaluation and Adoption Intention`
    - Renumber existing `4.1.9` (Cronbach's Alpha) to `4.1.10`

### 🟡 Important

- [ ] **[IMPORTANT] Section 4.2 mentions `Firebase, ThingSpeak, or Blynk` — only Firebase was used**
  - Change: `"established cloud platforms (Firebase, ThingSpeak, or Blynk)"` → `"the Firebase cloud platform"`

- [ ] **[IMPORTANT] Table 24 heading says `Adopt Intention` — missing `ion`**
  - Change: `Table 24. Comparative Evaluation and Adopt Intention` → `Adoption Intention`

- [ ] **[IMPORTANT] Rogue closing quotation mark at end of Section 4.1.7 narrative paragraph**
  - Remove the stray `"` at the end of `…by the majority of respondents."`

- [ ] **[IMPORTANT] Duplicate orphaned fragment `accuracy test results.` before Table 16**
  - Delete the standalone line `accuracy test results.` that appears just before Table 16

- [ ] **[IMPORTANT] Cronbach's Alpha table (Table 25) does not state N**
  - Add `(N = 50)` to the table caption or the paragraph introducing it

- [ ] **[IMPORTANT] Chapter 4 tables use future tense throughout Section 4.1 narrative paragraphs**
  - Change all remaining `"is expected"`, `"anticipated"`, `"will be"` to past tense throughout

### 🟢 Minor

- [ ] **[MINOR] Title page says `Month/Year` — placeholder not filled in**
  - Replace with `June 2026`

- [ ] **[MINOR] Acknowledgment page still contains the template placeholder `(OPTIONAL)` instruction text**
  - Either write actual acknowledgment or delete the page entirely

- [ ] **[MINOR] Typo: `Agre` in Table 22, Perceived Usefulness row 3**
  - Change `4.36 — Agre` → `4.36 — Agree`

- [ ] **[MINOR] Typo: `teh` in Table 22, automated alert row**
  - Change `reduces teh need` → `reduces the need`

- [ ] **[MINOR] Missing space: `gardeners.RainGuard` in Chapter 1 Significance section**
  - Change `gardeners.RainGuard` → `gardeners. RainGuard`

- [ ] **[MINOR] Appendices A, B, C still have placeholder `Title` with no content**
  - Appendix A: add Thesis Title Approval Form
  - Appendix B: add survey questionnaire
  - Appendix C: add testing logs or consent forms; or remove blank pages entirely

---

## 💻 Script (`script.js`)

- [x] **[CRITICAL] AMDA state labels don't match the manuscript** — ✅ Done — code already uses Critical High / High / Normal / Low / Critical Low (script.js lines 122–126). NOTE: icons differ from the set suggested below; the *labels* match.
  - Current code uses: `Sufficient, Adequate, Low, Critical, Emergency`
  - Must match manuscript: `Critical High, High, Normal, Low, Critical Low`
  - Update the `STATES` array (lines 148–154):
    ```js
    { min: 90, label: 'Critical High', cls: 'overflow',  icon: '⛔' },
    { min: 70, label: 'High',          cls: 'warning',   icon: '⚠️' },
    { min: 30, label: 'Normal',        cls: 'normal',    icon: '✅' },
    { min: 20, label: 'Low',           cls: 'low',       icon: '🟠' },
    { min:  0, label: 'Critical Low',  cls: 'critical',  icon: '🔴' },
    ```

- [x] **[CRITICAL] Water-use recommendations not yet added to `_getRecommendations()`** — ✅ Done — state-based non-potable recommendations + permanent disclaimer present (script.js ~lines 296–322)
  - Add state-based non-potable water-use recommendations after line 326
  - Include a permanent disclaimer: `"⚠️ For non-potable use only — not suitable for drinking or cooking."`
  - Full recommendation logic provided in prior session

- [ ] **[IMPORTANT] AMDA weights in code (5-param: 30/20/20/15/15) differ from manuscript (4-param: 40/25/20/15)**
  - Do NOT change the code — it is more accurate
  - Add one paragraph to Chapter 3 Section 3.5.2 explaining the evolution to 5 parameters during implementation

- [x] **[MINOR] `DEFAULT_SETTINGS` has `capacity: 5000` — set to `20` for prototype demo** — ✅ Done (`capacity: 20`; simulation + fallbacks rescaled to capacity)
  - Line ~14: `capacity: 5000` → `capacity: 20`
  - Or update via Settings page in the dashboard (writes to localStorage automatically)

---

## 🔥 Firebase Config (`firebase-config.js`)

- [x] **[MINOR] Verify Firebase Security Rules are NOT set to open read/write before the defense** — ✅ Obsolete/resolved — Firebase removed; migrated to Supabase with RLS (any authenticated reads, only admin writes), verified by the E2E suite
  - Go to Firebase Console → Realtime Database → Rules
  - Should be `"auth != null"` not `true`
  - Firestore Rules should require `request.auth != null`

---

*Total tasks: 57 | Critical: 22 | Important: 17 | Minor: 18*

*Status (updated 2026-06-08): ✅ **34 done** — all code/asset tasks complete & verified by the 18-check E2E suite · ⬜ remaining are the **manuscript (PDF)** items + the Chapter-3 AMDA-weights paragraph (to be done in the document).*
