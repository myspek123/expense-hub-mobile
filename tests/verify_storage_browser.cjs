// Synthetic data only. No Google requests, real profiles, or production files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
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
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  async function context() {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await c.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    return c;
  }
  async function ready(page) {
    await page.goto(base);
    await page.waitForFunction(() => window.captureStorage && document.querySelector('#f-date-text').value);
  }
  try {
    const c = await context();
    await c.addInitScript(() => {
      if (localStorage.getItem('seeded')) return;
      const photo = 'data:application/pdf;base64,' + 'A'.repeat(4200000);
      localStorage.setItem('eh_mobile_queue_v1', JSON.stringify([{ localId: 'legacy', syncToken: 'original', amount: '12.50', photos: [{ base64: photo, name: 'synthetic.pdf' }], synced: false, awaitingPcUpdate: true }]));
      localStorage.setItem('seeded', 'yes');
      // Fill the remaining origin quota. This reproduces the old failure.
      for (let i = 0; i < 200; i++) {
        try { localStorage.setItem('filler' + i, 'x'.repeat(10000)); } catch (_) { break; }
      }
      try { localStorage.setItem('old-save', 'x'.repeat(500000)); }
      catch (error) { sessionStorage.setItem('oldFailure', error.name); }
    });
    const page = await c.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page);
    await test('reproduce old quota failure; migrate every receipt and pending flag', async () => {
      const result = await page.evaluate(() => ({
        oldFailure: sessionStorage.getItem('oldFailure'),
        legacy: localStorage.getItem('eh_mobile_queue_v1'),
        queue: captureStorage.load().map((i) => ({ id: i.localId, bytes: i.photos[0].base64.length, pending: i.awaitingPcUpdate })),
      }));
      assert.equal(result.oldFailure, 'QuotaExceededError');
      assert.equal(result.legacy, null);
      assert.deepEqual(result.queue, [{ id: 'legacy', bytes: 4200028, pending: true }]);
    });
    await test('save through the real form after migration and retain it after reload', async () => {
      await page.selectOption('#f-report-type', 'LTI');
      await page.fill('#f-report-name', 'Synthetic storage regression');
      await page.fill('#f-amount', '23.45');
      await page.selectOption('#f-category', { label: 'Meals and Entertainment' });
      await page.fill('#f-description', 'Synthetic new expense');
      await page.click('#btn-save');
      await page.waitForFunction(() => captureStorage.load().some((i) => i.description === 'Synthetic new expense'));
      assert.equal(await page.locator('#f-description').inputValue(), '');
      await page.reload();
      await page.waitForFunction(() => captureStorage.load().length === 2);
    });
    await test('store more than the old 5 MB allowance offline, preserving full photos', async () => {
      await page.evaluate(async () => {
        const list = captureStorage.load();
        list.push({ localId: 'large', syncToken: 'large-v1', photos: [{ base64: 'data:application/pdf;base64,' + 'B'.repeat(2500000) }] });
        await captureStorage.save(list);
      });
      await page.reload();
      await page.waitForFunction(() => captureStorage.load().length === 3);
      assert.equal(await page.evaluate(() => captureStorage.load().find((i) => i.localId === 'large').photos[0].base64.length), 2500028);
    });
    await test('background sync cannot lose a newly added capture or replace a newer edit', async () => {
      const result = await page.evaluate(async () => {
        const staleSync = captureStorage.load();
        const userSave = captureStorage.load();
        userSave.push({ localId: 'concurrent', syncToken: 'new' });
        userSave[0].amount = '99.00';
        userSave[0].syncToken = 'edited';
        await captureStorage.save(userSave);
        staleSync[0].synced = true;
        await captureStorage.save(staleSync.filter(() => true), staleSync);
        return captureStorage.load();
      });
      assert(result.some((i) => i.localId === 'concurrent'));
      assert.equal(result[0].amount, '99.00');
      assert.equal(result[0].synced, false);
    });
    await test('edit an existing migrated capture without losing its receipt', async () => {
      await page.click('nav button[data-tab="queue"]');
      await page.click('[data-open="legacy"]');
      await page.selectOption('#f-report-type', 'LTI');
      await page.fill('#f-description', 'Edited legacy receipt');
      await page.click('#btn-save');
      await page.waitForFunction(() => captureStorage.load().find((i) => i.localId === 'legacy').description === 'Edited legacy receipt');
      assert.equal(await page.evaluate(() => captureStorage.load().find((i) => i.localId === 'legacy').photos[0].base64.length), 4200028);
    });
    await test('failed save keeps the form, re-enables Save and stores no phantom expense', async () => {
      await page.click('nav button[data-tab="capture"]');
      await page.selectOption('#f-report-type', 'LTI');
      await page.fill('#f-report-name', 'Synthetic failure');
      await page.fill('#f-amount', '9.00');
      await page.fill('#f-description', 'Keep this form');
      await page.evaluate(() => {
        window.restorePut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const request = restorePut.apply(this, args);
          this.transaction.abort();
          return request;
        };
      });
      await page.click('#btn-save');
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes("Couldn't save"));
      assert.equal(await page.locator('#f-description').inputValue(), 'Keep this form');
      assert.equal(await page.locator('#btn-save').isEnabled(), true);
      assert.equal(await page.evaluate(() => captureStorage.load().some((i) => i.description === 'Keep this form')), false);
      await page.evaluate(() => { IDBObjectStore.prototype.put = restorePut; });
    });
    await test('Quick save still requires only a receipt; Add many persists one capture per file', async () => {
      await page.click('nav button[data-tab="capture"]');
      await page.selectOption('#f-report-type', '');
      const file = { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic test receipt') };
      await page.locator('#f-photo').setInputFiles(file);
      await page.waitForSelector('#attach-strip .attach-thumb');
      const count = await page.evaluate(() => captureStorage.load().length);
      await page.click('#btn-quick-save');
      await page.waitForFunction((n) => captureStorage.load().length === n + 1, count);
      await page.locator('#f-many').setInputFiles([file, { ...file, name: 'synthetic2.pdf' }]);
      await page.waitForFunction((n) => captureStorage.load().length === n + 3, count);
      await page.reload();
      await page.waitForFunction((n) => captureStorage.load().length === n + 3, count);
    });
    await test('no horizontal overflow at required desktop widths; clean browser errors', async () => {
      for (const width of [1280, 1366, 1536]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      assert.deepEqual(errors, []);
    });
    await c.close();
    await test('migration transaction failure preserves the original and blocks unsafe empty startup', async () => {
      const failureContext = await context();
      await failureContext.addInitScript(() => {
        localStorage.setItem('eh_mobile_queue_v1', JSON.stringify([{ localId: 'protected-legacy', photos: ['synthetic-receipt'] }]));
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          const request = original.apply(this, args);
          this.transaction.abort();
          return request;
        };
      });
      const failurePage = await failureContext.newPage();
      await failurePage.goto(base);
      await failurePage.getByRole('alert').waitFor();
      assert(await failurePage.locator('#btn-save').isDisabled());
      assert.equal(await failurePage.evaluate(() => JSON.parse(localStorage.getItem('eh_mobile_queue_v1'))[0].localId), 'protected-legacy');
      await failureContext.close();
    });
    console.log(`${passed} browser scenarios passed`);
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
