import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const defaultDraftRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../work/layout-drafts');
function storeDir(root, storeId) {
  const resolved = path.resolve(root);
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/layouts');
  if (resolved === publicDir || resolved.startsWith(publicDir + path.sep)) throw Error('AI drafts cannot be written to data/layouts');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(storeId)) throw Error('Invalid storeId for draft path');
  return path.join(resolved, storeId);
}
const paths = (root, storeId, cacheKey) => {
  const dir = storeDir(root, storeId);
  return {dir, layoutPath: path.join(dir, `${cacheKey}.json`), metaPath: path.join(dir, `${cacheKey}.meta.json`)};
};
async function atomicJSON(file, value) {
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: 'wx'}); await fs.rename(temporary, file);}
  finally {await fs.rm(temporary, {force: true}).catch(() => {});}
}

export async function loadCached(root, storeId, cacheKey) {
  const {layoutPath, metaPath} = paths(root, storeId, cacheKey);
  try {
    const audit = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    const layout = audit.hasLayout ? JSON.parse(await fs.readFile(layoutPath, 'utf8')) : null;
    if (audit.cacheKey !== cacheKey || audit.storeId !== storeId || layout?.storeId !== storeId && audit.hasLayout) return null;
    return {status: audit.status, layout, audit, layoutPath: audit.hasLayout ? layoutPath : null, cached: true};
  } catch {return null;}
}

export async function writeDraft(root, storeId, cacheKey, {status, layout, audit}) {
  const {dir, layoutPath, metaPath} = paths(root, storeId, cacheKey);
  await fs.mkdir(dir, {recursive: true});
  if (layout) await atomicJSON(layoutPath, layout);
  const metadata = {...audit, storeId, cacheKey, status, hasLayout: !!layout};
  await atomicJSON(metaPath, metadata);
  return {status, layout, audit: metadata, layoutPath: layout ? layoutPath : null, cached: false};
}
