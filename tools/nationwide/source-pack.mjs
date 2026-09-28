import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeArtifact} from '../generate-layout/normalize-source.mjs';
import {hallIdPattern} from './master.mjs';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exists = file => fs.access(file).then(() => true, () => false);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const checksumPattern = /^[a-f0-9]{64}$/;
const id = value => hallIdPattern.test(value ?? '');
export const packDirectory = (root, hallId) => {
  if (!id(hallId)) throw Error('Invalid hallId');
  return path.join(root, 'work/nationwide/sources', hallId);
};
const manifestPath = (root, hallId) => path.join(packDirectory(root, hallId), 'manifest.json');

export async function createSourceTemplate(root, hallId, {dryRun = false} = {}) {
  const directory = packDirectory(root, hallId), manifestFile = manifestPath(root, hallId);
  if (await exists(manifestFile)) return {status: 'exists', directory, manifestPath: manifestFile};
  const manifest = {formatVersion: 1, hallId, createdAt: new Date().toISOString(),
    sources: [{sourceId: 'floor-map', sourceType: null, sourceUrl: null,
      observedAt: null, importedAt: null, usageReviewed: false, usageReviewedAt: null,
      usageNote: '', sourceOwner: null, floor: 'slot-floor', category: 'slot', rentalType: null,
      pages: null, localFiles: [{path: 'floor-map.png', checksum: null}]}]};
  if (!dryRun) {
    await fs.mkdir(directory, {recursive: true});
    await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
    const notes = path.join(directory, 'notes.md');
    if (!await exists(notes)) await fs.writeFile(notes,
      '# Source review notes\n\nRecord permission, scope, and evidence for each source here. Do not set usageReviewed=true until a person has checked it.\n', {flag: 'wx'});
  }
  return {status: dryRun ? 'would_create' : 'created', directory, manifestPath: manifestFile};
}

