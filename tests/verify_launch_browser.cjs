// Synthetic previous-version data only. Never contact Google or real app data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.env.MOBILE_TEST_ROOT || path.resolve(__dirname, '..');
const assets = new Set(['index.html', 'capture-storage.js', 'sw.js', 'manifest.json']);
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!assets.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : 'text/html');
  res.end(fs.readFileSync(path.join(root, name)));
});
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS:', name); }

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.MOBILE_TEST_URL || `http://127.0.0.1:${server.address().port}/?offline=1`;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      if (localStorage.getItem('launch-fixture')) return;
      localStorage.setItem('launch-fixture', 'yes');
      localStorage.setItem('eh_mobile_active_tab', 'queue');
      localStorage.setItem('eh_mobile_open_report', 'synthetic-report');
      localStorage.setItem('eh_mobile_reports_cache', JSON.stringify([{ reportRef: 'synthetic-report', name: 'Synthetic trip', type: 'LTI', status: 'Draft' }]));
      localStorage.setItem('eh_mobile_queue_v1', JSON.stringify([{ localId: 'legacy-launch', syncToken: 'old-token', description: 'Synthetic saved expense', photos: [{ name: 'old.pdf', base64: 'data:application/pdf;base64,JVBERi0xLjQ=' }], synced: false }]));
    });
    async function ready() { await page.waitForFunction(() => document.querySelector('#f-date-text').value && window.captureStorage); }
    async function active() { return page.locator('nav button.active').getAttribute('data-tab'); }
    async function resume() {
      await page.evaluate(() => {
        for (const state of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
          document.dispatchEvent(new Event('visibilitychange'));
        }
        delete document.visibilityState;
      });
    }
    await page.goto(base);
    await ready();
    await test('fresh launch ignores a previous Sync tab and preserves its unsent receipt', async () => {
      assert.equal(await active(), 'capture');
      assert.equal(await page.evaluate(() => captureStorage.load()[0].photos[0].base64), 'data:application/pdf;base64,JVBERi0xLjQ=');
      assert.equal(await page.locator('#footer-capture').isVisible(), true);
    });
    await test('a new launch from every other tab opens Add expense', async () => {
      for (const tab of ['queue', 'reports', 'settings']) {
        await page.click(`nav button[data-tab="${tab}"]`);
        await page.goto('about:blank');
        await page.goto(base);
        await ready();
        assert.equal(await active(), 'capture', tab);
      }
    });
    await test('manual reload still preserves Sync and an open report', async () => {
      await page.click('nav button[data-tab="queue"]');
      await page.reload();
      await ready();
      assert.equal(await active(), 'queue');
      await page.click('nav button[data-tab="reports"]');
      await page.click('[data-open-report="synthetic-report"]');
      await page.reload();
      await ready();
      assert.equal(await active(), 'reports');
      assert.equal(await page.locator('#report-detail-view').isVisible(), true);
    });
    await test('background resume from every tab returns to Add expense without losing a draft', async () => {
      await page.click('nav button[data-tab="capture"]');
      await page.fill('#f-description', 'Keep my unfinished expense');
      await page.locator('#f-photo').setInputFiles({ name: 'draft.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic receipt') });
      await page.waitForSelector('#attach-strip .attach-thumb');
      for (const tab of ['queue', 'reports', 'settings', 'capture']) {
        await page.click(`nav button[data-tab="${tab}"]`);
        await resume();
        assert.equal(await active(), 'capture', tab);
        assert.equal(await page.locator('#f-description').inputValue(), 'Keep my unfinished expense');
        assert.equal(await page.locator('#attach-strip .attach-thumb').count(), 1);
      }
    });
    await test('returning from the camera during an edit preserves the edit and receipt', async () => {
      await page.click('nav button[data-tab="queue"]');
      await page.click('[data-open="legacy-launch"]');
      await page.fill('#f-description', 'Keep my unfinished edit');
      await resume();
      assert.equal(await active(), 'capture');
      assert.equal(await page.locator('#f-description').inputValue(), 'Keep my unfinished edit');
      assert.equal(await page.locator('#attach-strip .attach-thumb').count(), 1);
      assert.equal(await page.locator('#edit-back').isVisible(), true);
    });
    await test('browser history restoration opens Add expense and ordinary navigation still works', async () => {
      await page.click('nav button[data-tab="queue"]');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      assert.equal(await active(), 'capture');
      await page.click('nav button[data-tab="queue"]');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
      assert.equal(await active(), 'queue');
      assert.deepEqual(errors, []);
    });
    await context.close();
    console.log(`${passed} browser checks passed`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
