import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadMaster} from './master.mjs';
import {createSourceTemplate, readSourcePack, packDirectory} from './source-pack.mjs';

const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'source-candidates.json');
const allowedHost = host => host === 'p-world.co.jp' || host === 'www.p-world.co.jp' || host.endsWith('.p-world.co.jp');
const maxHtmlBytes = 2 * 1024 * 1024;
const maxImageBytes = 8 * 1024 * 1024;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => new Date().toISOString().slice(0, 10);
const attr = (tag, name) => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] ?? '' : '';
};
const absoluteUrl = (raw, base) => {
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' && allowedHost(url.hostname) ? url.href : null;
  } catch {return null;}
};
const imageDimensions = (bytes, format) => {
  if (format === 'png') return bytes.length >= 24 ? {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)} : null;
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) return {height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7)};
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(i + 2);
    if (length < 2) break;
    i += 2 + length;
  }
  return null;
};
const imageFormat = bytes => {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  return null;
};
const strip = html => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
const rentalTypeFromHtml = html => {
  const text = strip(html);
  const section = text.match(/パチスロ\s*[：:]?\s*((?:\[[^\]]+\]\s*){1,5})/i)?.[1] ?? '';
  const rates = [...section.matchAll(/\[([^\]]+)\]/g)].map(match => match[1].trim()).filter(Boolean);
  return new Set(rates).size === 1 ? rates[0] : 'mixed-slot';
};

async function request(url, transport, {timeoutMs = 15000, binary = false} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await transport(url, {signal: controller.signal,
      headers: {'User-Agent': 'FLOOR777-source-collector/1.0 (+floor777.contact@gmail.com)'}});
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const raw = Buffer.from(await response.arrayBuffer());
    const limit = binary ? maxImageBytes : maxHtmlBytes;
    if (!raw.length || raw.length > limit) throw Error(binary ? 'image size limit' : 'HTML size limit');
    return raw;
  } finally {clearTimeout(timer);}
}

export function floorMapCandidates(html, pageUrl) {
  const candidates = [];
  const imagePattern = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imagePattern)) {
    const tag = match[0], src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-original');
    if (!src) continue;
    const url = absoluteUrl(src, pageUrl);
    if (!url) continue;
    const alt = attr(tag, 'alt');
    const start = Math.max(0, match.index - 320), end = Math.min(html.length, match.index + tag.length + 320);
    const context = strip(html.slice(start, end));
    let score = 0;
    if (/フロア.?マップ|floor\s*map|島図/i.test(alt)) score += 12;
    else if (/フロア|floor|島図/i.test(alt)) score += 8;
    if (/フロア.?マップ|floor\s*map|島図/i.test(context)) score += 7;
    if (/floor|map|shimazu|island/i.test(url)) score += 3;
    if (/アクセス|access|google|qr|line|ロゴ|logo|banner|バナー/i.test(alt)) score -= 8;
    if (score >= 7) candidates.push({url, alt, score});
  }
  return [...new Map(candidates.sort((a, b) => b.score - a.score).map(item => [item.url, item])).values()];
}

const placeholderOnly = manifest => Array.isArray(manifest?.sources) && manifest.sources.length === 1 &&
  manifest.sources[0]?.sourceId === 'floor-map' && manifest.sources[0]?.sourceType === null &&
  manifest.sources[0]?.usageReviewed === false;

