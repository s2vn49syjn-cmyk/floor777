import {loadMaster} from './master.mjs';
import {sourceReadiness} from './evidence.mjs';

export function queueRows(master, {state = null, prefecture = null, ungenerated = false, hallIds = null, limit = Infinity} = {}) {
  return Object.values(master.stores).sort((a, b) => a.hallId.localeCompare(b.hallId)).filter(record =>
    (!state || record.layoutProgress === state) && (!prefecture || record.prefecture === prefecture) &&
    (!ungenerated || !record.generation) && (!hallIds || hallIds.includes(record.hallId))).slice(0, limit).map(record => {
    const evidence = sourceReadiness(record), report = record.validation;
    const unresolvedCount = record.review?.unresolvedCount ?? report?.unresolvedCount ?? null;
    const numberMatch = report?.existingDiff ? !report.existingDiff.seatCountDifference &&
      !report.existingDiff.addedNumbers.length && !report.existingDiff.missingNumbers.length : null;
    return {hallId: record.hallId, name: record.name, prefecture: record.prefecture,
      municipality: record.municipality, layoutProgress: record.layoutProgress, published: record.published,
      sourceAvailable: record.sources.length > 0, sourceUsageReviewed: record.sources.length > 0 && record.sources.every(source => source.usageReviewed),
      sourceReady: evidence.ready, sourceReasons: evidence.reasons,
      generated: !!record.generation?.layoutPath, validatorPassed: report?.status === 'validated',
      unresolvedCount, seatNumbersMatch: numberMatch, humanReviewed: !!record.review,
      goal6Eligible: record.layoutProgress === 'human_verified' && evidence.ready && report?.status === 'validated' &&
        unresolvedCount === 0 && numberMatch !== false,
      draftPath: record.review?.reviewedPath ?? record.generation?.preparedReview?.layoutPath ?? record.generation?.layoutPath ?? null,
      reviewEditorUrl: `http://127.0.0.1:8781${record.generation?.preparedReview?.reviewPath ?? `/tools/layout-review.html?store=${record.hallId}`}`};
  });
}

export function progressStats(master) {
  const stores = Object.values(master.stores), prefectures = {};
  const summary = rows => ({total: rows.length,
    ...Object.fromEntries(['source_needed', 'source_ready', 'generated', 'needs_review', 'validated',
      'human_verified', 'approved_for_promotion', 'blocked', 'published'].map(state =>
      [state, rows.filter(row => row.layoutProgress === state).length])),
    missingRegisteredSources: rows.filter(row => !row.sources.length && !row.published).length});
  for (const prefecture of new Set(stores.map(store => store.prefecture))) {
    prefectures[prefecture] = summary(stores.filter(store => store.prefecture === prefecture));
  }
  return {nationwide: summary(stores), prefectures};
}

export async function readQueue(root, filter = {}) {
  const master = await loadMaster(root);
  return {rows: queueRows(master, filter), stats: progressStats(master)};
}
