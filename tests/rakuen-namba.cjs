const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const hall=read('data/rakuen-namba.json'),positions=read('data/positions-rakuen-namba.json');
const expected=Array.from({length:510},(_,i)=>i+76).filter(n=>!(n>=406&&n<=410)&&!(n>=575&&n<=577));
assert.equal(expected.length,502);
assert.deepEqual(hall.seats.map(s=>s.seat),expected);
assert.deepEqual(Object.keys(positions).map(Number),expected);
assert.equal(hall.seat_count,502);
for(const s of hall.seats){const [x,y,w,h]=s.provenance.source_bounds,p=positions[s.seat];assert(Math.abs(p[0]+25-x-w/2)<.001);assert(Math.abs(p[1]+25-y-h/2)<.001);assert.equal(s.provenance.field_verified,false);}
for(let i=0;i<expected.length;i++)for(let j=i+1;j<expected.length;j++){const a=positions[expected[i]],b=positions[expected[j]];assert(Math.abs(a[0]-b[0])>=50||Math.abs(a[1]-b[1])>=50,'overlapping seats');}
const catalog=read('data/halls.json');assert.equal(catalog.halls.filter(h=>h.id==='rakuen-namba').length,1);
const realStats=read('data/live/rakuen-namba-stats.json');assert.equal(realStats.hall_id,hall.id);assert.deepEqual(Object.keys(realStats.seats).map(Number).sort((a,b)=>a-b),expected);
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
try{
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});let stats=structuredClone(realStats),errors=[];
await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='floor777.test')return route.abort();if(u.pathname.includes('/data/live/'))return route.fulfill({json:stats});const file=path.join(root,decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));try{return await route.fulfill({path:file})}catch{return route.fulfill({status:404,body:'Not found'})}});
const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
async function open(){await page.goto('http://floor777.test/halls/rakuen-namba/');await page.waitForSelector('.seat');}
await open();assert.equal(await page.locator('.seat').count(),502);assert.equal(await page.locator('#seatCount').textContent(),'502');assert.equal(await page.locator('.seat[data-seat="75"]').count(),0);
for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');}
await page.setViewportSize({width:390,height:844});
for(const n of [76,405,411,574,578,585]){await page.locator('[data-search-mode=seat]').click();await page.locator('#machineSearch').fill(String(n));await page.locator('#searchBtn').click();assert.match(await page.locator('#resultText').textContent(),/1台/);}
await page.locator('.seat[data-seat="585"]').click();assert(await page.locator('#seatDialog').isVisible());assert.equal(await page.locator('#detailMachine').textContent(),realStats.seats['585'].machine);await page.locator('[data-close-detail]').click();
await page.locator('[data-map-value=diff]').click();const diff=realStats.seats['76'].latest.diff;assert.equal(await page.locator('.seat[data-seat="76"] .seat-value').textContent(),diff===null?'—':`${diff>0?'+':''}${Math.round(diff)}`);
stats.seats['76'].latest.diff=null;stats.seats['76'].latest.spins=null;await open();
for(const mode of ['diff','spins']){await page.locator(`[data-map-value=${mode}]`).click();assert.equal(await page.locator('.seat[data-seat="76"] .seat-value').textContent(),'—');}
await page.locator('#orientationBtn').click();assert.equal(await page.locator('.seat').count(),502);
if(process.env.NAMBA_SCREENSHOT)await page.screenshot({path:process.env.NAMBA_SCREENSHOT,fullPage:true});
assert.deepEqual(errors,[]);console.log(`PASS: Rakuen Namba 502 exact seats, excluded low-rate seats, preserved centers, no overlap, live ${realStats.latest_date}, machine/seat join, search, nulls, rotation, 320–1440px layouts`);
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
