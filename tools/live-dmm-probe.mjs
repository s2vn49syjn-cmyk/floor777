import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const targets = {
  "123-kitanoda": "https://p-town.dmm.com/shops/osaka/7610",
  "123-sakai-inter": "https://p-town.dmm.com/shops/osaka/7630",
  "123-senboku": "https://p-town.dmm.com/shops/osaka/7644",
  "arrow-toga": "https://p-town.dmm.com/shops/osaka/7645",
  "hyper-arrow-fukai": "https://p-town.dmm.com/shops/osaka/7604",
  "hyper-arrow-senboku": "https://p-town.dmm.com/shops/osaka/7638",
  "maruhan-harayamadai": "https://p-town.dmm.com/shops/osaka/7648",
  "maruhan-orisano": "https://p-town.dmm.com/shops/osaka/12100",
  "monroe": "https://p-town.dmm.com/shops/osaka/7580",
  "sherra": "https://p-town.dmm.com/shops/osaka/7601",
  "sherra-part3": "https://p-town.dmm.com/shops/osaka/7651"
};

const outRoot = 'work/cloud-dmm-discovery';
await fs.rm(outRoot, {recursive:true, force:true});
await fs.mkdir(outRoot, {recursive:true});
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:1200}, deviceScaleFactor:1});
const report = {};
try {
  for (const [hallId, url] of Object.entries(targets)) {
    const dir = path.join(outRoot, hallId);
    await fs.mkdir(dir, {recursive:true});
    const page = await context.newPage();
    const item = {url, title:null, floorText:[], links:[], images:[], screenshot:null, error:null};
    try {
      await page.goto(url, {waitUntil:'domcontentloaded', timeout:45000});
      await page.waitForTimeout(1800);
      item.title = await page.title();
      item.floorText = await page.locator('body').evaluate(el => {
        const texts = (el.innerText || '').split(/\n+/).map(x=>x.trim()).filter(Boolean);
        return texts.filter(t => /フロア.?マップ|島図|floor.?map/i.test(t)).slice(0,30);
      });
      item.links = await page.locator('a').evaluateAll(nodes => nodes.map(a => ({
        href:a.href||'', text:(a.innerText||a.textContent||'').replace(/\s+/g,' ').trim()
      })).filter(x => /フロア.?マップ|島図|floor.?map|floor_map|floormap/i.test(x.href+' '+x.text)).slice(0,30));
      item.images = await page.locator('img').evaluateAll(nodes => nodes.map((img,index) => {
        const r=img.getBoundingClientRect();
        const parent=(img.closest('a,section,article,div,li')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,160);
        return {index,src:img.currentSrc||img.src||'',alt:img.alt||'',width:img.naturalWidth||0,height:img.naturalHeight||0,
          y:r.top+scrollY,context:parent};
      }).filter(x => x.width>=450 && x.height>=250 &&
        /フロア.?マップ|島図|floor.?map|floor_map|floormap/i.test(x.src+' '+x.alt+' '+x.context)).slice(0,20));
      const candidates = await page.evaluate(() => {
        const els=[...document.querySelectorAll('body *')];
        const heads=els.filter(el=>{
          const t=(el.textContent||'').replace(/\s+/g,' ').trim();
          return t.length>0 && t.length<=80 && /フロア.?マップ|島図|floor.?map/i.test(t);
        }).map(el=>({text:(el.textContent||'').replace(/\s+/g,' ').trim(), y:el.getBoundingClientRect().top+scrollY}));
        const imgs=[...document.images].map((img,index)=>{const r=img.getBoundingClientRect();return {
          index,src:img.currentSrc||img.src||'',alt:img.alt||'',width:img.naturalWidth||0,height:img.naturalHeight||0,y:r.top+scrollY
        }});
        const out=[];
        for(const h of heads.slice(0,10)){
          for(const im of imgs){
            if(im.width>=500 && im.height>=300 && im.y>=h.y-150 && im.y<=h.y+2200) out.push({...im,heading:h.text,headingY:h.y});
          }
        }
        return out.slice(0,20);
      });
      item.nearHeading = candidates;
      if (item.floorText.length || item.links.length || item.images.length || candidates.length) {
        const shot=path.join(dir,'page.png');
        await page.screenshot({path:shot, fullPage:true});
        item.screenshot='page.png';
        for (const cand of candidates.slice(0,4)) {
          try { await page.locator('img').nth(cand.index).screenshot({path:path.join(dir,`candidate-${cand.index}.png`)}); } catch {}
        }
      }
    } catch(error) { item.error=error.message; }
    finally { await page.close(); }
    report[hallId]=item;
    await fs.writeFile(path.join(dir,'report.json'), JSON.stringify(item,null,2));
  }
} finally { await browser.close(); }

await fs.writeFile(path.join(outRoot,'report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify(Object.entries(report).map(([hallId,x])=>({
  hallId,title:x.title,floorText:x.floorText.length,links:x.links.length,
  images:x.images.length,nearHeading:x.nearHeading?.length||0,error:x.error
})),null,2));