export async function readSourcePack(root, hallId) {
  const file = manifestPath(root, hallId);
  if (!await exists(file)) return null;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function inspectFile(directory, entry, sourceId, issues, {requireChecksum = true} = {}) {
  if (!entry || typeof entry.path !== 'string' || !entry.path || path.isAbsolute(entry.path) ||
    entry.path.split(/[\\/]/).includes('..')) {
    issues.push(`${sourceId}: unsafe or missing local file path`); return null;
  }
  const absolute = path.resolve(directory, entry.path);
  if (!absolute.startsWith(path.resolve(directory) + path.sep)) {
    issues.push(`${sourceId}: local file leaves Source Pack`); return null;
  }
  if (!await exists(absolute)) {issues.push(`${sourceId}: local file missing: ${entry.path}`); return null;}
  const real = await fs.realpath(absolute);
  if (!real.startsWith(path.resolve(directory) + path.sep)) {
    issues.push(`${sourceId}: local file symlink leaves Source Pack`); return null;
  }
  const bytes = await fs.readFile(real), checksum = sha256(bytes);
  let format;
  try {format = normalizeArtifact(real, bytes).format;}
  catch (error) {issues.push(`${sourceId}: ${error.message}`); return null;}
  if (requireChecksum && (!checksumPattern.test(entry.checksum ?? '') || entry.checksum !== checksum)) {
    issues.push(`${sourceId}: checksum missing or mismatch`);
  }
  return {absolute: real, checksum, format};
}

export async function inspectSourcePack(root, hallId, {allowUnreviewed = false, requireChecksum = true} = {}) {
  const directory = packDirectory(root, hallId);
  let manifest;
  try {manifest = await readSourcePack(root, hallId);}
  catch (error) {return {hallId, status: 'blocked', reasons: [`Source Pack manifest invalid: ${error.message}`], manifest: null, sources: []};}
  if (!manifest) return {hallId, status: 'source_needed', reasons: ['Source Pack manifest missing'], manifest: null, sources: []};
  const issues = [], sourceFiles = [];
  if (manifest.formatVersion !== 1) issues.push('Unsupported Source Pack format');
  if (manifest.hallId !== hallId) issues.push('hallId mismatch');
  if (!Array.isArray(manifest.sources) || !manifest.sources.length) issues.push('sources list missing');
  const seen = new Set();
  for (const source of Array.isArray(manifest.sources) ? manifest.sources : []) {
    const sid = source?.sourceId ?? '(unknown)';
    if (!id(sid) || seen.has(sid)) issues.push(`${sid}: sourceId invalid or duplicate`);
    seen.add(sid);
    if (typeof source?.sourceType !== 'string' || !source.sourceType.trim()) issues.push(`${sid}: sourceType missing`);
    if (source?.sourceUrl !== null && source?.sourceUrl !== undefined &&
      (typeof source.sourceUrl !== 'string' || !/^https:\/\//.test(source.sourceUrl))) issues.push(`${sid}: sourceUrl invalid`);
    if (!source?.observedAt) issues.push(`${sid}: observedAt missing`);
    else if (!validDate(source.observedAt)) issues.push(`${sid}: observedAt invalid`);
    if (!source?.importedAt) issues.push(`${sid}: importedAt missing`);
    else if (!validDate(source.importedAt)) issues.push(`${sid}: importedAt invalid`);
    if (!id(source?.floor) || !['slot', 'pachinko'].includes(source?.category) ||
      typeof source?.rentalType !== 'string' || !source.rentalType.trim()) issues.push(`${sid}: floor/category/rentalType missing`);
    if (typeof source?.sourceOwner !== 'string' || !source.sourceOwner.trim()) issues.push(`${sid}: sourceOwner missing`);
    if (source?.usageReviewed !== true && !allowUnreviewed) issues.push(`${sid}: usage review missing`);
    if (source?.usageReviewed === true && (!validDate(source.usageReviewedAt) || !source.usageNote?.trim())) {
      issues.push(`${sid}: usageReviewedAt or usageNote missing`);
    }
    if (!Array.isArray(source?.localFiles) || source.localFiles.length !== 1) {
      issues.push(`${sid}: exactly one artifact per source entry is required`); continue;
    }
    let file = null;
    try {file = await inspectFile(directory, source.localFiles[0], sid, issues, {requireChecksum});}
    catch (error) {issues.push(`${sid}: local file invalid: ${error.message}`);}
    if (source.pages !== undefined && source.pages !== null &&
      (!Array.isArray(source.pages) || !source.pages.length || source.pages.some(page => !Number.isSafeInteger(page) || page < 1) ||
        new Set(source.pages).size !== source.pages.length || file?.format !== 'pdf')) issues.push(`${sid}: invalid PDF pages`);
    if (file) sourceFiles.push({source, ...file});
  }
  if (!sourceFiles.some(item => ['png', 'jpeg', 'pdf'].includes(item.format))) issues.push('floor map evidence missing');
  const status = !issues.length ? 'source_ready' : issues.some(reason =>
    /mismatch|invalid|unsafe|symlink|duplicate|leaves|Unsupported|checksum|exactly one/i.test(reason))
    ? 'blocked' : 'source_needed';
  return {hallId, status, reasons: issues, manifest, sources: sourceFiles, directory};
}

export async function sealSourcePack(root, hallId, {dryRun = true} = {}) {
  const manifest = await readSourcePack(root, hallId);
  if (!manifest) throw Error('Source Pack manifest missing');
  if (manifest.hallId !== hallId || !Array.isArray(manifest.sources)) throw Error('Invalid Source Pack manifest');
  const directory = packDirectory(root, hallId), changes = [];
  for (const source of manifest.sources) {
    if (!Array.isArray(source.localFiles) || source.localFiles.length !== 1) throw Error('Each source needs one local file');
    const issues = [];
    const file = await inspectFile(directory, source.localFiles[0], source.sourceId, issues, {requireChecksum: false});
    if (issues.length) throw Error(issues.join('; '));
    if (source.localFiles[0].checksum !== file.checksum) {
      changes.push({sourceId: source.sourceId, checksum: file.checksum});
      if (!dryRun) source.localFiles[0].checksum = file.checksum;
    }
  }
  if (!dryRun && changes.length) {
    const target = manifestPath(root, hallId), temp = `${target}.${process.pid}.tmp`;
    try {await fs.writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'}); await fs.rename(temp, target);}
    finally {await fs.rm(temp, {force: true}).catch(() => {});}
  }
  return {hallId, dryRun, changes, usageReviewUnchanged: true};
}
