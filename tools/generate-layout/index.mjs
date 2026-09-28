import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildEvidenceBundle, hash, stable} from './source-intake.mjs';
import {generateObservation} from './vision-generator.mjs';
import {reconcileEvidence} from './reconcile.mjs';
import {scoreConfidence} from './confidence.mjs';
import {toLayoutV3} from './schema-converter.mjs';
import {defaultDraftRoot, loadCached, writeDraft} from './draft-writer.mjs';
import {mockProvider} from './providers/mock.mjs';
import {validateLayout} from '../layout-validator.mjs';

export const GENERATOR_VERSION = 'goal5-v1';
const recoverable = new Set(['reference_number_missing', 'reference_number_extra', 'machine_count_mismatch']);
const summary = report => ({valid: report.valid, machineCount: report.machineCount ?? 0,
  errors: report.diagnostics.filter(item => item.severity === 'error').length,
  warnings: report.diagnostics.filter(item => item.severity === 'warning').length,
  codes: [...new Set(report.diagnostics.map(item => item.code))]});

export async function generateStore(manifest, {baseDir = process.cwd(), draftRoot = defaultDraftRoot,
  provider = mockProvider, generatorVersion = GENERATOR_VERSION, force = false} = {}) {
  const bundle = await buildEvidenceBundle(manifest, {baseDir});
  const cacheKey = hash(stable({version: generatorVersion, provider: provider.id, model: provider.model,
    storeId: bundle.storeId, storeName: bundle.storeName,
    sources: bundle.sources.map(source => ({hash: source.contentHash, floor: source.floor, category: source.category,
      rentalType: source.rentalType}))}));
  const cached = await loadCached(draftRoot, bundle.storeId, cacheKey);
  if (cached && !force) return cached;
  const audit = {generatorVersion, provider: provider.id, model: provider.model, generatedAt: new Date().toISOString(),
    sourceHashes: bundle.sources.map(source => ({sourceId: source.sourceId, contentHash: source.contentHash})),
    validationSummary: null, reasons: []};
  const finish = (status, layout = null) => writeDraft(draftRoot, bundle.storeId, cacheKey, {status, layout, audit});
  if (!bundle.sources.some(source => ['png', 'jpeg', 'pdf'].includes(source.format))) {
    audit.reasons.push('元フロアマップ画像/PDFがありません');
    return finish('insufficient_evidence');
  }
  let observation;
  try {observation = await generateObservation(bundle, provider);}
  catch (error) {
    audit.reasons.push(error.message);
    const invalidObservation = /AI output (schema|storeId|source reference)/.test(error.message);
    return finish(invalidObservation ? 'blocked' : 'insufficient_evidence');
  }
  const reconciliation = reconcileEvidence(bundle, observation);
  audit.observationSources = observation.floors.flatMap(floor => floor.islands.map(island =>
    ({floorId: floor.id, islandId: island.id, sourceIds: island.sourceIds})));
  audit.reasons.push(...reconciliation.blockers, ...reconciliation.issues);
  if (reconciliation.blockers.length) return finish('blocked');
  const layout = toLayoutV3(bundle, observation, reconciliation, provider, generatorVersion, audit.generatedAt);
  const references = [...new Set([...reconciliation.floors.values()].flatMap(floor => floor.referenceNumbers))];
  const report = validateLayout(layout, {referenceNumbers: references.length ? references : null});
  audit.validationSummary = summary(report);
  const critical = report.diagnostics.filter(item => item.severity === 'error' && !recoverable.has(item.code));
  if (critical.length) {audit.reasons.push(...critical.map(item => `${item.code}: ${item.message}`)); return finish('blocked');}
  const confidence = scoreConfidence(bundle, observation, reconciliation, report);
  layout.confidence = {overall: confidence.overall, geometry: confidence.geometry, count: confidence.count,
    number: confidence.number, position: confidence.position};
  // Null confidence fields are not allowed inside an object by layout v3.
  layout.confidence = Object.fromEntries(Object.entries(layout.confidence).filter(([,value]) => value !== null));
  audit.confidenceFactors = confidence.factors;
  if (report.diagnostics.length) {
    layout.verification.notes.push(...report.diagnostics.map(item => `${item.code}: ${item.message}`).slice(0, 200));
  }
  const status = reconciliation.issues.length || report.diagnostics.length ? 'needs_review' : 'generated';
  layout.verification.status = status;
  return finish(status, layout);
}

export async function generateBatch(manifest, options = {}) {
  const stores = Array.isArray(manifest) ? manifest : manifest?.stores;
  if (!Array.isArray(stores)) throw Error('Batch manifest must be an array or {stores: []}');
  const results = [];
  for (const store of stores) {
    try {
      const result = await generateStore(store, options);
      results.push({storeId: store?.storeId ?? null, status: result.status, cached: result.cached,
        layoutPath: result.layoutPath, reasons: result.audit.reasons});
    } catch (error) {results.push({storeId: store?.storeId ?? null, status: 'failed', cached: false, layoutPath: null, reasons: [error.message]});}
  }
  const counts = Object.fromEntries(['generated', 'needs_review', 'blocked', 'insufficient_evidence', 'failed'].map(status =>
    [status, results.filter(result => result.status === status).length]));
  return {counts, results};
}

const ownPath = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ownPath) {
  const file = process.argv[2];
  if (!file) {console.error('Usage: node tools/generate-layout/index.mjs batch-manifest.json'); process.exitCode = 2;}
  else {
    try {
      const manifestPath = path.resolve(file), input = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      console.log(JSON.stringify(await generateBatch(input, {baseDir: path.dirname(manifestPath)}), null, 2));
    } catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