export async function collectHallSources(root, hallId, {candidates = null, transport = fetch, dryRun = true,
  maxImages = 4, delayMs = 250} = {}) {
  const master = await loadMaster(root), record = master.stores[hallId];
  if (!record) return {hallId, status: 'failed', reasons: ['hallId is not registered']};
  if (record.published) return {hallId, status: 'skipped', reasons: ['published store remains read-only']};
  if (!record.slotSupported) return {hallId, status: 'skipped', reasons: ['slot is not supported']};
  const catalog = candidates ? null : JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const pages = candidates ?? catalog.halls?.[hallId] ?? [];
  if (!pages.length) return {hallId, status: 'source_needed', reasons: ['no candidate source page registered']};

  const existing = await readSourcePack(root, hallId).catch(() => null);
  if (existing && !placeholderOnly(existing)) {
    return {hallId, status: 'skipped', reasons: ['Source Pack already contains non-placeholder sources']};
  }

  const found = [], pageReports = [];
  let rentalType = 'mixed-slot';
  for (const candidate of pages.slice(0, 3)) {
    const page = absoluteUrl(candidate.pageUrl, candidate.pageUrl);
    if (!page) {pageReports.push({pageUrl: candidate.pageUrl, status: 'blocked', reason: 'candidate URL is not allowed'}); continue;}
    try {
      const html = (await request(page, transport)).toString('utf8');
      rentalType = rentalTypeFromHtml(html);
      const images = floorMapCandidates(html, page);
      pageReports.push({pageUrl: page, status: images.length ? 'candidate_images_found' : 'no_floor_map_image', imageCount: images.length});
      for (const image of images) {
        if (found.some(item => item.url === image.url) || found.length >= maxImages) continue;
        try {
          const bytes = await request(image.url, transport, {binary: true});
          const format = imageFormat(bytes), dimensions = format && imageDimensions(bytes, format);
          if (!format || !dimensions || dimensions.width < 600 || dimensions.height < 400) continue;
          found.push({...image, bytes, format, dimensions, sourceType: candidate.sourceType || 'p-world', pageUrl: page});
        } catch {}
      }
    } catch (error) {pageReports.push({pageUrl: page, status: 'failed', reason: error.message});}
    if (delayMs) await sleep(delayMs);
    if (found.length >= maxImages) break;
  }
  if (!found.length) return {hallId, status: 'source_needed', reasons: ['no usable floor-map image found'], pages: pageReports};
  const preview = found.map((item, index) => ({sourceId: index ? `floor-map-${index + 1}` : 'floor-map',
    sourceUrl: item.pageUrl, imageUrl: item.url, format: item.format, width: item.dimensions.width, height: item.dimensions.height}));
  if (dryRun) return {hallId, status: 'would_collect_unreviewed', rentalType, sources: preview, pages: pageReports};

  if (!existing) await createSourceTemplate(root, hallId);
  const directory = packDirectory(root, hallId), importedAt = new Date().toISOString();
  await fs.mkdir(directory, {recursive: true});
  const sources = [];
  for (let index = 0; index < found.length; index++) {
    const item = found[index], sourceId = index ? `floor-map-${index + 1}` : 'floor-map';
    const extension = item.format === 'jpeg' ? '.jpg' : '.png';
    const filename = `${sourceId}${extension}`, target = path.join(directory, filename);
    await fs.writeFile(target, item.bytes, {flag: 'wx'}).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const current = await fs.readFile(target);
      if (!current.equals(item.bytes)) throw Error(`Refusing to overwrite changed source file: ${filename}`);
    });
    sources.push({sourceId, sourceType: item.sourceType, sourceUrl: item.pageUrl,
      observedAt: today(), importedAt, usageReviewed: false, usageReviewedAt: null, usageNote: '',
      sourceOwner: 'P-WORLD', floor: 'slot-floor', category: 'slot', rentalType, pages: null,
      localFiles: [{path: filename, checksum: sha256(item.bytes)}]});
  }
  const manifest = {formatVersion: 1, hallId, createdAt: existing?.createdAt ?? importedAt, sources};
  await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const notes = path.join(directory, 'notes.md');
  await fs.appendFile(notes, `\n## Automatic collection ${importedAt}\n\nDownloaded ${sources.length} candidate floor-map image(s) from registered P-WORLD candidate pages. Usage remains unreviewed; do not run AI generation until reviewed.\n`).catch(() => {});
  return {hallId, status: 'collected_unreviewed', rentalType, sources: preview, pages: pageReports,
    usageReviewed: false, apiCalls: 0};
}

export async function collectCandidateSources(root, {hallIds = null, prefecture = null, limit = Infinity,
  transport = fetch, dryRun = true, maxImages = 4, delayMs = 250} = {}) {
  const master = await loadMaster(root);
  if (hallIds?.some(id => !master.stores[id])) throw Error('Unknown selected hallId');
  const selected = Object.values(master.stores).filter(record => !record.published && record.slotSupported &&
    (!hallIds || hallIds.includes(record.hallId)) && (!prefecture || record.prefecture === prefecture))
    .sort((a, b) => a.hallId.localeCompare(b.hallId)).slice(0, limit);
  const results = [];
  for (const record of selected) {
    results.push(await collectHallSources(root, record.hallId, {transport, dryRun, maxImages, delayMs}));
  }
  return {dryRun, selected: selected.length,
    counts: {collected: results.filter(item => item.status === 'collected_unreviewed').length,
      wouldCollect: results.filter(item => item.status === 'would_collect_unreviewed').length,
      sourceNeeded: results.filter(item => item.status === 'source_needed').length,
      skipped: results.filter(item => item.status === 'skipped').length,
      failed: results.filter(item => item.status === 'failed').length}, results};
}
