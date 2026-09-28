import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {fixture, vision} from './ai-layout-fixture.mjs';
import {generateStore} from '../tools/generate-layout/index.mjs';
import {prepareReview} from '../tools/prepare-review.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-review-browser-'));
const server = spawn(process.execPath, ['tools/start-review-editor.mjs', '--port', '8796'], {stdio: 'ignore'});
let browser, copied;
try {
  const manifest = await fixture(path.join(root, 'input'), 'prepare-browser-fixture');
  manifest.sources = manifest.sources.filter(s => s.sourceId === 'map');
  const observation = vision(manifest.storeId); observation.floors[0].islands[0].machineSlots = [];
  const generated = await generateStore(manifest, {baseDir: path.join(root, 'input'), draftRoot: path.join(root, 'drafts'),
    provider: {id: 'fixture', model: 'offline', async generateLayoutFromEvidence() {return observation;}}});
  await fs.mkdir(path.join(root, 'work/nationwide'), {recursive: true});
  await fs.writeFile(path.join(root, 'work/nationwide/master.json'), JSON.stringify({stores: {
    [manifest.storeId]: {hallId: manifest.storeId, layoutProgress: 'needs_review', published: false,
      generation: {status: generated.status, layoutPath: generated.layoutPath}}
  }}));
  const [prepared] = await prepareReview(root, [manifest.storeId]);
  await fs.mkdir('work/review-drafts', {recursive: true});
  copied = path.resolve('work/review-drafts', path.basename(prepared.layoutPath));
  await fs.copyFile(prepared.layoutPath, copied);
  const base = 'http://127.0.0.1:8796';
  for (let n = 0; n < 80; n++) {
    try {if ((await fetch(`${base}/tools/layout-review.html`)).ok) break;} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + prepared.reviewPath);
  await page.waitForSelector('.review-machine');
  assert.equal(await page.locator('.review-machine').count(), 2);
  await page.evaluate(async id => {
    const {saveDraft} = await import('/tools/review-store.mjs');
    await saveDraft({id, marker: 'previous manual draft'});
  }, manifest.storeId);
  await page.locator('#saveNow').click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === '保存済み');
  await page.reload(); await page.waitForSelector('.review-machine');
  assert.match(await page.locator('#saveState').textContent(), /下書き復元済み/);
  const persisted = await page.evaluate(async id => {
    const {loadDraft} = await import('/tools/review-store.mjs');
    const draft = new URL(location.href).searchParams.get('draft');
    return {old: await loadDraft(id), prepared: await loadDraft(`prepared:${draft}`)};
  }, manifest.storeId);
  assert.equal(persisted.old.marker, 'previous manual draft');
  assert.equal(persisted.prepared.working.review.humanModified, false);
  assert.equal((await fetch(`${base}/work/nationwide/master.json`)).status, 403);
  assert.equal((await fetch(`${base}/review-drafts/not-a-revision.json`)).status, 403);
  assert.deepEqual(errors, []);
  console.log('PASS: prepared draft loads without manual materialization, saves/restores separately, private files inaccessible');
} finally {
  await browser?.close(); server.kill();
  if (copied) await fs.rm(copied, {force: true});
  await fs.rm(root, {recursive: true, force: true});
}
