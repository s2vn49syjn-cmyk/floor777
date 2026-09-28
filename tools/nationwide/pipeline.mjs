import fs from 'node:fs/promises';
import path from 'node:path';
import {buildEvidenceBundle, hash, stable} from '../generate-layout/source-intake.mjs';
import {GENERATOR_VERSION, generateStore} from '../generate-layout/index.mjs';
import {mockProvider} from '../generate-layout/providers/mock.mjs';
import {loadMaster, saveMaster, transition} from './master.mjs';
import {evidenceManifest, sourceReadiness} from './evidence.mjs';
import {validateRolloutDraft} from './validate.mjs';

const exists = file => fs.access(file).then(() => true, () => false);
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const note = (record, state, reason) => {
  if (record.layoutProgress !== state) transition(record, state, reason);
};

export async function generateNationwide(root, {storeIds = null, prefecture = null, limit = Infinity,
  dryRun = true, force = false, provider = mockProvider, generatorVersion = GENERATOR_VERSION} = {}) {
  const master = await loadMaster(root);
  const ids = Object.keys(master.stores).sort().filter(id =>
    (!storeIds || storeIds.includes(id)) && (!prefecture || master.stores[id].prefecture === prefecture));
  if (storeIds?.some(id => !master.stores[id])) throw Error('Unknown explicitly selected storeId');
  if (!Number.isInteger(limit) && limit !== Infinity || limit < 1) throw Error('limit must be positive');
  const selected = ids.slice(0, limit), results = [];
  for (const id of selected) {
    const record = master.stores[id];
    try {
      if (record.published || record.layoutProgress === 'published') {
        results.push({hallId: id, status: 'skipped', reason: 'published_store_is_read_only'}); continue;
      }
      if (!record.slotSupported) {results.push({hallId: id, status: 'blocked', reasons: ['slot_not_supported']}); continue;}
      if (['human_verified', 'approved_for_promotion', 'promoted', 'ready_to_publish'].includes(record.layoutProgress)) {
        results.push({hallId: id, status: 'skipped', reason: 'human_review_or_promotion_in_progress'}); continue;
      }
      const readiness = sourceReadiness(record);
      if (!readiness.ready) {results.push({hallId: id, status: 'blocked', reasons: readiness.reasons}); continue;}
      const manifest = await evidenceManifest(root, record);
      const bundle = await buildEvidenceBundle(manifest, {baseDir: root});
      const fingerprint = hash(stable({generatorVersion, provider: provider.id, model: provider.model,
        sources: bundle.sources.map(source => source.contentHash)}));
      if (!force && record.generation?.fingerprint === fingerprint && record.generation.layoutPath &&
        await exists(record.generation.layoutPath)) {
        results.push({hallId: id, status: 'skipped', reason: 'unchanged_cached_draft', layoutPath: record.generation.layoutPath}); continue;
      }
      if (dryRun) {results.push({hallId: id, status: 'ready', reason: 'would_generate', sourceCount: bundle.sources.length}); continue;}
      if (record.layoutProgress === 'blocked') note(record, 'source_ready', 'Reviewed sources now available');
      const generated = await generateStore(manifest, {baseDir: root, draftRoot: path.join(root, 'work/layout-drafts'),
        provider, generatorVersion, force});
      let validation = null;
      if (generated.layout) validation = await validateRolloutDraft(root, record, generated.layout, generated.audit);
      const status = generated.status === 'failed' ? 'failed' :
        generated.status === 'blocked' || generated.status === 'insufficient_evidence' || validation?.status === 'blocked'
          ? 'blocked' : generated.status === 'needs_review' || validation?.status === 'needs_review' ? 'needs_review' : 'validated';
      if (status === 'validated') {note(record, 'generated', 'AI draft generated'); note(record, 'validated', 'Automated checks passed');}
      else if (status !== 'failed') note(record, status, generated.audit.reasons.join('; ') || validation?.blockedReasons.join('; ') || 'Review required');
      record.generation = {status: generated.status, fingerprint, layoutPath: generated.layoutPath,
        generatedAt: generated.audit.generatedAt, provider: generated.audit.provider,
        model: generated.audit.model, generatorVersion, sourceHashes: generated.audit.sourceHashes,
        audit: generated.audit, cached: generated.cached};
      record.validation = validation;
      record.lastUpdatedAt = new Date().toISOString();
      await saveMaster(root, master);
      results.push({hallId: id, status, generatedStatus: generated.status, cached: generated.cached,
        layoutPath: generated.layoutPath, reasons: [...(generated.audit.reasons ?? []), ...(validation?.blockedReasons ?? [])]});
    } catch (error) {
      results.push({hallId: id, status: 'failed', reasons: [error.message]});
    }
  }
  if (!dryRun) {
    const dir = path.join(root, 'work/nationwide/runs'); await fs.mkdir(dir, {recursive: true});
    const log = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`);
    await fs.writeFile(log, `${JSON.stringify({generatedAt: new Date().toISOString(), results}, null, 2)}\n`);
  }
  const statuses = ['validated', 'needs_review', 'blocked', 'failed', 'skipped', 'ready'];
  return {dryRun, selected: selected.length, counts: Object.fromEntries(statuses.map(status =>
    [status, results.filter(result => result.status === status).length])), results};
}

export async function importHumanReview(root, {hallId, reviewedPath, reviewedBy, reviewedAt,
  reviewNotes, unresolvedCount}) {
  const master = await loadMaster(root), record = master.stores[hallId];
  if (!record) throw Error('Unknown store');
  if (!record.generation?.layoutPath) throw Error('No generated draft exists');
  if (!reviewedBy?.trim() || !Number.isFinite(Date.parse(reviewedAt)) || typeof reviewNotes !== 'string' ||
    !Number.isSafeInteger(unresolvedCount) || unresolvedCount < 0) throw Error('Complete human review metadata is required');
  const layout = await readJSON(path.resolve(reviewedPath));
  if (layout.storeId !== hallId || !(layout.review?.humanModified ||
    layout.verification?.status === 'verified' && layout.verification.lastVerifiedAt)) {
    throw Error('Review Editor verification is required');
  }
  const validation = await validateRolloutDraft(root, record, layout, record.generation.audit, {reviewed: true});
  if (!unresolvedCount && (validation.status !== 'validated' || layout.verification?.status !== 'verified' ||
    !layout.verification.lastVerifiedAt)) throw Error(`Human review cannot pass: ${validation.blockedReasons.join(', ')} ${validation.warnings.join(', ')}`);
  if (!['validated', 'needs_review'].includes(record.layoutProgress)) throw Error(`Cannot review from ${record.layoutProgress}`);
  const completed = unresolvedCount === 0;
  const dir = path.join(root, completed ? 'work/nationwide/reviewed' : 'work/nationwide/review-in-progress');
  await fs.mkdir(dir, {recursive: true});
  const target = path.join(dir, `${hallId}.json`);
  await fs.copyFile(path.resolve(reviewedPath), target);
  if (completed) {
    if (record.layoutProgress === 'needs_review') note(record, 'validated', 'Review Editor corrections validated');
    note(record, 'human_verified', `Reviewed by ${reviewedBy}`);
    record.lastVerifiedAt = reviewedAt;
  } else note(record, 'needs_review', `Review Editor has ${unresolvedCount} unresolved item(s)`);
  record.review = {reviewedBy: reviewedBy.trim(), humanReviewedAt: reviewedAt, reviewNotes,
    unresolvedCount, verificationStatus: completed ? 'verified' : 'needs_review', reviewedPath: target};
  record.validation = validation;
  record.lastUpdatedAt = new Date().toISOString();
  await saveMaster(root, master);
  return {hallId, status: completed ? 'human_verified' : 'needs_review', reviewedPath: target, validation};
}

export async function prepareGoal6Handoff(root, {hallId, approvedBy, approvalNote, promoteReason}) {
  const master = await loadMaster(root), record = master.stores[hallId];
  if (!record || record.layoutProgress !== 'human_verified' || !record.review) throw Error('Human verification is required');
  if (!approvedBy?.trim() || !approvalNote?.trim() || !promoteReason?.trim()) throw Error('Explicit approval metadata is required');
  const manifest = await evidenceManifest(root, record);
  const layout = await readJSON(record.review.reviewedPath);
  const validation = await validateRolloutDraft(root, record, layout, record.generation.audit, {reviewed: true});
  if (validation.status !== 'validated' || record.review.unresolvedCount) throw Error('Unresolved validation or review issues block Goal 6 handoff');
  if (layout.floors.length !== 1) throw Error('unsupported_multi_floor');
  const source = manifest.sources[0];
  const request = {storeId: hallId, draftPath: record.review.reviewedPath,
    reviewer: record.review.reviewedBy, reviewedAt: record.review.humanReviewedAt,
    approvalNote: `${record.review.reviewNotes}; ${approvalNote.trim()}`,
    sourceSummary: manifest.sources.map(item => `${item.sourceType} (${item.sourceUrl ?? 'local'}, ${item.observedAt})`).join('; '),
    promoteReason: promoteReason.trim(), promotedBy: approvedBy.trim(), category: source.category,
    rentalType: source.rentalType, sourcePolicyReviewed: true, manualApprovalChecked: true,
    provider: record.generation.provider, model: record.generation.model,
    sourceHashes: record.generation.sourceHashes.map(item => item.contentHash), acceptWarnings: []};
  const dir = path.join(root, 'work/nationwide/goal6-requests'); await fs.mkdir(dir, {recursive: true});
  const target = path.join(dir, `${hallId}.json`); await fs.writeFile(target, `${JSON.stringify(request, null, 2)}\n`);
  transition(record, 'approved_for_promotion', 'Explicit human approval for Goal 6 handoff');
  await saveMaster(root, master);
  return {hallId, status: 'approved_for_promotion', requestPath: target, note: 'Goal 6 promote is not executed'};
}
