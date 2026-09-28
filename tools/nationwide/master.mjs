import fs from 'node:fs/promises';
import path from 'node:path';

export const hallIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const masterPath = root => path.join(root, 'work/nationwide/master.json');
const nameKey = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\u3000・･\-ー]/g, '');
const identity = hall => [nameKey(hall.name), nameKey(hall.prefecture), nameKey(hall.municipality), nameKey(hall.address)].join('|');
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const fileExists = file => fs.access(file).then(() => true, () => false);

export async function seedExisting(root) {
  const published = new Set((await readJSON(path.join(root, 'data/halls.json'))).halls.map(hall => hall.id));
  const hallsDir = path.join(root, 'halls');
  const ids = (await fs.readdir(hallsDir)).sort();
  const stores = {};
  for (const hallId of ids) {
    if (!hallIdPattern.test(hallId) || !await fileExists(path.join(hallsDir, hallId, 'index.html'))) continue;
    const hall = await readJSON(path.join(root, 'data', `${hallId}.json`));
    stores[hallId] = {
      hallId, name: hall.name, prefecture: hall.prefecture, municipality: hall.city,
      address: hall.address ?? null, slotSupported: true, status: 'existing',
      sourceInfo: hall.source ? [{sourceType: hall.source.name ?? 'legacy', sourceUrl: hall.source.url ?? null}] : [],
      sources: [], layoutProgress: published.has(hallId) ? 'published' : 'needs_review',
      lastVerifiedAt: null, lastUpdatedAt: hall.updated_at ?? null, published: published.has(hallId),
      generation: null, review: null, validation: null, history: []
    };
  }
  return {formatVersion: 1, stores};
}

export async function loadMaster(root) {
  const file = masterPath(root);
  return await fileExists(file) ? readJSON(file) : seedExisting(root);
}

export async function saveMaster(root, master) {
  const target = masterPath(root);
  await fs.mkdir(path.dirname(target), {recursive: true});
  const temp = `${target}.${process.pid}.tmp`;
  try {await fs.writeFile(temp, `${JSON.stringify(master, null, 2)}\n`, {flag: 'wx'}); await fs.rename(temp, target);}
  finally {await fs.rm(temp, {force: true}).catch(() => {});}
}

export function registerHall(master, input) {
  const hallId = input?.hallId;
  if (!hallIdPattern.test(hallId ?? '')) throw Error('hallId must be URL/file-safe lowercase ASCII');
  if (master.stores[hallId]) throw Error(`hallId already exists: ${hallId}`);
  for (const key of ['name', 'prefecture', 'municipality']) if (typeof input[key] !== 'string' || !input[key].trim()) throw Error(`${key} is required`);
  if (typeof input.slotSupported !== 'boolean') throw Error('slotSupported must be boolean');
  if (input.address !== undefined && input.address !== null && typeof input.address !== 'string') throw Error('address must be text or null');
  const proposed = {...input, address: input.address ?? null};
  if (Object.values(master.stores).some(hall => identity(hall) === identity(proposed) ||
    hall.address && proposed.address && nameKey(hall.prefecture) === nameKey(proposed.prefecture) &&
    nameKey(hall.address) === nameKey(proposed.address) && nameKey(hall.name) === nameKey(proposed.name))) {
    throw Error('Possible duplicate store identity');
  }
  const record = {hallId, name: input.name.trim(), prefecture: input.prefecture.trim(), municipality: input.municipality.trim(),
    address: proposed.address, slotSupported: input.slotSupported, status: 'registered', sourceInfo: [], sources: [],
    layoutProgress: 'source_needed', lastVerifiedAt: null, published: false,
    lastUpdatedAt: new Date().toISOString(),
    generation: null, review: null, validation: null, history: [{state: 'source_needed', at: new Date().toISOString(), reason: 'registered'}]};
  master.stores[hallId] = record;
  return record;
}

const next = {
  source_needed: ['source_ready', 'blocked'],
  source_ready: ['generated', 'needs_review', 'blocked'],
  generated: ['validated', 'needs_review', 'blocked'],
  needs_review: ['generated', 'validated', 'blocked'],
  validated: ['generated', 'human_verified', 'needs_review', 'blocked'],
  human_verified: ['approved_for_promotion', 'needs_review', 'blocked'],
  approved_for_promotion: ['promoted', 'needs_review', 'blocked'],
  promoted: ['ready_to_publish', 'blocked'], ready_to_publish: ['published', 'blocked'],
  blocked: ['source_needed', 'source_ready', 'needs_review'], published: []
};

export function transition(record, target, reason, at = new Date().toISOString()) {
  if (!next[record.layoutProgress]?.includes(target)) throw Error(`Forbidden state transition: ${record.layoutProgress} -> ${target}`);
  if (!reason || typeof reason !== 'string') throw Error('Transition reason is required');
  record.layoutProgress = target;
  record.history.push({state: target, at, reason});
  return record;
}
