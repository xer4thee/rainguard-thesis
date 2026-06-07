// RainGuard end-to-end tests — real browser (Playwright) against the live Supabase project.
// Run:  PORT=8123 SUPABASE_PAT=sbp_... node tests/e2e.mjs   (after `npm run serve` in another shell,
// or the runner script starts the server for you).
import { chromium } from 'playwright';

const PORT = process.env.PORT || 8123;
const ORIGIN = `http://localhost:${PORT}`;
const PAT = process.env.SUPABASE_PAT;
const REF = 'zhfehohjkafrcwwqexdy';
const MGMT = `https://api.supabase.com/v1/projects/${REF}/database/query`;

const results = [];
let failures = 0;
const check = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};
async function mq(sql) {
  if (!PAT) return false;
  const r = await fetch(MGMT, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return r.ok;
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* try next */ }
  }
  return await chromium.launch({ headless: true }); // bundled chromium fallback
}

async function loginAs(browser, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
  await page.fill('#username', email);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL('**/dashboard.html', { timeout: 20000 }).catch(() => {}),
    page.click('#loginBtn'),
  ]);
  await page.waitForTimeout(2500); // let checkAuth + setupUI run
  return { ctx, page, errors };
}

const browser = await launch();
console.log('browser:', browser.browserType().name(), browser.version());
try {
  // ── 1. Bad password is rejected ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
    await page.fill('#username', 'admin@rainguard.io');
    await page.fill('#password', 'WRONGpass');
    await page.click('#loginBtn');
    await page.waitForTimeout(3000);
    const err = (await page.textContent('#loginError').catch(() => '')) || '';
    check('bad password rejected & stays on login', page.url().includes('index.html') && /invalid/i.test(err), `err="${err.trim()}"`);
    await ctx.close();
  }

  // ── 2. Admin logs in, lands on admin dashboard, admin-only UI visible, no console errors ──
  {
    const { ctx, page, errors } = await loginAs(browser, 'admin@rainguard.io', 'admin123');
    check('admin redirected to dashboard', page.url().includes('dashboard.html'), page.url());
    const name = (await page.textContent('#navUserName').catch(() => '')) || '';
    check('admin profile/role resolved (name shown)', /admin/i.test(name), `navUserName="${name}"`);
    const adminPageVisible = await page.evaluate(() => {
      const el = document.querySelector('#page-admin-overview');
      return !!el && !el.classList.contains('hidden');
    });
    check('admin default page = admin-overview', adminPageVisible);
    const adminOnlyShown = await page.evaluate(() => {
      const el = document.querySelector('.admin-only');
      return !!el && !el.classList.contains('hidden');
    });
    check('admin-only nav visible for admin', adminOnlyShown);
    const realErrors = errors.filter((e) => !/geolocation|permissions policy|favicon/i.test(e));
    check('no console errors on admin dashboard', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

    // ── 3. Admin can insert (RLS allow) via the real in-page client ──
    const ins = await page.evaluate(async () => {
      const { error } = await window._supabase.from('sensor_readings')
        .insert({ level_percent: 55, inflow_lph: 12, outflow_lph: 6, temp_c: 27, source: 'e2e-test' });
      return error ? error.message : 'ok';
    });
    check('admin INSERT reading allowed (RLS)', ins === 'ok', ins);
    await ctx.close();
  }

  // ── 4. User: lands on overview, admin UI hidden, RLS denies writes, reads work ──
  {
    const { ctx, page } = await loginAs(browser, 'user@rainguard.io', 'user123');
    check('user redirected to dashboard', page.url().includes('dashboard.html'));
    const overviewVisible = await page.evaluate(() => {
      const el = document.querySelector('#page-overview');
      return !!el && !el.classList.contains('hidden');
    });
    check('user default page = overview', overviewVisible);
    const adminOnlyHidden = await page.evaluate(() => {
      const el = document.querySelector('.admin-only');
      return !!el && el.classList.contains('hidden');
    });
    check('admin-only nav hidden for user', adminOnlyHidden);
    const denied = await page.evaluate(async () => {
      const { error } = await window._supabase.from('sensor_readings').insert({ level_percent: 1, source: 'should-deny' });
      return error ? 'denied' : 'ALLOWED';
    });
    check('user INSERT reading denied (RLS)', denied === 'denied', denied);
    const canRead = await page.evaluate(async () => {
      const { data, error } = await window._supabase.from('current_status').select('id').limit(1);
      return error ? 'err:' + error.message : 'rows:' + (data ? data.length : 0);
    });
    check('user can READ current_status', canRead.startsWith('rows:'), canRead);
    await ctx.close();
  }

  // ── 5. LGU: lands on lgu-dashboard ──
  {
    const { ctx, page } = await loginAs(browser, 'lgu@rainguard.io', 'lgu123');
    const lguVisible = await page.evaluate(() => {
      const el = document.querySelector('#page-lgu-dashboard');
      return !!el && !el.classList.contains('hidden');
    });
    check('lgu default page = lgu-dashboard', lguVisible);
    await ctx.close();
  }

  // ── 6. Realtime: a current_status change is pushed to a logged-in browser client ──
  {
    const { ctx, page } = await loginAs(browser, 'user@rainguard.io', 'user123');
    await page.evaluate(() => {
      window.__rt = { subscribed: false, event: null };
      window._supabase.channel('e2e-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'current_status' },
            (p) => { window.__rt.event = p.new; })
        .subscribe((s) => { if (s === 'SUBSCRIBED') window.__rt.subscribed = true; });
    });
    const subbed = await page.waitForFunction(() => window.__rt && window.__rt.subscribed, null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    check('realtime channel SUBSCRIBED', subbed);
    let rtScore = null;
    if (subbed) {
      await mq("update public.current_status set amda_score=77, amda_state='E2E', updated_at=now() where id=1;");
      rtScore = await page.waitForFunction(
        () => (window.__rt.event && window.__rt.event.amda_score === 77) ? window.__rt.event.amda_score : null,
        null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
    }
    check('realtime change delivered to browser', rtScore === 77, rtScore == null ? 'no event (PAT revoked or realtime off?)' : 'score=' + rtScore);
    await ctx.close();
  }
} finally {
  await browser.close();
  // cleanup test data (needs PAT)
  const c1 = await mq("delete from public.sensor_readings where source in ('e2e-test','should-deny');");
  const c2 = await mq("update public.current_status set amda_score=null, amda_state=null, recommendation=null, days_remaining=null, trend=null, time_to_overflow_hr=null, time_to_deplete_hr=null where id=1;");
  results.push(`🧹 cleanup: readings=${c1 ? 'ok' : 'skipped'} current_status=${c2 ? 'reset' : 'skipped'}${PAT ? '' : ' (no PAT)'}`);
}

console.log('\n' + results.join('\n'));
console.log(`\n${failures === 0 ? '✅ ALL E2E CHECKS PASSED' : '❌ ' + failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
