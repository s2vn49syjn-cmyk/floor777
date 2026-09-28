import fs from 'node:fs/promises';
import path from 'node:path';
import {loadMaster, saveMaster} from './master.mjs';
import {registerSource} from './evidence.mjs';
import {generateNationwide} from './pipeline.mjs';
import {inspectSourcePack, packDirectory} from './source-pack.mjs';

const exists = file => fs.access(file).then(() => true, () => false);

export async function importSourcePack(root, hallId, {dryRun = true} = {}) {
  const master = await loadMaster(root), record = master.stores[hallId];
  if (!record) return {hallId, status: 'failed', reasons: ['hallId is not registered']};
  if (record.published) return {hallId, status: 'skipped', reasons: ['published store remains read-only']};
  const pack = await inspectSourcePack(root, hallId);
  if (pack.status !== 'source_ready') return {hallId, status: pack.status, reasons: pack.reasons};
  const pending = [];
  for (const item of pack.sources) {
    const current = record.sources.find(source => source.sourceId === item.source.sourceId);
    if (current) {
      if (current.checksum !== item.checksum || !current.usageReviewed ||
        current.observedAt !== item.source.observedAt || current.importedAt !== item.source.importedAt ||
        current.sourceType !== item.source.sourceType || current.sourceUrl !== (item.source.sourceUrl ?? null) ||
        current.usageNote !== item.source.usageNote || current.usageReviewedAt !== item.source.usageReviewedAt ||
        current.sourceOwner !== item.source.sourceOwner) {
        return {hallId, status: 'blocked', reasons: [`${item.source.sourceId}: registered source conflicts with Source Pack; use a new sourceId for a new version`]};
      }
    } else pending.push(item);
  }
  if (dryRun) return {hallId, status: 'source_ready', dryRun: true, importCount: pending.length, reasons: []};
  const updated = structuredClone(record), created = [];
  try {
    for (const {source, absolute} of pending) {
      const result = await registerSource(root, updated, {...source, localFile: absolute}, {baseDir: packDirectory(root, hallId)});
      const registered = updated.sources.find(item => item.sourceId === source.sourceId);
      registered.usageReviewedAt = source.usageReviewedAt;
      registered.sourceOwner = source.sourceOwner;
      created.push(path.join(root, result.source.localFile));
    }
    updated.lastUpdatedAt = new Date().toISOString();
    master.stores[hallId] = updated;
    await saveMaster(root, master);
    return {hallId, status: 'source_ready', dryRun: false, importCount: pending.length, reasons: []};
  } catch (error) {
    for (const file of created) await fs.rm(file, {force: true}).catch(() => {});
    return {hallId, status: 'failed', reasons: [error.message]};
  }
}

export async function processSourcePacks(root, {hallIds = null, prefecture = null, limit = Infinity,
  dryRun = true, force = false, provider = undefined} = {}) {
  const master = await loadMaster(root);
  if (hallIds?.some(id => !master.stores[id])) throw Error('Unknown selected hallId');
  if ((!Number.isInteger(limit) && limit !== Infinity) || limit < 1) throw Error('limit must be positive');
  const selected = Object.values(master.stores).filter(record =>
    (!hallIds || hallIds.includes(record.hallId)) && (!prefecture || record.prefecture === prefecture))
    .sort((a, b) => a.hallId.localeCompare(b.hallId)).slice(0, limit);
  const results = [];
  for (const record of selected) {
    try {
      const imported = await importSourcePack(root, record.hallId, {dryRun});
      if (imported.status !== 'source_ready') {results.push(imported); continue;}
      if (dryRun) {results.push({hallId: record.hallId, status: 'ready', sourceImport: imported,
        reason: 'would_import_source_pack_and_generate'}); continue;}
      const generated = await generateNationwide(root, {storeIds: [record.hallId], dryRun, force,
        ...(provider ? {provider} : {})});
      results.push({hallId: record.hallId, status: generated.results[0].status,
        sourceImport: imported, generation: generated.results[0]});
    } catch (error) {results.push({hallId: record.hallId, status: 'failed', reasons: [error.message]});}
  }
  let logPath = null;
  if (!dryRun) {
    const dir = path.join(root, 'work/nationwide/population-runs');
    await fs.mkdir(dir, {recursive: true});
    logPath = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`);
    await fs.writeFile(logPath, `${JSON.stringify({at: new Date().toISOString(), results}, null, 2)}\n`);
  }
  const statuses = ['validated', 'needs_review', 'blocked', 'failed', 'skipped', 'ready', 'source_needed'];
  return {dryRun, logPath, selected: selected.length, counts: Object.fromEntries(statuses.map(status =>
    [status, results.filter(item => item.status === status).length])), results};
}

export async function sourcePackStatuses(root, {prefecture = null, layoutStatus = null, sourceStatus = null,
  hallIds = null, limit = Infinity} = {}) {
  const master = await loadMaster(root);
  const rows = [];
  for (const record of Object.values(master.stores).sort((a, b) => a.hallId.localeCompare(b.hallId))) {
    if (prefecture && record.prefecture !== prefecture || layoutStatus && record.layoutProgress !== layoutStatus ||
      hallIds && !hallIds.includes(record.hallId)) continue;
    const pack = await inspectSourcePack(root, record.hallId);
    if (sourceStatus && pack.status !== sourceStatus) continue;
    rows.push({hallId: record.hallId, hallName: record.name, prefecture: record.prefecture,
      municipality: record.municipality, currentPublicStatus: record.published ? 'published' : 'unpublished',
      layoutStatus: record.layoutProgress, sourceStatus: pack.status,
      reviewStatus: record.review?.verificationStatus ?? 'not_reviewed',
      blockerReasons: [...new Set([...pack.reasons, ...(record.validation?.blockedReasons ?? []),
        ...(record.review?.unresolvedCount ? [`${record.review.unresolvedCount} unresolved review item(s)`] : [])])],
      lastUpdatedAt: record.lastUpdatedAt ?? null,
      sourceCount: pack.sources?.length ?? 0});
    if (rows.length >= limit) break;
  }
  return rows;
}
