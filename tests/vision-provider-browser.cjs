const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const repo = path.resolve(__dirname, '..'), root = await fsp.mkdtemp(path.join(os.tmpdir(), 'floor777-vision-browser-'));
  const server = spawn(process.execPath, ['tools/start-review-editor.mjs', '--port', '8799'], {cwd: repo, stdio: 'ignore'});
  let browser;
  try {
    const {createOpenAIProvider} = await import('../tools/generate-layout/providers/openai.mjs');
    const {generateStore} = await import('../tools/generate-layout/index.mjs');
    const storeId = 'vision-browser-fixture', evidence = path.join(root, 'work/nationwide/evidence', storeId);
    await fsp.mkdir(evidence, {recursive: true});
    await fsp.writeFile(path.join(evidence, 'map.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
    const observation = {schemaVersion: 1, storeId, modelConfidence: 0.6, floors: [{id: 'slot-floor', width: 1,
      height: 1, category: 'slot', rentalType: '46枚', modelConfidence: 0.6, islands: [{id: 'island-1', shape: 'line',
        geometry: {x: 0.1, y: 0.2, width: 0.3, height: 0.1, rotation: 0}, estimatedMachineCount: 2,
        sourceIds: ['map'], uncertainty: ['One unreadable number'], modelConfidence: 0.6,
        machineSlots: [{id: 'a', position: [0.1, 0.2, 0.04, 0.04], visibleNumber: 101, modelConfidence: 0.8},
          {id: 'b', position: [0.3, 0.2, 0.04, 0.04], visibleNumber: null, modelConfidence: 0.2}]}]}]};
    const provider = createOpenAIProvider({root, apiKey: 'fixture-placeholder', minImageWidth: 1, minImageHeight: 1,
      transport: async () => ({ok: true, json: async () => ({status: 'completed', output: [{type: 'message',
        content: [{type: 'output_text', text: JSON.stringify(observation)}]}]})})});
    const today = new Date().toISOString(), manifest = {storeId, storeName: 'Vision Browser Fixture', sources: [{
      sourceId: 'map', sourceType: 'user-supplied', sourceUrl: null, observedAt: today, retrievedAt: today,
      floor: 'slot-floor', category: 'slot', rentalType: '46枚', localArtifactPath: path.join(evidence, 'map.png'),
      usageReviewed: true}]};
    const draft = await generateStore(manifest, {baseDir: root, draftRoot: path.join(root, 'drafts'), provider});
    assert.equal(draft.status, 'needs_review');
    const url = 'http://127.0.0.1:8799/tools/layout-review.html';
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {if ((await fetch(url)).ok) {ready = true; break;}} catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Review Editor did not start');
    browser = await chromium.launch({headless: true});
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.goto(url);
    await page.locator('#importFile').setInputFiles({name: 'vision-draft.json', mimeType: 'application/json',
      buffer: fs.readFileSync(draft.layoutPath)});
    await page.waitForSelector('.review-machine');
    assert.equal(await page.locator('.review-machine').count(), 2);
    assert.equal(Number(await page.locator('.review-machine rect').first().getAttribute('x')), 100);
    assert.match(await page.locator('#verificationBadge').textContent(), /needs_review/);
    assert.match(await page.locator('#sourceBadge').textContent(), /原案のまま/);
    assert.match(await page.locator('#confidenceSummary').textContent(), /信頼度/);
    assert.match(await page.locator('#provenanceSummary').textContent(), /user-supplied/);
    assert.match(await page.locator('#uncertaintySummary').textContent(), /要確認/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('PASS: normalized vision draft opens in mobile Review Editor with uncertainty and provenance');
  } finally {await browser?.close(); server.kill(); await fsp.rm(root, {recursive: true, force: true});}
})().catch(error => {console.error(error); process.exitCode = 1;});
