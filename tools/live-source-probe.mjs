import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const catalog = JSON.parse(await fs.readFile('tools/nationwide/source-candidates.json', 'utf8'));
const outRoot = 'work/cloud-source-discovery';
await fs.rm(outRoot, {recursive: true, force: true});
await fs.mkdir(outRoot, {recursive: true});
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1200}, deviceScaleFactor: 1});
const report = {};
const unique = values => [...new Set(values)];
try {
  for (const [hallId, candidates] of Object.entries(catalog.halls)) {
    const hallDir = path.join(outRoot, hallId);
    await fs.mkdir(hallDir, {recursive: true});
    report[hallId] = {landingPages: [], floorPages: []};
    const floorLinks = [];
    for (const candidate of candidates.slice(0, 2)) {
      const page = await context.newPage();
      try {
        await page.goto(candidate.pageUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1000);
        const links = await page.locator('a').evaluateAll(nodes => nodes.map(a => ({
          href: a.href || '', text: (a.innerText || a.textContent || '').trim()
        })).filter(x => /floor_maps|フロア.?マップ|島図/i.test(x.href + ' ' + x.text)));
        const inline = await page.evaluate(() => {
          const all = [...document.querySelectorAll('body *')];
          const headings = all.filter(el => { const t=(el.textContent||'').replace(/\\s+/g,' ').trim(); return t.length > 0 && t.length <= 60 && /フロア.?マップ|島図/i.test(t); })
            .map(el => el.getBoundingClientRect().top + scrollY).filter(Number.isFinite);
          if (!headings.length) return [];
          const y0 = Math.min(...headings);
          return [...document.images].map((img, index) => {
            const r = img.getBoundingClientRect(), y = r.top + scrollY;
            return {index, src: img.currentSrc || img.src || '', alt: img.alt || '', y,
              width: img.naturalWidth || 0, height: img.naturalHeight || 0};
          }).filter(x => x.src && x.y >= y0 - 100 && x.y <= y0 + 2600 && x.width >= 500 && x.height >= 300).slice(0, 4);
        });
        const labeledFloorImages = await page.locator('img').evaluateAll(nodes => nodes.map((img,index) => ({
          index, src: img.currentSrc || img.src || '', alt: img.alt || '',
          width: img.naturalWidth || 0, height: img.naturalHeight || 0
        })).filter(x => /フロア.?マップ|フロア.?案内|島図|floor.?map|floor.?information/i.test(x.alt + ' ' + x.src)));
        for (const item of inline) {
          try {
            const img = page.locator('img').nth(item.index);
            await img.screenshot({path: path.join(hallDir, `inline-candidate-${report[hallId].landingPages.length + 1}-${item.index}.png`)});
          } catch {}
        }
        const labeledNeighbors = [];
        for (const item of labeledFloorImages.slice(0,6)) {
          try {
            const img = page.locator('img').nth(item.index);
            await img.scrollIntoViewIfNeeded();
            await img.screenshot({path: path.join(hallDir, `labeled-floor-${report[hallId].landingPages.length + 1}-${item.index}.png`)});
          } catch {}
          for (let offset=1; offset<=5; offset++) {
            try {
              const idx=item.index+offset, img=page.locator('img').nth(idx);
              const meta=await img.evaluate(node=>({src:node.currentSrc||node.src||'',alt:node.alt||'',
                width:node.naturalWidth||0,height:node.naturalHeight||0}));
              if(meta.src && meta.width>=450 && meta.height>=250) {
                labeledNeighbors.push({index:idx,after:item.index,...meta});
                await img.scrollIntoViewIfNeeded();
                await img.screenshot({path:path.join(hallDir,`floor-neighbor-${report[hallId].landingPages.length + 1}-${item.index}-${idx}.png`)});
              }
            } catch {}
          }
        }
        report[hallId].landingPages.push({url: candidate.pageUrl, title: await page.title(), links, inline, labeledFloorImages, labeledNeighbors});
        floorLinks.push(...links.map(x => x.href));
      } catch (error) {report[hallId].landingPages.push({url: candidate.pageUrl, error: error.message});}
      finally {await page.close();}
    }
    const normalized = unique(floorLinks).filter(Boolean).filter(url => !/[?&]machine_id=/.test(url));
    for (const [index, url] of normalized.slice(0, 5).entries()) {
      const page = await context.newPage();
      try {
        await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
        await page.waitForTimeout(1200);
        const finalUrl = page.url(), title = await page.title();
        const filename = `floor-page-${index + 1}.png`;
        await page.screenshot({path: path.join(hallDir, filename), fullPage: true});
        report[hallId].floorPages.push({url, finalUrl, title, file: filename});
      } catch (error) {report[hallId].floorPages.push({url, error: error.message});}
      finally {await page.close();}
    }
    await fs.writeFile(path.join(hallDir, 'report.json'), JSON.stringify(report[hallId], null, 2));
  }
} finally {await browser.close();}
await fs.writeFile(path.join(outRoot, 'report.json'), JSON.stringify(report, null, 2));
const summary = Object.entries(report).map(([hallId, x]) => ({hallId, floorPages: x.floorPages.length,
  titles: x.floorPages.map(y => y.title).filter(Boolean)}));
console.log(JSON.stringify(summary, null, 2));
