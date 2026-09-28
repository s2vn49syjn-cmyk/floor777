const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = 'http://floor777.test/floor777/';

(async () => {
  const {resolveFloorModel} = await import('../assets/floor-layout.mjs');
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  } : {})});
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 844}, serviceWorkers: 'block'});
    await context.route('http://floor777.test/**', async route => {
      const url = new URL(route.request().url());
      const relative = decodeURIComponent(url.pathname.replace(/^\/floor777\//, ''));
      const target = path.join(root, relative + (url.pathname.endsWith('/') ? 'index.html' : ''));
      try { await route.fulfill({path: target}); } catch { await route.fulfill({status: 404, body: 'Not found'}); }
    });
    const golden = ['hyper-arrow-mihara', 'super-cosmo-sakai', 'kikuya-sakai-honten'];
    for (const id of golden) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}halls/${id}/`);
      await page.waitForSelector('.seat');
      const hall = JSON.parse(fs.readFileSync(path.join(root, 'data', `${id}.json`)));
      const positionName = id === 'hyper-arrow-mihara' ? 'mihara' : id;
      const rawPositions = JSON.parse(fs.readFileSync(path.join(root, 'data', `positions-${positionName}.json`)));
      const expectedPositions = resolveFloorModel(hall, rawPositions).positions;
      assert.equal(await page.locator('.seat').count(), hall.seat_count, id);
      assert.equal(await page.locator('.seat[data-island]').count(), 0, `${id}: legacy islands must remain unknown`);
      assert.equal(await page.locator('.seat-number').count(), hall.seat_count);
      const actualPositions = await page.locator('.seat').evaluateAll(elements => Object.fromEntries(elements.map(el => {
        const rect = el.querySelector('rect');
        return [el.dataset.seat, ['x', 'y', 'width', 'height'].map(key => Number(rect.getAttribute(key)))];
      })));
      assert.deepEqual(actualPositions, expectedPositions, `${id}: screen coordinates changed`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id}: mobile overflow`);
      await page.setViewportSize({width: 320, height: 844});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${id}: 320px overflow`);
      await page.locator('.seat').first().click();
      assert(await page.locator('#seatDialog').isVisible(), `${id}: tap did not open details`);
      await page.locator('[data-close-detail]').click();
      const before = await page.locator('#floorMap').getAttribute('viewBox');
      await page.locator('#zoomIn').click();
      const afterZoom = await page.locator('#floorMap').getAttribute('viewBox');
      assert.notEqual(afterZoom, before, `${id}: zoom failed`);
      await page.locator('#floorMap').scrollIntoViewIfNeeded();
      const svg = await page.locator('#floorMap').boundingBox();
      await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
      await page.mouse.down();
      await page.mouse.move(svg.x + svg.width / 2 + 20, svg.y + svg.height / 2 + 20, {steps: 4});
      await page.mouse.up();
      assert.notEqual(await page.locator('#floorMap').getAttribute('viewBox'), afterZoom, `${id}: pan failed`);
      assert.deepEqual(errors, [], id);
      await page.close();
    }

    const draft = await context.newPage();
    await draft.goto(`${base}halls/123-senboku/`);
    await draft.waitForSelector('.seat');
    assert.equal(await draft.locator('.seat').count(), 354);
    assert.equal(await draft.locator('.seat[data-island]').count(), 354, 'v3 group metadata not loaded');
    assert(await draft.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await draft.locator('.seat').first().click();
    assert(await draft.locator('#seatDialog').isVisible());
    await draft.close();

    await context.route(`${base}data/positions-123-senboku.json`, route =>
      route.fulfill({status: 404, body: 'Not found'}));
    const newOnly = await context.newPage();
    await newOnly.goto(`${base}halls/123-senboku/`);
    await newOnly.waitForSelector('.seat');
    assert.equal(await newOnly.locator('.seat').count(), 354);
    assert.equal(await newOnly.locator('.seat[data-island]').count(), 354);
    await newOnly.close();
    await context.unroute(`${base}data/positions-123-senboku.json`);

    // Serve one invalid v3 candidate: the page must still draw from legacy data.
    await context.route(`${base}data/layouts/123-senboku.json`, route =>
      route.fulfill({json: {schemaVersion: 3, storeId: 'wrong'}}));
    const fallback = await context.newPage();
    await fallback.goto(`${base}halls/123-senboku/`);
    await fallback.waitForSelector('.seat');
    assert.equal(await fallback.locator('.seat').count(), 354);
    assert.equal(await fallback.locator('.seat[data-island]').count(), 0);
    await fallback.close();
    await context.unroute(`${base}data/layouts/123-senboku.json`);

    // A temporary change to the single shared stylesheet affects both stores;
    // removing the route restores the original design without touching files.
    const styleURL = `${base}assets/styles.css*`;
    await context.route(styleURL, async route => {
      const css = fs.readFileSync(path.join(root, 'assets', 'styles.css'), 'utf8');
      await route.fulfill({contentType: 'text/css', body: `${css}\n.floor-bg{fill:rgb(1,2,3)!important}`});
    });
    for (const id of ['hyper-arrow-mihara', '123-senboku']) {
      const page = await context.newPage();
      await page.goto(`${base}halls/${id}/`);
      await page.waitForSelector('.floor-bg');
      assert.equal(await page.locator('.floor-bg').evaluate(el => getComputedStyle(el).fill), 'rgb(1, 2, 3)');
      await page.close();
    }
    await context.unroute(styleURL);
    const restored = await context.newPage();
    await restored.goto(`${base}halls/123-senboku/`);
    await restored.waitForSelector('.floor-bg');
    assert.equal(await restored.locator('.floor-bg').evaluate(el => getComputedStyle(el).fill), 'rgb(255, 255, 255)');
    await restored.close();
    console.log('PASS: three Golden mobile screens, v3 draft and v3-only load, corrupt-v3 fallback, shared CSS across stores and restoration');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
