import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const targets = {
  'maruhan-harayamadai': 'https://www.p-world.co.jp/hall/floor_maps/59fe3df3f468',
  'monroe': 'https://www.p-world.co.jp/hall/floor_maps/59fe39f8fa64'
};
const out='work/direct-floor-endpoint-probe';
await fs.rm(out,{recursive:true,force:true}); await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1200}});
const report={};
try{
 for(const [hallId,url] of Object.entries(targets)){
  const page=await context.newPage();
  try{
   const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   await page.waitForTimeout(1200);
   const text=(await page.locator('body').innerText().catch(()=>'' )).slice(0,2000);
   const imgs=await page.locator('img').evaluateAll(nodes=>nodes.map((img,index)=>({
    index,src:img.currentSrc||img.src||'',alt:img.alt||'',width:img.naturalWidth||0,height:img.naturalHeight||0
   })).filter(x=>x.src&&x.width>=300&&x.height>=200));
   await page.screenshot({path:path.join(out,hallId+'.png'),fullPage:true});
   report[hallId]={url,finalUrl:page.url(),status:res?.status()??null,title:await page.title(),text,images:imgs};
  }catch(error){report[hallId]={url,error:error.message};}
  finally{await page.close();}
 }
}finally{await browser.close();}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
