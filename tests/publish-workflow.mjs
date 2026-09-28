import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateStore} from '../tools/generate-layout/index.mjs';
import {fixture} from './ai-layout-fixture.mjs';
import {checkLayoutSchema} from '../tools/publish-workflow/schema-check.mjs';
import {getPromotionIndex, runPromotionAction, runPromotionBatch} from '../tools/publish-workflow/index.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-publish-'));
const id = 'fixture-hall', file = (...parts) => path.join(root, ...parts);
const save = async (name, value) => {await fs.mkdir(path.dirname(name), {recursive: true}); await fs.writeFile(name, JSON.stringify(value, null, 2));};
const read = name => fs.readFile(name, 'utf8').then(JSON.parse);
try {
  const input = file('input'), manifest = await fixture(input);
  const ai = await generateStore(manifest, {baseDir: input, draftRoot: file('work/layout-drafts')});
  assert.equal(ai.status, 'generated');
  const layout = structuredClone(ai.layout);
  layout.review = {originalSourceType: 'ai', humanModified: true, modifiedAt: new Date().toISOString()};
  layout.verification.status = 'human_corrected';
  assert(checkLayoutSchema(layout).valid);
  const draft = file('review-export.json'); await save(draft, layout);
  await save(file('data', `${id}.json`), {id, name: 'Fixture Hall', prefecture: '大阪府', city: '堺市',
    seat_count: 2, updated_at: '2026-09-28', seats: [{seat: 101, machine: '機種A'}, {seat: 102, machine: '機種B'}]});
  await save(file('data/positions-fixture-hall.json'), {'101': [2, 2, 20, 20], '102': [30, 2, 20, 20]});
  await save(file('data/halls.json'), {updated_at: '2026-09-28', halls: [{id: 'old-hall', name: 'Untouched'}]});
  await save(file('tools/hall-page-meta.json'), {[id]: {positionFile: 'positions-fixture-hall.json', robotsMeta: ''}});
  await fs.mkdir(file('halls', id), {recursive: true}); await fs.writeFile(file('halls', id, 'index.html'), '<html>Existing shared hall page</html>');
  const hallOriginal = await fs.readFile(file('data/halls.json'), 'utf8');
  const promote = {storeId: id, draftPath: draft, reviewer: 'fixture-reviewer', reviewedAt: new Date().toISOString(),
    approvalNote: 'Checked seats and geometry', sourceSummary: 'Permitted local fixture', promoteReason: 'Review complete',
    category: 'slot', rentalType: '46枚',
    sourcePolicyReviewed: true, manualApprovalChecked: true, provider: ai.audit.provider, model: ai.audit.model,
    sourceHashes: ai.audit.sourceHashes.map(item => item.contentHash)};
  assert.equal((await runPromotionAction('promote', promote, {root})).status, 'ready');
  assert.equal((await fs.readFile(file('data/halls.json'), 'utf8')), hallOriginal);
  assert.equal((await getPromotionIndex({root})).stores[id], undefined);
  const invalid = structuredClone(layout); invalid.floors[0].islands[0].machines[1].number = 101;
  const invalidPath = file('invalid.json'); await save(invalidPath, invalid);
  assert.equal((await runPromotionAction('promote', {...promote, draftPath: invalidPath}, {root})).status, 'blocked');
  assert.equal((await runPromotionAction('promote', {...promote, sourcePolicyReviewed: false}, {root})).status, 'blocked');
  const warn = structuredClone(layout); warn.floors[0].islands[0].machines[0].position[2] = 3;
  const warnPath = file('warning.json'); await save(warnPath, warn);
  assert.equal((await runPromotionAction('promote', {...promote, draftPath: warnPath}, {root})).status, 'blocked');
  assert.equal((await runPromotionAction('promote', {...promote, draftPath: warnPath, acceptWarnings: ['size_unusual']}, {root})).status, 'ready');
  const promoted = await runPromotionAction('promote', promote, {root, dryRun: false});
  assert.equal(promoted.status, 'success'); assert.equal(promoted.version, 'v0001');
  const firstMeta = (await getPromotionIndex({root})).stores[id].versions.v0001;
  assert.equal(firstMeta.provider, ai.audit.provider); assert.equal(firstMeta.model, ai.audit.model);
  assert.deepEqual(firstMeta.sourceHashes, ai.audit.sourceHashes.map(item => item.contentHash));
  assert.equal(firstMeta.reviewedBy, 'fixture-reviewer');
  assert.equal((await runPromotionAction('stage', {storeId: id}, {root})).status, 'ready');
  assert.equal((await getPromotionIndex({root})).stores[id].versions.v0001.state, 'promoted');
  assert.equal((await runPromotionAction('stage', {storeId: id}, {root, dryRun: false})).status, 'success');
  assert.equal((await runPromotionAction('publish', {storeId: id, publishedBy: 'fixture-publisher'}, {root})).status, 'ready');
  assert.deepEqual(await read(file('data/halls.json')), JSON.parse(hallOriginal));
  assert.equal((await runPromotionAction('publish', {storeId: id, publishedBy: 'fixture-publisher'}, {root, dryRun: false})).status, 'blocked');
  const published = await runPromotionAction('publish', {storeId: id, publishedBy: 'fixture-publisher'}, {root, dryRun: false, confirm: true});
  assert.equal(published.status, 'success');
  assert.deepEqual((await read(file('data/positions-fixture-hall.json')))['101'], [10, 10, 20, 20]);
  assert((await read(file('data/halls.json'))).halls.some(h => h.id === id));
  assert((await read(file('data/halls.json'))).halls.some(h => h.id === 'old-hall'));
  assert.equal((await read(file('data/layouts', `${id}.json`))).storeId, id);
  assert.equal((await getPromotionIndex({root})).stores[id].publishedVersion, 'v0001');
  assert.equal((await runPromotionAction('rollback', {storeId: id, rollbackBy: 'fixture-reviewer'}, {root})).status, 'ready');
  assert.equal((await runPromotionAction('rollback', {storeId: id, rollbackBy: 'fixture-reviewer'}, {root, dryRun: false})).status, 'blocked');
  const rollback = await runPromotionAction('rollback', {storeId: id, rollbackBy: 'fixture-reviewer'}, {root, dryRun: false, confirm: true});
  assert.equal(rollback.status, 'success');
  assert.deepEqual(await read(file('data/halls.json')), JSON.parse(hallOriginal));
  assert.equal(await fs.access(file('data/layouts', `${id}.json`)).then(() => true, () => false), false);
  assert.deepEqual((await read(file('data/positions-fixture-hall.json')))['101'], [2, 2, 20, 20]);
  assert.equal((await getPromotionIndex({root})).stores[id].publishedVersion, null);
  const again = await runPromotionAction('promote', promote, {root, dryRun: false});
  assert.equal(again.version, 'v0002');
  const batch = await runPromotionBatch([{action: 'stage', storeId: id, layoutVersion: 'v0002'},
    {action: 'stage', storeId: 'missing-hall'}], {root, dryRun: false});
  assert.equal(batch.counts.success, 1); assert.equal(batch.counts.blocked, 1);
  const multi = structuredClone(layout);
  multi.floors.push({...structuredClone(layout.floors[0]), id: 'other-floor', islands: [], unassignedMachines: []});
  const multiPath = file('multi.json'); await save(multiPath, multi);
  const multiPromoted = await runPromotionAction('promote', {...promote, draftPath: multiPath}, {root, dryRun: false});
  assert.equal(multiPromoted.version, 'v0003');
  assert.equal((await runPromotionAction('stage', {storeId: id, layoutVersion: 'v0003'}, {root})).status, 'blocked');
  assert.equal((await runPromotionAction('rollback', {storeId: id, layoutVersion: 'v0003', scope: 'promotion', rollbackBy: 'reviewer'}, {root})).status, 'ready');
  assert.equal((await runPromotionAction('rollback', {storeId: id, layoutVersion: 'v0003', scope: 'promotion', rollbackBy: 'reviewer'},
    {root, dryRun: false, confirm: true})).status, 'success');
  assert.equal((await getPromotionIndex({root})).stores[id].versions.v0003.state, 'rolled_back');
  const noindex = await read(file('tools/hall-page-meta.json')); noindex[id].robotsMeta = '<meta name="robots" content="noindex">';
  await save(file('tools/hall-page-meta.json'), noindex);
  assert.equal((await runPromotionAction('publish', {storeId: id, layoutVersion: 'v0002', publishedBy: 'fixture-publisher'},
    {root, dryRun: false, confirm: true})).status, 'blocked');
  noindex[id].robotsMeta = ''; await save(file('tools/hall-page-meta.json'), noindex);
  const unverifiedHall = await read(file('data', `${id}.json`)); unverifiedHall.layout_status = 'draft-unverified';
  await save(file('data', `${id}.json`), unverifiedHall);
  assert.equal((await runPromotionAction('stage', {storeId: id, layoutVersion: 'v0002'}, {root})).status, 'blocked');
  console.log('PASS: reviewed draft, schema/validator, warning boundary, dry-run, promote/stage/publish/rollback, versioning, provenance, batch, noindex gate');
} finally {await fs.rm(root, {recursive: true, force: true});}
