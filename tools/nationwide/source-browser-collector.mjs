import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadMaster} from './master.mjs';
import {createSourceTemplate, readSourcePack, packDirectory} from './source-pack.mjs';

const catalogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'source-candidates.json');
const today = () => new Date().toISOString().slice(0, 10);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pworldHost = host => host === 'p-world.co.jp' || host.endsWith('.p-world.co.jp');
const pworldAssetHost = host => host === 'idn.p-world.co.jp';

export function normalizeFloorLink(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !pworldHost(url.hostname)) return null;
    if (url.pathname === '/jump.cgi') {
      const target = url.searchParams.get('url');
      if (!target) return null;
      const decoded = decodeURIComponent(target);
      const external = new URL(decoded);
      return external.protocol === 'https:' ? external.href : null;
    }
    if (url.pathname.includes('/hall/floor_maps/')) return url.href;
    return null;
  } catch {return null;}
}

export function normalizePworldAsset(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !pworldAssetHost(url.hostname)) return null;
    if (!/\.(?:png|jpe?g)(?:$|\?)/i.test(url.href)) return null;
    return url.href;
  } catch {return null;}
}

export function chooseRegisteredAsset(candidatePages) {
  for (const candidate of candidatePages ?? []) {
    const asset = normalizePworldAsset(candidate?.assetUrl);
    if (asset) return asset;
  }
  return null;
}

export function chooseInlineFloorImage(headingY, images) {
  if (!Number.isFinite(headingY)) return null;
  return images.filter(item => Number.isFinite(item.y) && item.y >= headingY - 100 && item.y <= headingY + 1200 &&
    item.width >= 500 && item.height >= 300).sort((a, b) => a.y - b.y)[0] ?? null;
}

