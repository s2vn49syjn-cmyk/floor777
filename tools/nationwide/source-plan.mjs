import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMaster} from './master.mjs';
import {sourcePackStatuses} from './populate.mjs';
import {createSourceTemplate} from './source-pack.mjs';

const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'source-candidates.json');
const loadCatalog = async () => fs.readFile(catalogPath, 'utf8').then(JSON.parse, () => ({halls: {}}));
const cloudCollectableTypes = new Set(['p-world-smart-floor', 'p-world-slot-floor-image', 'maruhan-floor-image-via-p-world']);

export function sourceCandidateCapability(candidate) {
  if (!candidate || typeof candidate !== 'object') return 'discovery_only';
  if (cloudCollectableTypes.has(candidate.sourceType)) return 'cloud_collectable';
  if (candidate.sourceType === 'p-world') return 'cloud_probe';
  if (candidate.sourceType === 'dmm-p-town') return 'external_review_needed';
  return 'discovery_only';
}

export async function sourceAcquisitionPlan(root, {hallIds = null, prefecture = null, limit = Infinity,
  createTemplates = false} = {}) {
  const [master, catalog] = await Promise.all([loadMaster(root), loadCatalog()]);
  if (hallIds?.some(id => !master.stores[id])) throw Error('Unknown selected hallId');
  if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) throw Error('limit must be positive');

  const rows = await sourcePackStatuses(root, {hallIds, prefecture, limit: Infinity});
  const selected = rows.filter(row => {
    const record = master.stores[row.hallId];
    return record && !record.published && record.slotSupported && row.sourceStatus !== 'source_ready';
  }).slice(0, limit);

  const results = [];
  for (const row of selected) {
    let template = null;
    if (createTemplates && row.sourceStatus === 'source_needed') {
      template = await createSourceTemplate(root, row.hallId, {dryRun: false});
    }
    const directory = path.join('work', 'nationwide', 'sources', row.hallId).replaceAll('\\', '/');
    results.push({
      hallId: row.hallId,
      hallName: row.hallName,
      prefecture: row.prefecture,
      municipality: row.municipality,
      sourceStatus: row.sourceStatus,
      blockers: row.blockerReasons,
      targetDirectory: directory,
      manifestPath: `${directory}/manifest.json`,
      template,
      candidateSources: (catalog.halls?.[row.hallId] ?? []).map(candidate => ({
        ...candidate,
        collectionCapability: sourceCandidateCapability(candidate)
      })),
      searchQueries: [
        `${row.hallName} フロアマップ`,
        `${row.hallName} P-WORLD フロアマップ`,
        `${row.hallName} 公式 フロアマップ`
      ],
      requirements: {
        floorMapImageOrPdf: true,
        usageReviewRequired: true,
        observedAtRequired: true,
        sourceOwnerRequired: true
      }
    });
  }

  const candidates = results.flatMap(item => item.candidateSources);
  return {
    selected: results.length,
    createdTemplates: results.filter(item => item.template?.status === 'created').length,
    acquisitionSummary: {
      cloudCollectableCandidates: candidates.filter(source => source.collectionCapability === 'cloud_collectable').length,
      cloudProbeCandidates: candidates.filter(source => source.collectionCapability === 'cloud_probe').length,
      externalReviewCandidates: candidates.filter(source => source.collectionCapability === 'external_review_needed').length,
      discoveryOnlyCandidates: candidates.filter(source => source.collectionCapability === 'discovery_only').length
    },
    results
  };
}
