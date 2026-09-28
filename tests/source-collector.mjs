import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadMaster, saveMaster, registerHall} from '../tools/nationwide/master.mjs';
import {readSourcePack, inspectSourcePack} from '../tools/nationwide/source-pack.mjs';
import {collectHallSources, floorMapCandidates} from '../tools/nationwide/source-collector.mjs';

const png = (width, height) => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
const pageUrl = 'https://www.p-world.co.jp/osaka/test-hall.htm';
const floorUrl = 'https://idn.p-world.co.jp/test/floor-map.png';
const bannerUrl = 'https://idn.p-world.co.jp/test/banner.png';
const html = `<!doctype html><html><body>
<div>パチスロ： [1000円/46枚]</div>
<h2>▼フロアマップ▼</h2>
<img alt="FLOOR MAP" src="${floorUrl}">
<h2>LINE</h2><img alt="LINE バナー" src="${bannerUrl}">
</body></html>`;
const transport = async url => {
  if (url === pageUrl) return new Response(html, {status: 200, headers: {'content-type': 'text/html'}});
  if (url === floorUrl) return new Response(png(1200, 800), {status: 200, headers: {'content-type': 'image/png'}});
  if (url === bannerUrl) return new Response(png(1200, 800), {status: 200, headers: {'content-type': 'image/png'}});
  return new Response('missing', {status: 404});
};

assert.deepEqual(floorMapCandidates(html, pageUrl).map(item => item.url), [floorUrl]);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-source-collector-'));
try {
  await fs.mkdir(path.join(root, 'data'), {recursive: true});
  await fs.mkdir(path.join(root, 'halls'), {recursive: true});
  await fs.writeFile(path.join(root, 'data/halls.json'), JSON.stringify({halls: []}));
  const master = await loadMaster(root);
  registerHall(master, {hallId: 'collect-hall', name: 'Collect Hall', prefecture: '大阪府',
    municipality: '堺市', address: 'test', slotSupported: true});
  registerHall(master, {hallId: 'dry-hall', name: 'Dry Hall', prefecture: '大阪府',
    municipality: '堺市', address: 'test', slotSupported: true});
  const published = registerHall(master, {hallId: 'published-hall', name: 'Published Hall', prefecture: '大阪府',
    municipality: '堺市', address: 'test', slotSupported: true});
  published.published = true;
  await saveMaster(root, master);

  const dry = await collectHallSources(root, 'dry-hall', {candidates: [{sourceType: 'p-world', pageUrl}],
    transport, dryRun: true, delayMs: 0});
  assert.equal(dry.status, 'would_collect_unreviewed');
  assert.equal(dry.sources.length, 1);
  assert.equal(await readSourcePack(root, 'dry-hall'), null);

  const collected = await collectHallSources(root, 'collect-hall', {candidates: [{sourceType: 'p-world', pageUrl}],
    transport, dryRun: false, delayMs: 0});
  assert.equal(collected.status, 'collected_unreviewed');
  assert.equal(collected.sources.length, 1);
  assert.equal(collected.rentalType, '1000円/46枚');
  assert.equal(collected.apiCalls, 0);
  const manifest = await readSourcePack(root, 'collect-hall');
  assert.equal(manifest.sources.length, 1);
  assert.equal(manifest.sources[0].sourceUrl, pageUrl);
  assert.equal(manifest.sources[0].usageReviewed, false);
  assert.equal(manifest.sources[0].sourceOwner, 'P-WORLD');
  assert.equal(manifest.sources[0].rentalType, '1000円/46枚');
  assert.match(manifest.sources[0].localFiles[0].checksum, /^[a-f0-9]{64}$/);
  assert.equal((await inspectSourcePack(root, 'collect-hall')).status, 'source_needed');
  assert.equal((await inspectSourcePack(root, 'collect-hall', {allowUnreviewed: true})).status, 'source_ready');

  const repeated = await collectHallSources(root, 'collect-hall', {candidates: [{sourceType: 'p-world', pageUrl}],
    transport, dryRun: false, delayMs: 0});
  assert.equal(repeated.status, 'skipped');
  assert.match(repeated.reasons[0], /already contains/);

  const skipped = await collectHallSources(root, 'published-hall', {candidates: [{sourceType: 'p-world', pageUrl}],
    transport, dryRun: false, delayMs: 0});
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.reasons[0], /published/);

  const blocked = await collectHallSources(root, 'dry-hall', {candidates: [{sourceType: 'p-world',
    pageUrl: 'https://example.com/not-allowed'}], transport, dryRun: true, delayMs: 0});
  assert.equal(blocked.status, 'source_needed');
  assert.equal(blocked.pages[0].status, 'blocked');

  console.log('PASS: floor-map collector filters candidates, stays private/unreviewed, preserves existing packs and blocks unsafe hosts');
} finally {
  await fs.rm(root, {recursive: true, force: true});
}