export function chooseSlotFloorLink(links) {
  const normalized = [...new Set(links.map(normalizeFloorLink).filter(Boolean))];
  const slotSmart = normalized.find(url => /\/hall\/floor_maps\//.test(url) && /[?&]map_id=2(?:&|$)/.test(url));
  if (slotSmart) return slotSmart;
  const direct = normalized.find(url => !/p-world\.co\.jp\/hall\/floor_maps\//.test(url));
  if (direct) return direct;
  return normalized.find(url => /\/hall\/floor_maps\//.test(url) && !/[?&]machine_id=/.test(url)) ?? null;
}

const placeholderOnly = manifest => Array.isArray(manifest?.sources) && manifest.sources.length === 1 &&
  manifest.sources[0]?.sourceId === 'floor-map' && manifest.sources[0]?.sourceType === null &&
  manifest.sources[0]?.usageReviewed === false;

async function linksFromPage(page) {
  return page.locator('a').evaluateAll(nodes => nodes.map(a => ({
    href: a.href || '', text: (a.innerText || a.textContent || '').trim()
  })).filter(item => /floor_maps|フロア.?マップ|島図/i.test(item.href + ' ' + item.text)));
}

export async function discoverRenderedFloorSource(page, candidatePages) {
  const observations = [], links = [], directAssetUrl = chooseRegisteredAsset(candidatePages);
  for (const candidate of candidatePages.slice(0, 3)) {
    try {
      const url = new URL(candidate.pageUrl);
      if (url.protocol !== 'https:' || !pworldHost(url.hostname)) {
        observations.push({pageUrl: candidate.pageUrl, status: 'blocked'});
        continue;
      }
      await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 30000});
      await page.waitForTimeout(800);
      const found = await linksFromPage(page);
      links.push(...found.map(item => item.href));
      if (url.pathname.includes('/hall/floor_maps/')) links.push(url.href);
      const inline = await page.evaluate(() => {
        const all = [...document.querySelectorAll('body *')];
        const headings = all.filter(el => /^(?:▼?\\s*)?(?:フロア.?マップ|島図)(?:\\s*▼?)?$/i.test((el.textContent || '').trim()))
          .map(el => el.getBoundingClientRect().top + scrollY).filter(Number.isFinite);
        const images = [...document.images].map((img, index) => {
          const r = img.getBoundingClientRect();
          return {index, y: r.top + scrollY, width: img.naturalWidth || 0, height: img.naturalHeight || 0};
        });
        return {headingY: headings.length ? Math.min(...headings) : null, images};
      });
      const inlineCandidate = chooseInlineFloorImage(inline.headingY, inline.images);
      if (inlineCandidate) observations.push({pageUrl: url.href, status: 'inline_floor_candidate',
        floorLinks: found.length, inlineImageIndex: inlineCandidate.index});
      else observations.push({pageUrl: url.href, status: 'checked', floorLinks: found.length});
    } catch (error) {observations.push({pageUrl: candidate.pageUrl, status: 'failed', reason: error.message});}
  }
  const selectedUrl = chooseSlotFloorLink(links);
  const inline = observations.find(item => Number.isInteger(item.inlineImageIndex));
  return {selectedUrl, directAssetUrl, inline: inline ? {pageUrl: inline.pageUrl, imageIndex: inline.inlineImageIndex} : null, observations};
}

export async function collectRenderedHallSource(root, hallId, {candidatePages = null, browser = null,
  dryRun = true} = {}) {
  const master = await loadMaster(root), record = master.stores[hallId];
  if (!record) return {hallId, status: 'failed', reasons: ['hallId is not registered']};
  if (record.published) return {hallId, status: 'skipped', reasons: ['published store remains read-only']};
  if (!record.slotSupported) return {hallId, status: 'skipped', reasons: ['slot is not supported']};
  const existing = await readSourcePack(root, hallId).catch(() => null);
  if (existing && !placeholderOnly(existing)) return {hallId, status: 'skipped', reasons: ['Source Pack already contains non-placeholder sources']};

  const catalog = candidatePages ? null : JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const pages = candidatePages ?? catalog.halls?.[hallId] ?? [];
  if (!pages.length) return {hallId, status: 'source_needed', reasons: ['no candidate source page registered']};

  let ownedBrowser = null;
  try {
    if (!browser) {
      const {chromium} = await import('playwright');
      ownedBrowser = await chromium.launch({headless: true});
      browser = ownedBrowser;
    }
    const context = await browser.newContext({viewport: {width: 1440, height: 1200}, deviceScaleFactor: 1});
    const page = await context.newPage();
    try {
      const discovery = await discoverRenderedFloorSource(page, pages);
      if (!discovery.selectedUrl && !discovery.directAssetUrl && !discovery.inline) return {hallId, status: 'source_needed',
        reasons: ['no rendered floor-map link, registered asset, or inline map found'], observations: discovery.observations};
      const sourceUrl = discovery.selectedUrl ?? discovery.directAssetUrl ?? discovery.inline.pageUrl;
      const capture = discovery.selectedUrl ? 'page' : discovery.directAssetUrl ? 'direct-image' : 'inline-image';
      if (dryRun) return {hallId, status: 'would_collect_rendered', sourceUrl,
        capture, observations: discovery.observations};

      let bytes;
      if (discovery.selectedUrl) {
        await page.goto(discovery.selectedUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1200);
        bytes = await page.screenshot({fullPage: true, type: 'png'});
      } else if (discovery.directAssetUrl) {
        await page.goto(discovery.directAssetUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(300);
        const image = page.locator('img').first();
        const dimensions = await image.evaluate(node => ({width: node.naturalWidth || 0, height: node.naturalHeight || 0}));
        if (dimensions.width < 600 || dimensions.height < 400) return {hallId, status: 'source_needed',
          reasons: ['registered floor-map asset is too small'], sourceUrl};
        bytes = await image.screenshot({type: 'png'});
      } else {
        await page.goto(discovery.inline.pageUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1000);
        bytes = await page.locator('img').nth(discovery.inline.imageIndex).screenshot({type: 'png'});
      }
      if (bytes.length < 10000) return {hallId, status: 'source_needed',
        reasons: ['rendered floor-map screenshot was unexpectedly small'], sourceUrl};

      if (!existing) await createSourceTemplate(root, hallId);
      const directory = packDirectory(root, hallId), importedAt = new Date().toISOString();
      await fs.mkdir(directory, {recursive: true});
      const filename = 'floor-map-rendered.png', target = path.join(directory, filename);
      await fs.writeFile(target, bytes, {flag: 'wx'}).catch(async error => {
        if (error.code !== 'EEXIST') throw error;
        const current = await fs.readFile(target);
        if (!current.equals(bytes)) throw Error('Refusing to overwrite changed rendered source file');
      });
      const sourceHost = new URL(sourceUrl).hostname;
      const manifest = {formatVersion: 1, hallId, createdAt: existing?.createdAt ?? importedAt, sources: [{
        sourceId: 'floor-map', sourceType: 'p-world-rendered', sourceUrl,
        observedAt: today(), importedAt, usageReviewed: false, usageReviewedAt: null, usageNote: '',
        sourceOwner: pworldHost(sourceHost) ? 'P-WORLD' : sourceHost, floor: 'slot-floor',
        category: 'slot', rentalType: 'slot-floor', pages: null,
        localFiles: [{path: filename, checksum: sha256(bytes)}]
      }]};
      await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await fs.appendFile(path.join(directory, 'notes.md'),
        `\n## Rendered collection ${importedAt}\n\nCaptured a rendered floor-map candidate from ${sourceUrl}. Usage remains unreviewed; AI generation stays blocked until reviewed.\n`).catch(() => {});
      return {hallId, status: 'collected_rendered_unreviewed', sourceUrl,
        bytes: bytes.length, usageReviewed: false, apiCalls: 0, observations: discovery.observations};
    } finally {await context.close();}
  } finally {if (ownedBrowser) await ownedBrowser.close();}
}

export async function collectRenderedSources(root, {hallIds = null, prefecture = null, limit = Infinity,
  dryRun = true} = {}) {
  const master = await loadMaster(root);
  if (hallIds?.some(id => !master.stores[id])) throw Error('Unknown selected hallId');
  const selected = Object.values(master.stores).filter(record => !record.published && record.slotSupported &&
    (!hallIds || hallIds.includes(record.hallId)) && (!prefecture || record.prefecture === prefecture))
    .sort((a, b) => a.hallId.localeCompare(b.hallId)).slice(0, limit);
  const {chromium} = await import('playwright');
  const browser = await chromium.launch({headless: true});
  const results = [];
  try {
    for (const record of selected) results.push(await collectRenderedHallSource(root, record.hallId, {browser, dryRun}));
  } finally {await browser.close();}
  return {dryRun, selected: selected.length,
    counts: {collected: results.filter(x => x.status === 'collected_rendered_unreviewed').length,
      wouldCollect: results.filter(x => x.status === 'would_collect_rendered').length,
      sourceNeeded: results.filter(x => x.status === 'source_needed').length,
      skipped: results.filter(x => x.status === 'skipped').length,
      failed: results.filter(x => x.status === 'failed').length}, results};
}
