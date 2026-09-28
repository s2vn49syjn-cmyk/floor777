import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture, vision} from './ai-layout-fixture.mjs';
import {seedExisting, loadMaster, saveMaster, registerHall, transition} from '../tools/nationwide/master.mjs';
import {registerSource, reviewSourceUsage} from '../tools/nationwide/evidence.mjs';
import {generateNationwide, importHumanReview, prepareGoal6Handoff} from '../tools/nationwide/pipeline.mjs';
import {validateRolloutDraft} from '../tools/nationwide/validate.mjs';
import {queueRows, progressStats} from '../tools/nationwide/queue.mjs';
import {runPromotionAction} from '../tools/publish-workflow/index.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFile(file, 'utf8').then(JSON.parse);
const tracked = ['data/halls.json', 'tests/fixtures/layout-golden.json',
  'data/hyper-arrow-mihara.json', 'data/super-cosmo-sakai.json', 'data/kikuya-sakai-honten.json'];
const originals = await Promise.all(tracked.map(file => fs.readFile(path.join(repo, file))));
const existing = await seedExisting(repo);
assert.equal(Object.keys(existing.stores).length, 19);
assert.equal(progressStats(existing).nationwide.published, 3);
assert.equal(progressStats(existing).nationwide.needs_review, 16);
assert.equal(queueRows(existing, {state: 'needs_review'}).length, 16);
assert.equal(queueRows(existing, {prefecture: '大阪府'}).length, 19);
assert(queueRows(existing, {ungenerated: true}).every(item => !item.generated));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floor777-national-'));
try {
  await fs.mkdir(path.join(root, 'halls'), {recursive: true});
  await fs.mkdir(path.join(root, 'data'), {recursive: true});
  await fs.writeFile(path.join(root, 'data/halls.json'), JSON.stringify({halls: []}));
  const master = await loadMaster(root);
  const create = id => registerHall(master, {hallId: id, name: `試験店 ${id}`, prefecture: '東京都',
    municipality: '千代田区', address: id, slotSupported: true});
  const good = create('fixture-hall');
  const bad = create('broken-hall');
  const uncertain = create('uncertain-hall');
  const restricted = create('restricted-hall');
  assert.throws(() => create('fixture-hall'), /already exists/);
  assert.throws(() => registerHall(master, {hallId: 'another-hall', name: good.name, prefecture: good.prefecture,
    municipality: good.municipality, address: good.address, slotSupported: true}), /duplicate/);
  assert.throws(() => transition(good, 'published', 'skip'), /Forbidden/);
  async function attach(record, modify = null, usage = true) {
    const dir = path.join(root, 'input', record.hallId);
    const input = await fixture(dir, record.hallId);
    if (modify) {
      const file = path.join(dir, 'vision.json'); const json = await read(file); modify(json.visionOutput);
      await fs.writeFile(file, JSON.stringify(json));
    }
    for (const source of input.sources) {
      const entry = {...source, importedAt: source.retrievedAt, usageReviewed: usage,
        usageNote: usage ? 'Human-approved local fixture' : 'Rights not reviewed', localFile: source.localArtifactPath};
      delete entry.retrievedAt; delete entry.localArtifactPath;
      await registerSource(root, record, entry, {baseDir: dir});
    }
  }
  await attach(good);
  await attach(bad);
  await attach(uncertain, observation => {observation.floors[0].islands[0].machineSlots[1].visibleNumber = null;});
  await attach(restricted, null, false);
  assert.equal(good.layoutProgress, 'source_ready');
  assert.equal(restricted.layoutProgress, 'source_needed');
  await saveMaster(root, master);
  const dry = await generateNationwide(root, {storeIds: ['fixture-hall'], dryRun: true});
  assert.equal(dry.counts.ready, 1);
  assert.equal((await loadMaster(root)).stores['fixture-hall'].generation, null);
  const noRights = await generateNationwide(root, {storeIds: ['restricted-hall'], dryRun: false});
  assert.equal(noRights.counts.blocked, 1);
  for (const source of restricted.sources) reviewSourceUsage(restricted, {sourceId: source.sourceId,
    usageReviewed: true, usageNote: 'Rights now checked by human'});
  assert.equal(restricted.layoutProgress, 'source_ready');
  await saveMaster(root, master);
  await fs.rm(path.join(root, 'work/nationwide/evidence/broken-hall/observation.json'));
  const batch = await generateNationwide(root, {storeIds: ['fixture-hall', 'broken-hall', 'uncertain-hall'], dryRun: false});
  assert.equal(batch.counts.failed, 1);
  assert.equal(batch.counts.validated, 1);
  assert.equal(batch.counts.needs_review, 1);
  const after = await loadMaster(root), goodRecord = after.stores['fixture-hall'];
  assert.equal(goodRecord.layoutProgress, 'validated');
  assert.equal(after.stores['uncertain-hall'].layoutProgress, 'needs_review');
  assert(queueRows(after, {state: 'needs_review'}).some(item => item.hallId === 'uncertain-hall' && item.unresolvedCount > 0));
  const resume = await generateNationwide(root, {storeIds: ['fixture-hall'], dryRun: false});
  assert.equal(resume.counts.skipped, 1);
  const forced = await generateNationwide(root, {storeIds: ['fixture-hall'], dryRun: false, force: true});
  assert.equal(forced.counts.validated, 1);
  const current = (await loadMaster(root)).stores['fixture-hall'];
  const layout = await read(current.generation.layoutPath);
  const multi = structuredClone(layout);
  multi.floors.push({...structuredClone(layout.floors[0]), id: 'second-floor', islands: [], unassignedMachines: []});
  const multiReport = await validateRolloutDraft(root, current, multi, current.generation.audit);
  assert(multiReport.blockedReasons.includes('unsupported_multi_floor'));
  const notReviewed = await read(current.generation.layoutPath);
  assert.equal(notReviewed.verification.status, 'generated');
  await assert.rejects(() => prepareGoal6Handoff(root, {hallId: 'fixture-hall', approvedBy: 'a', approvalNote: 'a', promoteReason: 'a'}),
    /Human verification/);
  const reviewed = structuredClone(layout);
  reviewed.review = {originalSourceType: 'ai', humanModified: true, modifiedAt: new Date().toISOString()};
  reviewed.verification.status = 'verified'; reviewed.verification.lastVerifiedAt = new Date().toISOString();
  const reviewedPath = path.join(root, 'review-export.json'); await fs.writeFile(reviewedPath, JSON.stringify(reviewed));
  const review = await importHumanReview(root, {hallId: 'fixture-hall', reviewedPath, reviewedBy: 'human',
    reviewedAt: new Date().toISOString(), reviewNotes: 'Checked all slots', unresolvedCount: 0});
  assert.equal(review.status, 'human_verified');
  const handoff = await prepareGoal6Handoff(root, {hallId: 'fixture-hall', approvedBy: 'human',
    approvalNote: 'Approved after review', promoteReason: 'Ready for separate Goal 6 review'});
  assert.equal(handoff.status, 'approved_for_promotion');
  const request = await read(handoff.requestPath);
  assert.equal((await runPromotionAction('promote', request, {root})).status, 'ready');
  assert.equal((await fs.access(path.join(root, 'work/publish-state/index.json')).then(() => true, () => false)), false);
  assert.equal((await read(path.join(root, 'data/halls.json'))).halls.length, 0);
  assert.equal(progressStats(await loadMaster(root)).nationwide.approved_for_promotion, 1);
  await fs.writeFile(path.join(root, 'data/fixture-hall.json'), JSON.stringify({id: 'fixture-hall',
    seats: [{seat: 101}, {seat: 999}]}));
  await fs.writeFile(path.join(root, 'data/positions-fixture-hall.json'), JSON.stringify({'101': [150, 70, 20, 20]}));
  const changedExisting = await validateRolloutDraft(root, current, reviewed, current.generation.audit, {reviewed: true});
  assert(changedExisting.blockedReasons.includes('existing_number_set_mismatch'));
  assert(changedExisting.existingDiff.missingNumbers.includes(999));
  console.log('PASS: 19-store seed, duplicate/transition guard, local source policy, batch isolation, resume/cache/force, warning/multi-floor gates, human review, Goal 6 dry-run handoff');
} finally {await fs.rm(root, {recursive: true, force: true});}
for (let i = 0; i < tracked.length; i++) assert.deepEqual(await fs.readFile(path.join(repo, tracked[i])), originals[i]);
