const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8797/tools/layout-review.html';
(async () => {
  const server = spawn(process.execPath, ['tools/start-review-editor.mjs', '--port', '8797'], {cwd: root, stdio: 'ignore'});
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {if ((await fetch(base)).ok) {ready = true; break;}} catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'local Review Editor did not start');
    browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {
      executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage']
    } : {})});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}?store=123-kitanoda`);
    await page.waitForSelector('.review-machine');
    assert.equal(await page.locator('.review-machine').count(), 60);
    assert.match(await page.locator('#sourceBadge').textContent(), /原案のまま/);
    assert.match(await page.locator('#verificationBadge').textContent(), /needs_review/);
    await page.locator('#islandSelect').selectOption({index: 1});
    const first = page.locator('.review-island.selected .review-machine rect').first();
    const initialX = Number(await first.getAttribute('x'));
    await page.locator('#islandX').fill(String(Number(await page.locator('#islandX').inputValue()) + 10));
    await page.locator('#applyPosition').click();
    assert.equal(Number(await first.getAttribute('x')), initialX + 10);
    await page.locator('#undo').click();
    assert.equal(Number(await first.getAttribute('x')), initialX);
    await page.locator('#redo').click();
    assert.equal(Number(await first.getAttribute('x')), initialX + 10);
    await page.locator('#startNumber').fill('801');
    await page.locator('#assignNumbers').click();
    assert.equal(await page.locator('.review-island.selected .review-machine text').first().textContent(), '801');
    await page.locator('#undo').click();
    assert.notEqual(await page.locator('.review-island.selected .review-machine text').first().textContent(), '801');
    await page.locator('#redo').click();
    assert.equal(await page.locator('.review-island.selected .review-machine text').first().textContent(), '801');
    await page.waitForFunction(() => document.querySelector('#saveState').textContent === '保存済み');
    await page.reload();
    await page.waitForSelector('.review-machine');
    assert.match(await page.locator('#sourceBadge').textContent(), /人間修正済み/);
    await page.locator('#islandSelect').selectOption({index: 1});
    assert.equal(await page.locator('.review-island.selected .review-machine text').first().textContent(), '801');
    assert.equal(Number(await page.locator('.review-island.selected .review-machine rect').first().getAttribute('x')), initialX + 10);

    // Create a duplicate, inspect validator diagnostics, and jump to its seat.
    await page.locator('#machineList button').first().click();
    await page.locator('#singleNumber').fill('802');
    await page.locator('#applySingle').click();
    const duplicate = page.locator('#diagnostics button').filter({hasText: 'Duplicate machine number'}).first();
    await duplicate.waitFor();
    await duplicate.click();
    assert.equal(await page.locator('.review-machine.selected').count(), 1);
    assert(await page.locator('#reviewMap').getAttribute('viewBox'));
    await page.locator('#undo').click();
    assert.equal(await page.locator('#diagnostics button').filter({hasText: 'Duplicate machine number'}).count(), 0);

    await page.locator('#islandSelect').selectOption({index: 1});
    const originalRotation = Number(await page.locator('#rotation').inputValue());
    await page.locator('#rotatePlus').click();
    assert.equal(Number(await page.locator('#rotation').inputValue()), originalRotation + 1);
    await page.locator('#undo').click();
    await page.locator('#scaleFactor').fill('1.1');
    const sizeBefore = Number(await page.locator('.review-island.selected .review-machine rect').first().getAttribute('width'));
    await page.locator('#applyScale').click();
    assert(Number(await page.locator('.review-island.selected .review-machine rect').first().getAttribute('width')) > sizeBefore);
    await page.locator('#undo').click();
    await page.locator('#machineCount').fill('11');
    await page.locator('#applyCount').click();
    assert.equal(await page.locator('.review-machine').count(), 61);
    await page.locator('#undo').click();
    assert.equal(await page.locator('.review-machine').count(), 60);
    await page.locator('#newShape').selectOption('arc');
    await page.locator('#addIsland').click();
    assert.equal(await page.locator('.review-machine').count(), 68);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#deleteIsland').click();
    assert.equal(await page.locator('.review-machine').count(), 60);
    await page.locator('#undo').click();
    assert.equal(await page.locator('.review-machine').count(), 68);
    await page.locator('#redo').click();
    assert.equal(await page.locator('.review-machine').count(), 60);

    const downloadEvent = page.waitForEvent('download');
    await page.locator('#downloadDraft').click();
    const download = await downloadEvent;
    const exported = JSON.parse(fs.readFileSync(await download.path()));
    assert.equal(exported.schemaVersion, 3);
    assert.equal(exported.storeId, '123-kitanoda');

    await page.setViewportSize({width: 390, height: 844});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile horizontal overflow');
    await page.locator('#islandSelect').selectOption({index: 1});
    await page.locator('#machineList button').first().click();
    assert.equal(await page.locator('#applySingle').isDisabled(), false);
    assert(await page.locator('#diagnostics').isVisible());

    const aiDraft = JSON.parse(fs.readFileSync(path.join(root, 'data', 'layouts', 'verde.json')));
    aiDraft.storeId = 'ai-test';
    aiDraft.verification.status = 'generated';
    aiDraft.provenance.sourceType = 'ai-draft';
    await page.locator('#importFile').setInputFiles({name: 'ai-draft.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(aiDraft))});
    await page.waitForFunction(() => document.querySelector('#storeLabel').textContent.includes('/ ai-test'));
    assert.equal(await page.locator('.review-machine').count(), 438);
    assert.match(await page.locator('#verificationBadge').textContent(), /generated/);
    await page.waitForFunction(() => document.querySelector('#saveState').textContent === '保存済み');
    await page.reload();
    await page.waitForSelector('.review-machine');
    assert.equal(await page.locator('.review-machine').count(), 438);

    // All 16 migrated drafts must be openable in the same editor.
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'review-catalog.json')));
    assert.equal(catalog.length, 16);
    for (const id of catalog) {
      console.log('Opening review layout:', id);
      await page.locator('#storeId').fill(id);
      await page.locator('#openStore').click();
      await page.waitForFunction(storeId => document.querySelector('#storeLabel').textContent.includes(`/ ${storeId}`) &&
        /下書き復元済み|元データを読み込み済み/.test(document.querySelector('#saveState').textContent), id,
        {timeout: 10000}).catch(async error => {throw Error(`${id}: ${error.message}; message=${await page.locator('#message').textContent()}; save=${await page.locator('#saveState').textContent()}; label=${await page.locator('#storeLabel').textContent()}; errors=${errors.join('|')}`);});
      const hall = JSON.parse(fs.readFileSync(path.join(root, 'data', `${id}.json`)));
      assert.equal(await page.locator('.review-machine').count(), hall.seat_count, id);
      assert.match(await page.locator('#verificationBadge').textContent(), /needs_review|human_corrected/, id);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: local Review Editor, 16 drafts, movement, numbering, undo/redo, diagnostics focus, autosave/reload and mobile controls');
  } finally {await browser?.close(); server.kill();}
})().catch(error => {console.error(error); process.exitCode = 1;});
