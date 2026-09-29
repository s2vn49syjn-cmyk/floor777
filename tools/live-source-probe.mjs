import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const catalog = JSON.parse(await fs.readFile('tools/nationwide/source-candidates.json', 'utf8'));
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1200}});
const report = {};
try {
  for (const [hallId, pages] of Object.entries(catalog.halls)) {
    report[hallId] = [];
    for (const candidate of pages.slice(0, 2)) {
      const page = await context.newPage();
      try {
        await page.goto(candidate.pageUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1200);
        const images = await page.locator('img').evaluateAll(nodes => nodes.map((img, index) => ({
          index, src: img.currentSrc || img.src || '', alt: img.alt || '',
          width: img.naturalWidth || 0, height: img.naturalHeight || 0,
          text: (img.parentElement?.innerText || '').slice(0, 120)
        })).filter(x => x.src && x.width >= 500 && x.height >= 300));
        report[hallId].push({pageUrl: candidate.pageUrl, title: await page.title(), images: images.slice(0, 12)});
      } catch (error) {report[hallId].push({pageUrl: candidate.pageUrl, error: error.message});}
      finally {await page.close();}
    }
  }
} finally {await browser.close();}
console.log(JSON.stringify(report, null, 2));
