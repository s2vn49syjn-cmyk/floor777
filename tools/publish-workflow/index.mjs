import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkLayoutSchema} from './schema-check.mjs';
import {validateLayout} from '../layout-validator.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = async file => fs.access(file).then(() => true, () => false);
const machines = layout => layout.floors.flatMap(floor => [...floor.unassignedMachines, ...floor.islands.flatMap(island => island.machines)]);
const now = () => new Date().toISOString();
const requiredText = (value, name) => {if (typeof value !== 'string' || !value.trim()) throw Error(`${name} is required`); return value.trim();};
const dateText = (value, name) => {requiredText(value, name); if (!Number.isFinite(Date.parse(value))) throw Error(`${name} must be a date`); return value;};
const ensureId = value => {if (!idPattern.test(value ?? '')) throw Error('Explicit valid storeId is required'); return value;};
const paths = (root, storeId) => ({
  index: path.join(root, 'work/publish-state/index.json'),
  candidates: path.join(root, 'work/publish-staging', storeId),
  backups: path.join(root, 'work/publish-state/backups', storeId),
  publicLayout: path.join(root, 'data/layouts', `${storeId}.json`),
  hall: path.join(root, 'data', `${storeId}.json`),
  halls: path.join(root, 'data/halls.json'),
  page: path.join(root, 'halls', storeId, 'index.html'),
  pageMeta: path.join(root, 'tools/hall-page-meta.json')
});
async function atomic(file, content) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {await fs.writeFile(temp, content, {flag: 'wx'}); await fs.rename(temp, file);}
  finally {await fs.rm(temp, {force: true}).catch(() => {});}
}
const writeJSON = (file, value) => atomic(file, `${JSON.stringify(value, null, 2)}\n`);
const readIndex = async file => await exists(file) ? readJSON(file) :
  {formatVersion: 1, drafts: {}, reviewedDrafts: {}, stores: {}};
const storeRecord = (index, id) => index.stores[id] ?? {versions: {}, publishedVersion: null, events: []};
const versionOf = record => `v${String(Math.max(0, ...Object.keys(record.versions).map(v => Number(v.slice(1)) || 0)) + 1).padStart(4, '0')}`;
const latestActive = record => Object.keys(record.versions).filter(v => record.versions[v].state !== 'rolled_back').at(-1) ?? null;
const candidateFiles = (p, version) => ({layout: path.join(p.candidates, version, 'layout.json'),
  metadata: path.join(p.candidates, version, 'metadata.json')});
