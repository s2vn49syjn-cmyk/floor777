import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeArtifact} from '../generate-layout/normalize-source.mjs';
import {hallIdPattern, transition} from './master.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const safeUrl = value => value === null || value === undefined || typeof value === 'string' && /^https:\/\//.test(value);

export function sourceReadiness(record) {
  const sources = record.sources ?? [];
  const reasons = [];
  if (!sources.length) reasons.push('source_missing');
  if (sources.some(source => !source.usageReviewed)) reasons.push('source_usage_unreviewed');
  if (!sources.some(source => ['png', 'jpeg', 'pdf'].includes(source.format))) reasons.push('floor_map_missing');
  if (sources.some(source => !source.checksum || !source.observedAt || !source.importedAt)) reasons.push('provenance_incomplete');
  return {ready: !reasons.length, reasons};
}

export async function inspectSource(root, record, source, {baseDir = process.cwd()} = {}) {
  if (!source || !hallIdPattern.test(source.sourceId ?? '') || record.sources.some(item => item.sourceId === source.sourceId)) {
    throw Error('sourceId must be safe and unique within the store');
  }
  if (!source.sourceType || typeof source.sourceType !== 'string' || !safeUrl(source.sourceUrl) ||
    !isDate(source.observedAt) || !isDate(source.importedAt) ||
    !hallIdPattern.test(source.floor ?? '') || !['slot', 'pachinko'].includes(source.category) ||
    !source.rentalType || typeof source.rentalType !== 'string' ||
    typeof source.usageReviewed !== 'boolean' || typeof source.usageNote !== 'string') {
    throw Error('Source metadata, usage review, floor, category and rental type are required');
  }
  if (typeof source.localFile !== 'string' || !source.localFile) throw Error('Explicit localFile is required; network retrieval is disabled');
  const from = path.resolve(baseDir, source.localFile);
  const bytes = await fs.readFile(from);
  const normalized = normalizeArtifact(from, bytes);
  const ext = path.extname(from).toLowerCase();
  const relative = path.join('work', 'nationwide', 'evidence', record.hallId, `${source.sourceId}${ext}`);
  return {from, bytes, record: {sourceId: source.sourceId, sourceType: source.sourceType, sourceUrl: source.sourceUrl ?? null,
    observedAt: source.observedAt, importedAt: source.importedAt, floor: source.floor,
    category: source.category, rentalType: source.rentalType, usageReviewed: source.usageReviewed,
    usageNote: source.usageNote, localFile: relative.replaceAll('\\', '/'), checksum: digest(bytes),
    format: normalized.format, structuredFacts: source.structuredFacts ?? null}};
}

export async function registerSource(root, record, source, options = {}) {
  const inspected = await inspectSource(root, record, source, options);
  if (options.dryRun) return {source: inspected.record, status: 'ready', dryRun: true};
  const to = path.join(root, inspected.record.localFile);
  await fs.mkdir(path.dirname(to), {recursive: true});
  await fs.writeFile(to, inspected.bytes, {flag: 'wx'});
  record.sources.push(inspected.record);
  record.sourceInfo.push({sourceType: source.sourceType, sourceUrl: source.sourceUrl ?? null});
  if (record.layoutProgress === 'source_needed' && sourceReadiness(record).ready) transition(record, 'source_ready', 'Local evidence registered and usage reviewed');
  return {source: inspected.record, status: sourceReadiness(record).ready ? 'source_ready' : 'source_needed', dryRun: false};
}

export function reviewSourceUsage(record, {sourceId, usageReviewed, usageNote}) {
  const source = record.sources.find(item => item.sourceId === sourceId);
  if (!source) throw Error('Registered source not found');
  if (typeof usageReviewed !== 'boolean' || typeof usageNote !== 'string' || !usageNote.trim()) {
    throw Error('Explicit usageReviewed and usageNote are required');
  }
  source.usageReviewed = usageReviewed;
  source.usageNote = usageNote.trim();
  source.usageReviewedAt = new Date().toISOString();
  record.history.push({state: record.layoutProgress, at: source.usageReviewedAt, reason: `Source usage reviewed: ${sourceId}`});
  if (record.layoutProgress === 'source_needed' && sourceReadiness(record).ready) {
    transition(record, 'source_ready', 'All local evidence and usage checks completed');
  }
  return {sourceId, usageReviewed, sourceReady: sourceReadiness(record).ready};
}

export async function evidenceManifest(root, record) {
  const ready = sourceReadiness(record);
  if (!ready.ready) throw Error(`Evidence blocked: ${ready.reasons.join(', ')}`);
  const sources = [];
  for (const source of record.sources) {
    const absolute = path.resolve(root, source.localFile);
    const evidenceDir = path.resolve(root, 'work/nationwide/evidence', record.hallId);
    if (!absolute.startsWith(evidenceDir + path.sep)) throw Error(`Source path leaves private evidence directory: ${source.sourceId}`);
    const bytes = await fs.readFile(absolute);
    if (digest(bytes) !== source.checksum) throw Error(`Source checksum changed: ${source.sourceId}`);
    sources.push({sourceId: source.sourceId, sourceType: source.sourceType, sourceUrl: source.sourceUrl,
      observedAt: source.observedAt, retrievedAt: source.importedAt, floor: source.floor,
      category: source.category, rentalType: source.rentalType, localArtifactPath: absolute,
      ...(source.structuredFacts ? {structuredFacts: source.structuredFacts} : {})});
  }
  return {storeId: record.hallId, storeName: record.name, sources};
}
