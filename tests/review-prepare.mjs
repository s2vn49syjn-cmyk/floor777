import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {materializePlaceholders} from '../tools/generate-layout/placeholders.mjs';
import {prepareReview} from '../tools/prepare-review.mjs';
import {generateStore} from '../tools/generate-layout/index.mjs';
import {fixture, vision} from './ai-layout-fixture.mjs';
import {validateLayout} from '../tools/layout-validator.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-prepare-'));
try {
  const input = path.join(root, 'input'), manifest = await fixture(input);
  // No roster: placeholders must never acquire inferred numbers.
  manifest.sources = manifest.sources.filter(s => s.sourceId === 'map');
  const observation = vision(); observation.floors[0].islands[0].machineSlots = [];
  observation.floors[0].islands[0].estimatedMachineCount = 14;
  let calls = 0;
  const provider = {id: 'fixture', model: 'offline', async generateLayoutFromEvidence() {calls++; return observation;}};
  const result = await generateStore(manifest, {baseDir: input, draftRoot: path.join(root, 'drafts'), provider});
  assert.equal(calls, 1); assert.equal(result.status, 'needs_review');
  const island = result.layout.floors[0].islands[0];
  assert.equal(island.machines.length, 14);
  assert(island.machines.every(m => m.number === null && m.confidence === null));
  assert.equal(result.layout.review.humanModified, false);
  assert.equal(result.layout.verification.lastVerifiedAt, null);
  assert(!validateLayout(result.layout).diagnostics.some(d => d.code.includes('overlap')));
  assert.deepEqual(materializePlaceholders(result.layout).layout, result.layout);
  const existing = structuredClone(result.layout); existing.floors[0].islands[0].machines[0].number = 101;
  assert.deepEqual(materializePlaceholders(existing).layout, existing);
  for (const geometry of [null, {x: -1, y: 0, width: 50, height: 20}, {x: 0, y: 0, width: NaN, height: 20}, {x: 0, y: 0, width: 10000, height: 20}]) {
    const bad = structuredClone(result.layout); bad.floors[0].islands[0].machines = []; bad.floors[0].islands[0].geometry = geometry;
    const output = materializePlaceholders(bad);
    assert.equal(output.generated.length, 0); assert.equal(output.skipped.length, 1);
  }
  const partial = structuredClone(result.layout); partial.floors[0].islands[0].machines = island.machines.slice(0, 1);
  assert.deepEqual(materializePlaceholders(partial).layout, partial);
  const reviewed = structuredClone(result.layout); reviewed.review.humanModified = true; reviewed.floors[0].islands[0].machines = [];
  assert.deepEqual(materializePlaceholders(reviewed).layout, reviewed);
  const original = structuredClone(result.layout); original.floors[0].islands[0].machines = [];
  await fs.writeFile(result.layoutPath, JSON.stringify(original));
  const master = {formatVersion: 1, stores: {'fixture-hall': {hallId: 'fixture-hall', published: false, layoutProgress: 'needs_review', generation: {status: 'needs_review', layoutPath: result.layoutPath}}}};
  await fs.mkdir(path.join(root, 'work/nationwide'), {recursive: true});
  const masterFile = path.join(root, 'work/nationwide/master.json');
  await fs.writeFile(masterFile, JSON.stringify(master));
  const [prepared] = await prepareReview(root, ['fixture-hall']);
  assert.equal(prepared.status, 'needs_review'); assert.equal(prepared.validation.machineCount, 14);
  assert.equal(prepared.apiCalls, 0); assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(result.layoutPath)), original);
  assert.equal(await fs.readFile(masterFile, 'utf8'), JSON.stringify(master));
  assert.equal((await prepareReview(root, ['fixture-hall']))[0].layoutPath, prepared.layoutPath);
  assert.equal((await prepareReview(root, ['missing']))[0].status, 'failed');
  master.stores['fixture-hall'].published = true;
  await fs.writeFile(masterFile, JSON.stringify(master));
  assert.equal((await prepareReview(root, ['fixture-hall']))[0].status, 'failed');
  const cli = spawnSync(process.execPath, ['tools/prepare-review.mjs', '--hall', 'fixture-hall', '--generate'], {encoding: 'utf8'});
  assert.equal(cli.status, 1); assert.match(cli.stderr, /confirm-api-cost/);
  console.log('review preparation: passed (offline generation, null numbers, bounds, preservation, idempotence, publish and cost guards)');
} finally {await fs.rm(root, {recursive: true, force: true});}