const compare = (from, to) => {
  const a = from ? machines(from) : [], b = machines(to);
  const byNumber = list => new Map(list.filter(m => m.number !== null).map(m => [m.number, m]));
  const old = byNumber(a), next = byNumber(b);
  const changed = [...next].filter(([number, m]) => old.has(number) && JSON.stringify(old.get(number).position) !== JSON.stringify(m.position)).length;
  const oldIslands = new Map((from?.floors ?? []).flatMap(f => f.islands.map(i => [`${f.id}:${i.id}`, i])));
  const geometryChanges = to.floors.flatMap(f => f.islands.map(i => ({floorId: f.id, islandId: i.id,
    changed: !oldIslands.has(`${f.id}:${i.id}`) || JSON.stringify(oldIslands.get(`${f.id}:${i.id}`).geometry) !== JSON.stringify(i.geometry) ||
      oldIslands.get(`${f.id}:${i.id}`).shape !== i.shape}))).filter(i => i.changed);
  return {storeId: to.storeId, floors: to.floors.map(floor => ({floorId: floor.id, category: floor.label?.split('/')[0]?.trim() ?? null,
    rentalType: floor.label?.split('/')[1]?.trim() ?? null, islandCount: floor.islands.length,
    seatCount: floor.unassignedMachines.length + floor.islands.reduce((n, island) => n + island.machines.length, 0)})),
    previousSeatCount: a.length, seatCount: b.length,
    removedNumbers: [...old.keys()].filter(n => !next.has(n)).sort((x, y) => x - y),
    addedNumbers: [...next.keys()].filter(n => !old.has(n)).sort((x, y) => x - y),
    movedSeats: changed, changedIslandGeometry: geometryChanges.map(({floorId, islandId}) => ({floorId, islandId})),
    changedIslandCount: to.floors.reduce((n, f) => n + f.islands.length, 0) - (from?.floors.reduce((n, f) => n + f.islands.length, 0) ?? 0)};
};
function validateCandidate(layout, acceptedWarnings = []) {
  const schema = checkLayoutSchema(layout);
  if (!schema.valid) return {valid: false, errors: schema.errors, warnings: []};
  if (!Array.isArray(acceptedWarnings) || acceptedWarnings.some(code => typeof code !== 'string')) {
    return {valid: false, errors: ['acceptWarnings must be a list of diagnostic codes'], warnings: []};
  }
  const validation = validateLayout(layout);
  const warnings = validation.diagnostics.filter(d => d.severity === 'warning');
  const unacceptable = warnings.filter(d => d.code === 'number_missing' || !acceptedWarnings.includes(d.code));
  const errors = [...schema.errors, ...validation.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code}: ${d.message}`),
    ...unacceptable.map(d => `${d.code}: warning needs explicit acceptance`),
    ...machines(layout).filter(m => m.number === null).map(m => `${m.id}: number is unknown`)];
  return {valid: !errors.length, errors, warnings};
}
async function publicPrerequisites(root, id, layout) {
  const p = paths(root, id), issues = [];
  if (layout.floors.length !== 1) issues.push('Multiple floors are not supported by the public UI');
  if (!await exists(p.hall)) issues.push('Hall data file is missing');
  if (!await exists(p.page)) issues.push('Hall page is missing');
  let hall = null, pageMeta = null, positionFile = null;
  if (await exists(p.hall)) {
    hall = await readJSON(p.hall);
    if (hall.id !== id || !Array.isArray(hall.seats) || hall.seat_count !== hall.seats.length) issues.push('Hall data is invalid');
    else {
      const hallNumbers = hall.seats.map(seat => seat.seat).sort((a, b) => a - b);
      const layoutNumbers = machines(layout).map(m => m.number).sort((a, b) => a - b);
      if (JSON.stringify(hallNumbers) !== JSON.stringify(layoutNumbers)) issues.push('Hall seat-number set differs from layout');
    }
    for (const key of ['name', 'prefecture', 'city', 'updated_at']) if (!hall?.[key]) issues.push(`Hall ${key} is missing`);
    if (/draft|unverified/i.test(hall?.layout_status ?? '')) issues.push('Hall data still declares an unverified draft');
  }
  if (await exists(p.pageMeta)) {
    pageMeta = (await readJSON(p.pageMeta))[id];
    if (!pageMeta) issues.push('Hall page metadata is missing');
    else {
      if (/noindex/i.test(pageMeta.robotsMeta ?? '')) issues.push('Hall page is marked noindex; publication needs an explicit page review');
      positionFile = path.join(root, 'data', pageMeta.positionFile ?? `positions-${id}.json`);
      if (!path.resolve(positionFile).startsWith(path.resolve(root, 'data') + path.sep)) issues.push('Unsafe position filename');
      else if (!await exists(positionFile)) issues.push('Position file is missing');
    }
  } else issues.push('Hall page metadata file is missing');
  if (await exists(p.page) && /<meta\s+[^>]*name=["']robots["'][^>]*noindex/i.test(await fs.readFile(p.page, 'utf8'))) {
    issues.push('Hall page HTML is marked noindex');
  }
  if (!await exists(p.halls)) issues.push('Public hall listing is missing');
  const map = Object.fromEntries(machines(layout).map(m => [String(m.number), m.position]));
  return {issues, hall, positionFile, positions: map};
}

async function performPromotionAction(action, input, {root = repoRoot, dryRun = true, confirm = false} = {}) {
  if (!['promote', 'stage', 'publish', 'rollback'].includes(action)) throw Error('Unknown action');
  const id = ensureId(input?.storeId), p = paths(root, id);
  const index = await readIndex(p.index), record = storeRecord(index, id);
  const result = {action, storeId: id, dryRun, status: 'blocked', version: null, report: null, reasons: []};
  if (action === 'promote') {
    const draftPath = path.resolve(requiredText(input.draftPath, 'draftPath'));
    const publicData = path.resolve(root, 'data');
    if (!draftPath.toLowerCase().endsWith('.json') || draftPath.startsWith(publicData + path.sep)) {
      throw Error('A review draft JSON outside public data is required');
    }
    const raw = await fs.readFile(draftPath), layout = JSON.parse(raw.toString('utf8'));
    if (layout.storeId !== id) throw Error('Draft storeId mismatch');
    const reviewer = requiredText(input.reviewer, 'reviewer'), reviewedAt = dateText(input.reviewedAt, 'reviewedAt');
    const approvalNote = requiredText(input.approvalNote, 'approvalNote');
    const sourceSummary = requiredText(input.sourceSummary, 'sourceSummary');
    const promoteReason = requiredText(input.promoteReason, 'promoteReason');
    if (!['slot', 'pachinko'].includes(input.category)) throw Error('category must be slot or pachinko');
    const rentalType = requiredText(input.rentalType, 'rentalType');
    if (!input.sourcePolicyReviewed || !input.manualApprovalChecked) result.reasons.push('Source policy and manual approval must be checked');
    if (!(layout.review?.humanModified || layout.verification?.status === 'verified')) result.reasons.push('Draft has no human review marker');
    if (!layout.provenance?.sourceType || !layout.provenance?.sourceHash) result.reasons.push('Source provenance is incomplete');
    if (layout.generation?.source === 'ai' && (!input.provider || !input.model)) result.reasons.push('AI provider and model must be recorded');
    if (input.sourceHashes !== undefined && (!Array.isArray(input.sourceHashes) ||
      input.sourceHashes.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) ||
      !input.sourceHashes.includes(layout.provenance?.sourceHash))) result.reasons.push('Source hashes must include the draft provenance hash');
    const checked = validateCandidate(layout, input.acceptWarnings ?? []);
    result.reasons.push(...checked.errors);
    const priorVersion = latestActive(record);
    const prior = priorVersion ? await readJSON(candidateFiles(p, priorVersion).layout) : await exists(p.publicLayout) ? await readJSON(p.publicLayout) : null;
    result.report = {...(checkLayoutSchema(layout).valid ? compare(prior, layout) : {storeId: id}), category: input.category,
      rentalType, validatorWarnings: checked.warnings,
      provenance: layout.provenance, reviewNote: approvalNote, sourceSummary, priorVersion};
    result.version = versionOf(record);
    if (result.reasons.length) return result;
    result.status = dryRun ? 'ready' : 'success';
    if (dryRun) return result;
    const at = now(), file = candidateFiles(p, result.version);
    const metadata = {storeId: id, layoutVersion: result.version, state: 'promoted', reviewState: 'reviewed',
      approvalState: 'approved_for_promotion', category: input.category, rentalType,
      createdAt: layout.generation?.generatedAt ?? at,
      updatedAt: at, reviewedBy: reviewer, reviewedAt, reviewNote: approvalNote, promotedBy: requiredText(input.promotedBy ?? reviewer, 'promotedBy'),
      promotedAt: at, promotionNote: promoteReason, sourceSummary, sourcePolicyReviewed: true, manualApprovalChecked: true,
      draftId: sha(raw), promotedFrom: draftPath, previousVersion: priorVersion,
      generatorVersion: layout.generation?.version ?? null, provider: input.provider ?? null, model: input.model ?? null,
      sourceHashes: input.sourceHashes ?? [layout.provenance.sourceHash], acceptedWarnings: input.acceptWarnings ?? [],
      publishBy: null, publishedAt: null, publishedFrom: null, rollbackOf: null};
    await writeJSON(file.layout, layout); await writeJSON(file.metadata, metadata);
    index.drafts ??= {}; index.reviewedDrafts ??= {};
    index.drafts[metadata.draftId] = {storeId: id, path: draftPath, source: layout.generation?.source ?? null};
    index.reviewedDrafts[metadata.draftId] = {storeId: id, reviewer, reviewedAt, version: result.version};
    record.versions[result.version] = metadata;
    record.events.push({action: 'promote', version: result.version, at});
  } else if (action === 'stage' || action === 'publish') {
    const version = input.layoutVersion ?? latestActive(record);
    if (!version || !record.versions[version]) {result.reasons.push('Promoted version does not exist'); return result;}
    const file = candidateFiles(p, version), layout = await readJSON(file.layout), metadata = record.versions[version];
    result.version = version;
    const checked = validateCandidate(layout, metadata.acceptedWarnings);
    result.reasons.push(...checked.errors);
    if (metadata.category !== 'slot') result.reasons.push('Public FloorMap currently supports slot layouts only');
    const prereq = await publicPrerequisites(root, id, layout);
    result.reasons.push(...prereq.issues);
    if (!metadata.sourcePolicyReviewed || !metadata.manualApprovalChecked) result.reasons.push('Source rights/manual approval not recorded');
    const old = await exists(p.publicLayout) ? await readJSON(p.publicLayout) : null;
    result.report = {...compare(old, layout), category: metadata.category, rentalType: metadata.rentalType,
      validatorWarnings: checked.warnings, provenance: layout.provenance,
      reviewNote: metadata.reviewNote, sourceSummary: metadata.sourceSummary,
      files: [p.publicLayout, prereq.positionFile, p.halls, p.page].filter(Boolean), previousVersion: record.publishedVersion};
    if (action === 'stage' && !['promoted', 'ready_to_publish'].includes(metadata.state)) result.reasons.push('Only an active promoted candidate can be staged');
    if (action === 'publish' && metadata.state !== 'ready_to_publish') result.reasons.push('Version must be staged first');
    if (action === 'publish' && !dryRun && !confirm) result.reasons.push('Explicit --confirm is required');
    if (action === 'publish') requiredText(input.publishedBy, 'publishedBy');
    if (result.reasons.length) return result;
    result.status = dryRun ? 'ready' : 'success';
    if (dryRun) return result;
    const at = now();
    if (action === 'stage') {
      metadata.state = 'ready_to_publish'; metadata.stagedAt = at; metadata.updatedAt = at;
      await writeJSON(file.metadata, metadata);
    } else {
      const halls = await readJSON(p.halls), oldEntry = halls.halls.find(h => h.id === id) ?? null;
      const oldLayout = await exists(p.publicLayout) ? await fs.readFile(p.publicLayout) : null;
      const oldPositions = await exists(prereq.positionFile) ? await fs.readFile(prereq.positionFile) : null;
      const backup = path.join(p.backups, version);
      await fs.mkdir(backup, {recursive: true});
      if (oldLayout) await fs.writeFile(path.join(backup, 'layout.json'), oldLayout);
      if (oldPositions) await fs.writeFile(path.join(backup, 'positions.json'), oldPositions);
      const entry = oldEntry ?? {id, name: prereq.hall.name, prefecture: prereq.hall.prefecture, city: prereq.hall.city,
        category: 'スロット', seat_count: prereq.hall.seat_count, updated_at: prereq.hall.updated_at,
        path: `halls/${id}/`, status: 'published', features: ['島図', '台番号検索'], machine_updated_at: null};
      halls.halls = [...halls.halls.filter(h => h.id !== id), {...entry, seat_count: prereq.hall.seat_count, status: 'published'}];
      const publishedEntry = halls.halls.find(h => h.id === id);
      await writeJSON(path.join(backup, 'manifest.json'), {oldEntry, hadLayout: !!oldLayout, hadPositions: !!oldPositions,
        positionFile: prereq.positionFile, previousVersion: record.publishedVersion, publishedVersion: version,
        publishedLayoutHash: sha(JSON.stringify(layout)), publishedPositionsHash: sha(JSON.stringify(prereq.positions)),
        publishedEntryHash: sha(JSON.stringify(publishedEntry))});
      const previousMetadata = structuredClone(metadata);
      try {
        await writeJSON(p.publicLayout, layout);
        await writeJSON(prereq.positionFile, prereq.positions);
        await writeJSON(p.halls, halls);
        metadata.state = 'published'; metadata.publishBy = input.publishedBy; metadata.publishedAt = at;
        metadata.publishedFrom = version; metadata.updatedAt = at;
        record.publishedVersion = version;
        await writeJSON(file.metadata, metadata);
        await writeJSON(p.index, {...index, stores: {...index.stores, [id]: record}});
      } catch (error) {
        if (oldLayout) await atomic(p.publicLayout, oldLayout); else await fs.rm(p.publicLayout, {force: true});
        if (oldPositions) await atomic(prereq.positionFile, oldPositions);
        halls.halls = [...halls.halls.filter(h => h.id !== id), ...(oldEntry ? [oldEntry] : [])];
        await writeJSON(p.halls, halls); await writeJSON(file.metadata, previousMetadata);
        throw error;
      }
    }
    record.events.push({action, version, at});
  } else {
    if (input.scope === 'promotion') {
      const version = input.layoutVersion ?? latestActive(record);
      if (!version || !record.versions[version] || record.publishedVersion === version ||
        record.versions[version].state === 'rolled_back') {
        result.reasons.push('Only an unpublished active candidate can have promotion rolled back'); return result;
      }
      requiredText(input.rollbackBy, 'rollbackBy');
      if (!dryRun && !confirm) result.reasons.push('Explicit --confirm is required');
      result.version = version; result.report = {rollbackOf: version, restoreVersion: record.versions[version].previousVersion,
        publicFilesChanged: false};
      if (result.reasons.length) return result;
      result.status = dryRun ? 'ready' : 'success';
      if (dryRun) return result;
      const metadata = record.versions[version];
      metadata.state = 'rolled_back'; metadata.rollbackOf = version; metadata.rolledBackAt = now();
      metadata.rolledBackBy = input.rollbackBy; metadata.updatedAt = metadata.rolledBackAt;
      record.events.push({action: 'rollback-promotion', version, at: metadata.rolledBackAt});
      await writeJSON(candidateFiles(p, version).metadata, metadata);
      index.stores[id] = record; await writeJSON(p.index, index);
      return result;
    }
    const version = input.layoutVersion ?? record.publishedVersion;
    if (!version || record.publishedVersion !== version) {result.reasons.push('Only the current published version can be rolled back'); return result;}
    if (!dryRun && !confirm) result.reasons.push('Explicit --confirm is required');
    requiredText(input.rollbackBy, 'rollbackBy');
    const backup = path.join(p.backups, version), manifestFile = path.join(backup, 'manifest.json');
    if (!await exists(manifestFile)) {result.reasons.push('Rollback backup is missing'); return result;}
    const prior = await readJSON(manifestFile);
    result.version = version; result.report = {rollbackOf: version, restoreVersion: prior.previousVersion,
      files: [p.publicLayout, prior.positionFile, p.halls]};
    const currentLayout = await readJSON(p.publicLayout), currentPositions = await readJSON(prior.positionFile);
    const currentHalls = await readJSON(p.halls), currentEntry = currentHalls.halls.find(h => h.id === id);
    if (sha(JSON.stringify(currentLayout)) !== prior.publishedLayoutHash ||
      sha(JSON.stringify(currentPositions)) !== prior.publishedPositionsHash ||
      sha(JSON.stringify(currentEntry)) !== prior.publishedEntryHash) {
      result.reasons.push('Published files changed after this version; manual review is required before rollback');
    }
    if (result.reasons.length) return result;
    result.status = dryRun ? 'ready' : 'success';
    if (dryRun) return result;
    const oldLayout = await fs.readFile(p.publicLayout), oldPositions = await fs.readFile(prior.positionFile), oldHalls = await readJSON(p.halls);
    const halls = structuredClone(oldHalls);
    halls.halls = [...halls.halls.filter(h => h.id !== id), ...(prior.oldEntry ? [prior.oldEntry] : [])];
    try {
      if (prior.hadLayout) await atomic(p.publicLayout, await fs.readFile(path.join(backup, 'layout.json')));
      else await fs.rm(p.publicLayout, {force: true});
      if (prior.hadPositions) await atomic(prior.positionFile, await fs.readFile(path.join(backup, 'positions.json')));
      await writeJSON(p.halls, halls);
      record.publishedVersion = prior.previousVersion;
      record.versions[version].state = 'rolled_back'; record.versions[version].rollbackOf = version;
      record.versions[version].rolledBackAt = now(); record.versions[version].rolledBackBy = input.rollbackBy;
      record.events.push({action, version, at: now()});
      await writeJSON(p.index, {...index, stores: {...index.stores, [id]: record}});
      await writeJSON(candidateFiles(p, version).metadata, record.versions[version]);
      return result;
    } catch (error) {
      await atomic(p.publicLayout, oldLayout); await atomic(prior.positionFile, oldPositions); await writeJSON(p.halls, oldHalls);
      throw error;
    }
  }
  index.stores[id] = record;
  await writeJSON(p.index, index);
  return result;
}

export async function runPromotionAction(action, input, options = {}) {
  if (options.dryRun !== false) return performPromotionAction(action, input, options);
  const root = options.root ?? repoRoot;
  const dir = path.join(root, 'work/publish-state');
  await fs.mkdir(dir, {recursive: true});
  const lock = path.join(dir, '.lock');
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('Another promotion/publish operation is running; inspect the lock before retrying');
    throw error;
  }
  try {return await performPromotionAction(action, input, options);}
  finally {await handle.close(); await fs.rm(lock, {force: true});}
}

export async function runPromotionBatch(entries, options = {}) {
  if (!Array.isArray(entries)) throw Error('Batch manifest must be an array');
  const results = [];
  for (const entry of entries) {
    try {results.push(await runPromotionAction(entry.action, entry, {...options, confirm: options.confirm || entry.confirm === true}));}
    catch (error) {results.push({action: entry.action, storeId: entry.storeId ?? null, status: 'failed', reasons: [error.message]});}
  }
  return {counts: Object.fromEntries(['success', 'ready', 'blocked', 'failed', 'skipped'].map(status =>
    [status, results.filter(item => item.status === status).length])), results};
}

export async function getPromotionIndex({root = repoRoot} = {}) {
  return readIndex(path.join(root, 'work/publish-state/index.json'));
}
