import path from 'node:path';
import {loadMaster} from './master.mjs';
import {sourcePackStatuses} from './populate.mjs';
import {createSourceTemplate} from './source-pack.mjs';

export async function sourceAcquisitionPlan(root, {hallIds = null, prefecture = null, limit = Infinity,
  createTemplates = false} = {}) {
  const master = await loadMaster(root);
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

  return {
    selected: results.length,
    createdTemplates: results.filter(item => item.template?.status === 'created').length,
    results
  };
}
