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
// Connected surfaces share boundaries without moving the original seat boxes.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersection(poly,border){
 for(let i=0;i<border.length;i++){
  const a=border[i],b=border[(i+1)%border.length],out=[];
  for(let j=0;j<poly.length;j++){
   const u=poly[j],v=poly[(j+1)%poly.length],d=cross(a,b,u),e=cross(a,b,v);
   if(d>=-1e-8)out.push(u);
   if((d<0&&e>0)||(e<0&&d>0)){const t=d/(d-e);out.push([u[0]+t*(v[0]-u[0]),u[1]+t*(v[1]-u[1])]);}
  }
  poly=out;if(!poly.length)break;
 }
 return poly;
}
const area=p=>Math.abs(p.reduce((sum,[x,y],i)=>{const [X,Y]=p[(i+1)%p.length];return sum+x*Y-X*y;},0))/2;
function sharesEdge(a,b){
 for(let i=0;i<a.length;i++){
  const u=a[i],v=a[(i+1)%a.length],dx=v[0]-u[0],dy=v[1]-u[1],length=Math.hypot(dx,dy);if(length<1e-5)continue;
  for(let j=0;j<b.length;j++){
   const p=b[j],q=b[(j+1)%b.length];if(Math.abs(cross(u,v,p))/length>1e-4||Math.abs(cross(u,v,q))/length>1e-4)continue;
   const first=((p[0]-u[0])*dx+(p[1]-u[1])*dy)/length,last=((q[0]-u[0])*dx+(q[1]-u[1])*dy)/length;
   if(Math.min(length,Math.max(first,last))-Math.max(0,Math.min(first,last))>1)return true;
  }
 }
 return false;
}
let sharedBoundaries=0;
for(let i=0;i<expected.length;i++){
 const a=positions[expected[i]],poly=a[4];assert(Array.isArray(poly)&&poly.length>=4);
 for(let k=0;k<poly.length;k++)assert(cross(poly[k],poly[(k+1)%poly.length],[a[0]+25,a[1]+25])>=-1e-5,'seat center outside surface');
 for(let j=i+1;j<expected.length;j++){
  const other=positions[expected[j]][4];assert(area(intersection(poly,other))<.001,'connected surfaces overlap');
  if(sharesEdge(poly,other)){assert.equal(expected[j],expected[i]+1,'joined unrelated seats');sharedBoundaries++;}
 }
}
assert.equal(sharedBoundaries,483);
const minX=p=>Math.min(...p.map(v=>v[0])),maxX=p=>Math.max(...p.map(v=>v[0]));
assert.equal(minX(positions['90'][4])-maxX(positions['91'][4]),positions['90'][0]-positions['91'][0]-50,'aisle width changed');
const catalog=read('data/halls.json');assert.equal(catalog.halls.filter(h=>h.id==='rakuen-namba').length,1);
const realStats=read('data/live/rakuen-namba-stats.json');assert.equal(realStats.hall_id,hall.id);assert.deepEqual(Object.keys(realStats.seats).map(Number).sort((a,b)=>a-b),expected);
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
try{
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});let stats=structuredClone(realStats),errors=[];
await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='floor777.test')return route.abort();if(u.pathname.includes('/data/live/'))return route.fulfill({json:stats});const file=path.join(root,decodeURIComponent(u.pathname)+(u.pathname.endsWith('/')?'index.html':''));try{return await route.fulfill({path:file})}catch{return route.fulfill({status:404,body:'Not found'})}});
const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
async function open(){await page.goto('http://floor777.test/halls/rakuen-namba/');await page.waitForSelector('.seat');}
await open();assert.equal(await page.locator('.seat polygon').count(),502);assert.equal(await page.locator('.seat').count(),502);assert.equal(await page.locator('#seatCount').textContent(),'502');assert.equal(await page.locator('.seat[data-seat="75"]').count(),0);
for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');}
await page.setViewportSize({width:390,height:844});
for(const n of [76,405,411,574,578,585]){await page.locator('[data-search-mode=seat]').click();await page.locator('#machineSearch').fill(String(n));await page.locator('#searchBtn').click();assert.match(await page.locator('#resultText').textContent(),/1台/);}
await page.locator('.seat[data-seat="585"]').click();assert(await page.locator('#seatDialog').isVisible());assert.equal(await page.locator('#detailMachine').textContent(),realStats.seats['585'].machine);await page.locator('[data-close-detail]').click();
await page.locator('[data-map-value=diff]').click();const diff=realStats.seats['76'].latest.diff;assert.equal(await page.locator('.seat[data-seat="76"] .seat-value').textContent(),diff===null?'—':`${diff>0?'+':''}${Math.round(diff)}`);
stats.seats['76'].latest.diff=4815;await open();await page.locator('[data-map-value=diff]').click();assert.equal(await page.locator('.seat[data-seat="76"] polygon').evaluate(el=>getComputedStyle(el).fill),'rgb(166, 0, 24)');
stats.seats['76'].latest.diff=null;stats.seats['76'].latest.spins=null;await open();
for(const mode of ['diff','spins']){await page.locator(`[data-map-value=${mode}]`).click();assert.equal(await page.locator('.seat[data-seat="76"] .seat-value').textContent(),'—');}
for(const days of ['3','7'])stats.seats['76'].periods[days]={days:Number(days),complete:false,diff_sum:99999,avg_spins:8888};
await open();
for(const days of ['3','7']){await page.locator(`[data-map-value=diff${days}]`).click();assert.equal(await page.locator('.seat[data-seat="76"] .seat-value').textContent(),'—');}
await page.locator('[data-search-mode=seat]').click();await page.locator('#machineSearch').fill('76');await page.locator('#searchBtn').click();await page.locator('.seat[data-seat="76"]').click();
for(const id of ['stat3Diff','stat3Spins','stat7Diff','stat7Spins'])assert.equal(await page.locator('#'+id).textContent(),'—');
await page.locator('[data-close-detail]').click();
const readPoints=()=>page.locator('.seat[data-seat="520"] polygon').evaluate(el=>Array.from(el.points,p=>[p.x,p.y]));
const beforeFlip=await readPoints();const fullSize=await page.locator('.floor-bg').evaluate(el=>[Number(el.getAttribute('width'))+6,Number(el.getAttribute('height'))+6]);
await page.locator('#orientationBtn').click();assert.equal(await page.locator('.seat').count(),502);
const afterFlip=await readPoints();assert.equal(afterFlip.length,beforeFlip.length);for(let i=0;i<afterFlip.length;i++)for(let axis=0;axis<2;axis++)assert(Math.abs(afterFlip[i][axis]+beforeFlip[i][axis]-fullSize[axis])<.001,'surface rotation mismatch');
if(process.env.NAMBA_SCREENSHOT)await page.screenshot({path:process.env.NAMBA_SCREENSHOT,fullPage:true});
assert.deepEqual(errors,[]);console.log(`PASS: Rakuen Namba 502 exact seats, excluded low-rate seats, preserved centers, 483 shared boundaries, no overlap, polygon colors/rotation, live ${realStats.latest_date}, machine/seat join, search, nulls, rotation, 320–1440px layouts`);
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
