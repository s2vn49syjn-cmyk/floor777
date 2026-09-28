const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..'), dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'floor777-ai-review-'));
  const server = spawn(process.execPath, ['tools/start-review-editor.mjs', '--port', '8798'], {cwd: root, stdio: 'ignore'});
  let browser;
  try {
    const {fixture, vision} = await import('./ai-layout-fixture.mjs');
    const {generateStore} = await import('../tools/generate-layout/index.mjs');
    const input = path.join(dir, 'input');
    const manifest = await fixture(input, 'ai-review-fixture');
    const observation = vision('ai-review-fixture');
    observation.floors[0].islands[0].machineSlots[1].visibleNumber = null;
    await fsp.writeFile(path.join(input, 'vision.json'), JSON.stringify({visionOutput: observation}));
    const draft = await generateStore(manifest, {baseDir: input, draftRoot: path.join(dir, 'drafts')});
    assert.equal(draft.status, 'needs_review');
    const url = 'http://127.0.0.1:8798/tools/layout-review.html';
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {if ((await fetch(url)).ok) {ready = true; break;}} catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Review Editor did not start');
    browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ?
      {executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']} : {})});
    const page = await browser.newPage({viewport: {width: 390, height: 844}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#importFile').setInputFiles({name: 'draft.json', mimeType: 'application/json',
      buffer: fs.readFileSync(draft.layoutPath)});
    await page.waitForSelector('.review-machine');
    assert.equal(await page.locator('.review-machine').count(), 2);
    assert.match(await page.locator('#verificationBadge').textContent(), /needs_review/);
    const missing = page.locator('#diagnostics button').filter({hasText: 'Machine number is unknown'});
    assert.equal(await missing.count(), 1);
    await missing.click();
    assert.equal(await page.locator('.review-machine.selected').count(), 1);
    await page.locator('#singleNumber').fill('102');
    await page.locator('#applySingle').click();
    assert.equal(await missing.count(), 0);
    assert.match(await page.locator('#sourceBadge').textContent(), /人間修正済み/);
    await page.waitForFunction(() => document.querySelector('#saveState').textContent === '保存済み');
    await page.reload();
    await page.waitForSelector('.review-machine');
    assert.equal(await page.locator('.review-machine').count(), 2);
    assert.match(await page.locator('#verificationBadge').textContent(), /human_corrected/);
    assert.equal(await page.locator('#diagnostics button').filter({hasText: 'Machine number is unknown'}).count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS: generated draft import, validator focus, seat repair, autosave/reload, mobile Review Editor');
  } finally {await browser?.close(); server.kill(); await fsp.rm(dir, {recursive: true, force: true});}
})().catch(error => {console.error(error); process.exitCode = 1;});
