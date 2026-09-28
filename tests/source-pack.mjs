import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './ai-layout-fixture.mjs';
import {loadMaster, saveMaster, registerHall} from '../tools/nationwide/master.mjs';
import {createSourceTemplate, inspectSourcePack, sealSourcePack} from '../tools/nationwide/source-pack.mjs';
import {processSourcePacks, sourcePackStatuses} from '../tools/nationwide/populate.mjs';
import {handoffCandidates, populationDashboard, reviewQueue} from '../tools/nationwide/report.mjs';
import {importHumanReview} from '../tools/nationwide/pipeline.mjs';
import {validateRolloutDraft} from '../tools/nationwide/validate.mjs';
import {autoPopulateAll} from '../tools/nationwide/auto.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFiles = ['data/halls.json', 'tests/fixtures/layout-golden.json',
  'data/hyper-arrow-mihara.json', 'data/super-cosmo-sakai.json', 'data/kikuya-sakai-honten.json'];
const snapshots = await Promise.all(publicFiles.map(file => fs.readFile(path.join(repo, file))));
// Check the shipped seed, independently of private local population runs.
const seedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-source-seed-'));
let realRows;
try {
  await fs.cp(path.join(repo, 'data'), path.join(seedRoot, 'data'), {recursive: true});
  await fs.cp(path.join(repo, 'halls'), path.join(seedRoot, 'halls'), {recursive: true});
  realRows = await sourcePackStatuses(seedRoot);
} finally {await fs.rm(seedRoot, {recursive: true, force: true});}
assert.equal(realRows.length, 19);
assert.equal(realRows.filter(row => row.currentPublicStatus === 'published').length, 3);
assert.equal(realRows.filter(row => row.sourceStatus === 'source_needed').length, 19);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-source-pack-'));
const packDir = id => path.join(root, 'work/nationwide/sources', id);
const manifestFile = id => path.join(packDir(id), 'manifest.json');
const load = file => fs.readFile(file, 'utf8').then(JSON.parse);
try {
  await fs.mkdir(path.join(root, 'halls'), {recursive: true});
  await fs.mkdir(path.join(root, 'data'), {recursive: true});
  await fs.writeFile(path.join(root, 'data/halls.json'), JSON.stringify({halls: []}));
  const master = await loadMaster(root);
  for (const hallId of ['good-hall', 'bad-hall', 'empty-hall']) registerHall(master,
    {hallId, name: hallId, prefecture: '東京都', municipality: '千代田区', address: hallId, slotSupported: true});
  await saveMaster(root, master);
  const created = await createSourceTemplate(root, 'good-hall');
  assert.equal(created.status, 'created');
  assert.equal((await createSourceTemplate(root, 'good-hall')).status, 'exists');
  const originalTemplate = await load(manifestFile('good-hall'));
  assert.equal(originalTemplate.sources[0].usageReviewed, false);
  assert.equal((await inspectSourcePack(root, 'good-hall')).status, 'source_needed');
  const input = await fixture(packDir('good-hall'), 'good-hall');
  const manifest = {formatVersion: 1, hallId: 'good-hall', createdAt: new Date().toISOString(), sources: input.sources.map(source => ({
    sourceId: source.sourceId, sourceType: source.sourceType, sourceUrl: source.sourceUrl,
    observedAt: source.observedAt, importedAt: source.retrievedAt,
    usageReviewed: false, usageReviewedAt: null, usageNote: '', sourceOwner: 'test owner',
    floor: source.floor, category: source.category, rentalType: source.rentalType,
    localFiles: [{path: source.localArtifactPath, checksum: null}]
  }))};
  await fs.writeFile(manifestFile('good-hall'), JSON.stringify(manifest));
  assert.equal((await sealSourcePack(root, 'good-hall')).dryRun, true);
  assert.equal((await load(manifestFile('good-hall'))).sources[0].localFiles[0].checksum, null);
  assert.equal((await sealSourcePack(root, 'good-hall', {dryRun: false})).changes.length, 3);
  assert.equal((await inspectSourcePack(root, 'good-hall')).status, 'source_needed');
  assert.equal((await processSourcePacks(root, {hallIds: ['good-hall'], dryRun: false})).counts.source_needed, 1);
  assert.equal((await loadMaster(root)).stores['good-hall'].generation, null);
  const approved = await load(manifestFile('good-hall'));
  for (const source of approved.sources) {
    source.usageReviewed = true; source.usageReviewedAt = new Date().toISOString();
    source.usageNote = 'Human confirmed permission for local test fixture';
  }
  await fs.writeFile(manifestFile('good-hall'), JSON.stringify(approved));
  assert.equal((await inspectSourcePack(root, 'good-hall')).status, 'source_ready');
  const dry = await processSourcePacks(root, {hallIds: ['good-hall'], dryRun: true});
  assert.equal(dry.counts.ready, 1);
  assert.equal((await loadMaster(root)).stores['good-hall'].generation, null);
  await createSourceTemplate(root, 'bad-hall');
  await fs.writeFile(manifestFile('bad-hall'), JSON.stringify({...approved, hallId: 'bad-hall'}));
  await fixture(packDir('bad-hall'), 'bad-hall');
  assert.equal((await inspectSourcePack(root, 'bad-hall')).status, 'blocked'); // copied checksum does not match changed observation
  const batch = await processSourcePacks(root, {hallIds: ['good-hall', 'bad-hall', 'empty-hall'], dryRun: false});
  assert.equal(batch.counts.validated, 1);
  assert.equal(batch.counts.blocked, 1);
  assert.equal(batch.counts.source_needed, 1);
  const automated = await autoPopulateAll(root, {hallIds: ['good-hall', 'bad-hall', 'empty-hall'], dryRun: false});
  assert.equal(automated.selected, 3);
  assert.equal(automated.summary.prepared, 1);
  assert.equal(automated.reviewQueue.length, 1);
  assert.equal(automated.reviewQueue[0].hallId, 'good-hall');
  assert.match(automated.reviewQueue[0].reviewEditorUrl, /draft=/);
  await createSourceTemplate(root, 'empty-hall');
  await fs.writeFile(manifestFile('empty-hall'), '{broken-json');
  assert.equal((await inspectSourcePack(root, 'empty-hall')).status, 'blocked');
  assert.equal((await sourcePackStatuses(root)).length, 3); // one malformed pack must not hide other halls
  const record = (await loadMaster(root)).stores['good-hall'];
  assert.equal(record.layoutProgress, 'validated');
  assert.equal((await reviewQueue(root)).length, 1);
  assert.equal((await handoffCandidates(root)).length, 0);
  const resumed = await processSourcePacks(root, {hallIds: ['good-hall'], dryRun: false});
  assert.equal(resumed.counts.skipped, 1);
  const forced = await processSourcePacks(root, {hallIds: ['good-hall'], dryRun: false, force: true});
  assert.equal(forced.counts.validated, 1);
  const current = (await loadMaster(root)).stores['good-hall'];
  const generated = await load(current.generation.layoutPath);
  const multi = structuredClone(generated);
  multi.floors.push({...structuredClone(generated.floors[0]), id: 'second-floor', islands: [], unassignedMachines: []});
  assert((await validateRolloutDraft(root, current, multi, current.generation.audit)).blockedReasons.includes('unsupported_multi_floor'));
  const reviewed = structuredClone(generated);
  reviewed.review = {originalSourceType: 'ai', humanModified: true, modifiedAt: new Date().toISOString()};
  reviewed.verification.status = 'verified'; reviewed.verification.lastVerifiedAt = new Date().toISOString();
  const reviewFile = path.join(root, 'reviewed.json'); await fs.writeFile(reviewFile, JSON.stringify(reviewed));
  const incomplete = await importHumanReview(root, {hallId: 'good-hall', reviewedPath: reviewFile,
    reviewedBy: 'human', reviewedAt: new Date().toISOString(), reviewNotes: 'One issue left', unresolvedCount: 1});
  assert.equal(incomplete.status, 'needs_review');
  assert.equal((await handoffCandidates(root)).length, 0);
  assert.equal((await reviewQueue(root))[0].unresolvedCount, 1);
  await importHumanReview(root, {hallId: 'good-hall', reviewedPath: reviewFile,
    reviewedBy: 'human', reviewedAt: new Date().toISOString(), reviewNotes: 'Checked all seats', unresolvedCount: 0});
  assert.equal((await handoffCandidates(root)).length, 1);
  const dashboard = await populationDashboard(root);
  assert.equal(dashboard.nationwide.totalHalls, 3);
  assert.equal(dashboard.nationwide.handoff_ready, 1);
  assert.equal((await load(path.join(root, 'data/halls.json'))).halls.length, 0);
  console.log('PASS: Source Pack template/seal/rights/checksum, batch/resume/force, review queue, unresolved/multi-floor gates, handoff candidate and dashboard');
} finally {await fs.rm(root, {recursive: true, force: true});}
for (let i = 0; i < publicFiles.length; i++) assert.deepEqual(await fs.readFile(path.join(repo, publicFiles[i])), snapshots[i]);
