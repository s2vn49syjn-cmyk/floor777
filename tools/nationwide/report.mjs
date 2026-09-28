import fs from 'node:fs/promises';
import {loadMaster} from './master.mjs';
import {sourcePackStatuses} from './populate.mjs';
import {inspectSourcePack} from './source-pack.mjs';
import {validateRolloutDraft} from './validate.mjs';

const summarize = rows => ({totalHalls: rows.length,
  source_needed: rows.filter(row => row.sourceStatus === 'source_needed').length,
  source_ready: rows.filter(row => row.sourceStatus === 'source_ready').length,
  generated: rows.filter(row => row.generation?.layoutPath).length,
  needs_review: rows.filter(row => row.layoutStatus === 'needs_review').length,
  review_ready: rows.filter(row => row.generation?.layoutPath && !row.review).length,
  human_verified: rows.filter(row => row.layoutStatus === 'human_verified').length,
  handoff_ready: rows.filter(row => row.handoffReady).length,
  blocked: rows.filter(row => row.sourceStatus === 'blocked' || row.layoutStatus === 'blocked').length,
  published: rows.filter(row => row.published).length});

export async function handoffCandidates(root, {prefecture = null} = {}) {
  const master = await loadMaster(root), candidates = [];
  for (const record of Object.values(master.stores)) {
    if (prefecture && record.prefecture !== prefecture || record.layoutProgress !== 'human_verified' ||
      !record.review?.reviewedPath || record.review.unresolvedCount !== 0) continue;
    const pack = await inspectSourcePack(root, record.hallId);
    if (pack.status !== 'source_ready') continue;
    let layout;
    try {layout = JSON.parse(await fs.readFile(record.review.reviewedPath, 'utf8'));} catch {continue;}
    const report = await validateRolloutDraft(root, record, layout, record.generation?.audit, {reviewed: true});
    if (report.status !== 'validated' || layout.floors.length !== 1 || layout.verification.status !== 'verified') continue;
    candidates.push({hallId: record.hallId, name: record.name, prefecture: record.prefecture,
      reviewedPath: record.review.reviewedPath, reviewedBy: record.review.reviewedBy,
      humanReviewedAt: record.review.humanReviewedAt, sourceStatus: pack.status,
      note: 'Candidate only; Goal 6 promote/stage/publish are not run'});
  }
  return candidates.sort((a, b) => a.hallId.localeCompare(b.hallId));
}

export async function reviewQueue(root, {prefecture = null} = {}) {
  const master = await loadMaster(root), rows = [];
  for (const record of Object.values(master.stores)) {
    if (prefecture && record.prefecture !== prefecture || !record.generation?.layoutPath ||
      record.layoutProgress === 'human_verified' || record.published) continue;
    let layout;
    const draftPath = record.review?.unresolvedCount ? record.review.reviewedPath : record.generation.layoutPath;
    try {layout = JSON.parse(await fs.readFile(draftPath, 'utf8'));} catch {continue;}
    rows.push({hallId: record.hallId, name: record.name, prefecture: record.prefecture,
      sources: record.sources.map(source => ({sourceId: source.sourceId, sourceType: source.sourceType,
        observedAt: source.observedAt, sourceUrl: source.sourceUrl})),
      generatedAt: record.generation.generatedAt, confidence: layout.confidence,
      unresolvedWarnings: record.validation?.warnings ?? [], unresolvedCount: record.review?.unresolvedCount ?? record.validation?.unresolvedCount ?? null,
      machineCount: record.validation?.machineCount ?? null, seatNumberDiff: record.validation?.existingDiff ?
        {missing: record.validation.existingDiff.missingNumbers, added: record.validation.existingDiff.addedNumbers} : null,
      layoutDiff: record.validation?.existingDiff ?? null,
      draftPath,
      reviewEditorUrl: 'http://127.0.0.1:8781/tools/layout-review.html'});
  }
  return rows.sort((a, b) => a.hallId.localeCompare(b.hallId));
}

export async function populationDashboard(root) {
  const master = await loadMaster(root), packRows = await sourcePackStatuses(root), ready = await handoffCandidates(root);
  const readyIds = new Set(ready.map(item => item.hallId));
  const rows = packRows.map(row => ({...row, published: row.currentPublicStatus === 'published',
    generation: master.stores[row.hallId].generation, review: master.stores[row.hallId].review,
    handoffReady: readyIds.has(row.hallId)}));
  const prefectures = {};
  for (const prefecture of new Set(rows.map(row => row.prefecture))) {
    prefectures[prefecture] = summarize(rows.filter(row => row.prefecture === prefecture));
  }
  const bottlenecks = {};
  for (const row of rows) for (const reason of row.blockerReasons) bottlenecks[reason] = (bottlenecks[reason] ?? 0) + 1;
  return {nationwide: summarize(rows), prefectures, bottlenecks};
}
