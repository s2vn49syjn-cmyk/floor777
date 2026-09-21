const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),id='kikuya-sakai-honten';
const positions=JSON.parse(fs.readFileSync(path.join(root,`data/positions-${id}.json`)));
const hall=JSON.parse(fs.readFileSync(path.join(root,`data/${id}.json`)));
const numbers=Object.keys(positions).map(Number).sort((a,b)=>a-b);
assert.equal(numbers.length,826);
assert.deepEqual(hall.seats.map(s=>s.seat).sort((a,b)=>a-b),numbers);
assert(!numbers.some(n=>n>=621&&n<=661));
for(const n of [729,738,791,800,1275])assert(numbers.includes(n));
const cells=Object.values(positions);
for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
 const [x,y,w,h]=cells[i],[a,b,c,d]=cells[j];
 assert(!(Math.min(x+w,a+c)-Math.max(x,a)>1&&Math.min(y+h,b+d)-Math.max(y,b)>1),'Overlapping seats');
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.hostname!=='floor777.test')return route.abort();
   const file=path.join(root,decodeURIComponent(url.pathname),url.pathname.endsWith('/')?'index.html':'');
   try{await route.fulfill({path:file})}catch{await route.fulfill({status:404,body:'Unavailable'})}
  });
  await page.goto(`http://floor777.test/halls/${id}/`);await page.waitForSelector('.seat');
  assert.equal(await page.locator('.seat').count(),826);
  await page.locator('[data-search-mode=seat]').click();
  for(const n of ['729','738','1275']){
   await page.locator('#machineSearch').fill(n);await page.locator('#searchBtn').click();
   assert.match(await page.locator('#resultText').innerText(),/1台/);
  }
  await page.locator('#machineSearch').fill('621');await page.locator('#searchBtn').click();
  assert.match(await page.locator('#resultText').innerText(),/0台|見つかりません/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto('http://floor777.test/');await page.waitForSelector('.hall-card');
  assert.equal(await page.locator('#publishedHallTotal').innerText(),'3');
  assert.equal(await page.locator('#publishedSeatTotal').innerText(),'1,881');
  await page.locator('#hallSearch').fill('キクヤ');assert.equal(await page.locator('#hallList .hall-card').count(),1);
  assert.equal(await page.locator('#publishedSeatTotal').innerText(),'1,881');
  assert.deepEqual(errors,[]);
  console.log('PASS: Kikuya map, exclusions, restored seats, search, mobile layout and dynamic home totals');
 }finally{await browser.close()}
})();
