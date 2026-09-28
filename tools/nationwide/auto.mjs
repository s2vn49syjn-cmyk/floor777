import {loadMaster} from './master.mjs';
import {processSourcePacks} from './populate.mjs';
import {reviewQueue} from './report.mjs';
import {prepareReview} from '../prepare-review.mjs';

const allowedProgress = new Set(['generated', 'validated', 'needs_review', 'blocked']);
const usableGeneration = new Set(['generated', 'needs_review']);

export async function autoPopulateAll(root, {hallIds = null, prefecture = null, limit = Infinity,
  dryRun = true, force = false, provider = undefined, prepare = true} = {}) {
  const master = await loadMaster(root);
  if (hallIds?.some(id => !master.stores[id])) throw Error('Unknown selected hallId');
  if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) throw Error('limit must be positive');

  const selectedIds = Object.values(master.stores)
    .filter(record => !record.published && record.slotSupported &&
      (!hallIds || hallIds.includes(record.hallId)) &&
      (!prefecture || record.prefecture === prefecture))
    .sort((a, b) => a.hallId.localeCompare(b.hallId))
    .slice(0, limit)
    .map(record => record.hallId);

  const population = await processSourcePacks(root, {
    hallIds: selectedIds, dryRun, force, ...(provider ? {provider} : {})
  });

  if (dryRun) {
    return {
      dryRun: true,
      selected: selectedIds.length,
      population,
      prepared: [],
      reviewQueue: [],
      summary: {
        sourceNeeded: population.results.filter(item => item.status === 'source_needed').length,
        blocked: population.results.filter(item => item.status === 'blocked').length,
        readyToGenerate: population.results.filter(item => item.status === 'ready').length,
        prepared: 0
      }
    };
  }

  let prepared = [];
  if (prepare) {
    const after = await loadMaster(root);
    const preparable = selectedIds.filter(id => {
      const record = after.stores[id];
      return record && !record.published && !record.review && record.generation?.layoutPath &&
        usableGeneration.has(record.generation.status) && allowedProgress.has(record.layoutProgress);
    });
    if (preparable.length) prepared = await prepareReview(root, preparable, {register: true});
  }

  const selected = new Set(selectedIds);
  const queue = (await reviewQueue(root, {prefecture})).filter(item => selected.has(item.hallId));
  return {
    dryRun: false,
    selected: selectedIds.length,
    population,
    prepared,
    reviewQueue: queue,
    summary: {
      sourceNeeded: population.results.filter(item => item.status === 'source_needed').length,
      blocked: population.results.filter(item => item.status === 'blocked').length,
      generatedOrCached: population.results.filter(item => ['validated', 'needs_review', 'skipped'].includes(item.status)).length,
      prepared: prepared.filter(item => item.status === 'needs_review').length,
      reviewQueue: queue.length,
      failed: population.results.filter(item => item.status === 'failed').length +
        prepared.filter(item => item.status === 'failed').length
    }
  };
}
