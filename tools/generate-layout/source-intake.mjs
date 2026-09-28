import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeArtifact, normalizedFacts} from './normalize-source.mjs';

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value));
export const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export async function buildEvidenceBundle(manifest, {baseDir = process.cwd()} = {}) {
  if (!manifest || !idPattern.test(manifest.storeId) || !Array.isArray(manifest.sources) || !manifest.sources.length) {
    throw Error('storeId and at least one source are required');
  }
  const ids = new Set(), sources = [];
  for (const source of manifest.sources) {
    if (!source || !idPattern.test(source.sourceId) || ids.has(source.sourceId)) throw Error('Source IDs must be unique');
    ids.add(source.sourceId);
    if (typeof source.sourceType !== 'string' || !source.sourceType ||
      !(source.sourceUrl === null || source.sourceUrl === undefined || /^https:\/\//.test(source.sourceUrl)) ||
      !date(source.observedAt) || !date(source.retrievedAt) ||
      typeof source.floor !== 'string' || !idPattern.test(source.floor) ||
      !['slot', 'pachinko'].includes(source.category) || !source.rentalType || typeof source.rentalType !== 'string') {
      throw Error(`Invalid source metadata: ${source.sourceId}`);
    }
    if (source.pages !== undefined && source.pages !== null &&
      (!Array.isArray(source.pages) || !source.pages.length ||
        source.pages.some(page => !Number.isSafeInteger(page) || page < 1) || new Set(source.pages).size !== source.pages.length)) {
      throw Error(`Invalid PDF pages: ${source.sourceId}`);
    }
    let localArtifactPath = null, format = null, json = null, bytes = null;
    if (source.localArtifactPath) {
      if (typeof source.localArtifactPath !== 'string') throw Error('localArtifactPath must be text');
      localArtifactPath = path.resolve(baseDir, source.localArtifactPath);
      bytes = await fs.readFile(localArtifactPath);
      ({format, json} = normalizeArtifact(localArtifactPath, bytes));
      if (source.pages && format !== 'pdf') throw Error(`PDF pages specified for non-PDF source: ${source.sourceId}`);
    }
    const inputFacts = source.structuredFacts ?? json?.structuredFacts ?? (json?.seats ? json : {});
    const structuredFacts = normalizedFacts(inputFacts);
    const visionOutput = json?.visionOutput ?? null;
    const contentHash = hash(stable({artifactHash: bytes ? hash(bytes) : null, structuredFacts, visionOutput,
      sourceId: source.sourceId, sourceType: source.sourceType, sourceUrl: source.sourceUrl ?? null,
      observedAt: source.observedAt, floor: source.floor, category: source.category, rentalType: source.rentalType,
      pages: source.pages ?? null, usageReviewed: source.usageReviewed ?? null}));
    sources.push({storeId: manifest.storeId, sourceId: source.sourceId, sourceType: source.sourceType,
      sourceUrl: source.sourceUrl ?? null, observedAt: source.observedAt, retrievedAt: source.retrievedAt,
      floor: source.floor, category: source.category, rentalType: source.rentalType, contentHash,
      localArtifactPath, format, structuredFacts, visionOutput,
      pages: source.pages ?? null, usageReviewed: source.usageReviewed ?? null});
  }
  return {storeId: manifest.storeId, storeName: manifest.storeName ?? null, sources};
}
