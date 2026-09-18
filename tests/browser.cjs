const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const realStats=JSON.parse(fs.readFileSync(path.join(root,'data/live/hyper-arrow-mihara-stats.json')));
const appURL='http://floor777.test/floor777/halls/hyper-arrow-mihara/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {})});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 let stats=structuredClone(realStats),noStats=false,errors=[];
 for(const rec of Object.values(stats.seats))rec.periods['7']={days:7,complete:false,diff_sum:null,avg_spins:null};
 await context.route('http://floor777.test/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/data/live/'))return noStats?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:stats});
  const file=path.join(root,decodeURIComponent(u.pathname.replace(/^\/floor777\//,''))+(u.pathname.endsWith('/')?'index.html':''));
  try{return await route.fulfill({path:file})}catch{return route.fulfill({status:404,body:'Not found'})}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function open(){await page.goto(appURL);await page.waitForSelector('.seat');}
 async function assertNoOverflow(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page horizontal overflow');}
 await open();await assertNoOverflow();assert.equal(await page.locator('.seat').count(),551);
 await page.locator('[data-search-mode=seat]').click();await page.locator('#machineSearch').fill('５６１');await page.locator('#searchBtn').click();assert.match(await page.locator('#resultText').textContent(),/1台/);
 await page.locator('.seat[data-seat="561"]').click();assert(await page.locator('#seatDialog').isVisible(),'map tap must open details');
 await page.locator('#detailPickBtn').click();await page.locator('#detailMapBtn').click();assert(!(await page.locator('#seatDialog').isVisible()));
 await page.locator('[data-screen=picks]').click();await page.locator('#bulkSeats').fill('５６２、563\n561');await page.locator('#bulkForm button').click();assert.equal(await page.locator('.pick-card').count(),3);
 await page.locator('[data-note]').first().fill('朝イチ確認');await page.locator('[data-action=down]').first().click();assert.equal(await page.locator('[data-note]').nth(1).inputValue(),'朝イチ確認');
 await page.reload();await page.waitForSelector('.pick-card');assert.equal(await page.locator('.pick-card').count(),3);assert.equal(await page.locator('[data-note]').nth(1).inputValue(),'朝イチ確認');
 await page.locator('.backup-panel summary').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#exportPicks').click();const download=await downloadPromise;const file=await download.path();assert.equal(JSON.parse(fs.readFileSync(file)).picks.length,3);
 page.once('dialog',d=>d.dismiss());await page.locator('#clearPicks').click();assert.equal(await page.locator('.pick-card').count(),3);
 page.once('dialog',d=>d.accept());await page.locator('#clearPicks').click();assert.equal(await page.locator('.pick-card').count(),0);
 page.once('dialog',d=>d.accept());await page.locator('#importPicks').setInputFiles({name:'picks.json',mimeType:'application/json',buffer:fs.readFileSync(file)});await page.waitForSelector('.pick-card');assert.equal(await page.locator('.pick-card').count(),3);
 await page.locator('[data-screen=recommend]').click();assert.equal(await page.locator('.recommended-row').count(),10);await assertNoOverflow();
 await page.locator('.recommended-section [data-recommend-days="7"]').click();assert.equal(await page.locator('.recommended-row').count(),0);await page.locator('.recommended-section [data-recommend-days="3"]').click();assert.equal(await page.locator('.recommended-row').count(),10);
 const expected=Object.entries(stats.seats).filter(([,r])=>typeof r.periods['3'].diff_sum==='number'&&r.periods['3'].diff_sum<0).sort((a,b)=>a[1].periods['3'].diff_sum-b[1].periods['3'].diff_sum||+a[0]-+b[0]).slice(0,10).map(([n])=>n);
 assert.deepEqual(await page.locator('.recommended-row').evaluateAll(es=>es.map(e=>e.dataset.recommendSeat)),expected);
 for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});await assertNoOverflow();assert(await page.locator('.recommended-row').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1)),'recommendations clipped');}
 // A present difference remains usable when only spins are absent.
 stats.seats['561'].periods['3']={days:3,complete:false,diff_sum:-99999,avg_spins:null};stats.seats['562'].latest.diff=null;stats.seats['562'].history=stats.seats['562'].history.map(x=>({...x,diff:null}));
 await open();await page.locator('[data-screen=recommend]').click();assert.equal(await page.locator('.recommended-row').first().getAttribute('data-recommend-seat'),'561');
 await page.locator('[data-screen=map]').click();await page.locator('[data-map-value=diff]').click();assert.equal(await page.locator('.seat[data-seat="562"] .seat-number').textContent(),'—');assert(!(await page.locator('.seat[data-seat="562"]').getAttribute('class')).includes('diff-zero'));
 await page.locator('[data-search-mode=seat]').click();await page.locator('#machineSearch').fill('562');await page.locator('#searchBtn').click();await page.locator('.seat[data-seat="562"]').click();assert.equal(await page.locator('.chart-point').count(),0);assert.match(await page.locator('#detailDiffChart').innerText(),/データがありません/);await page.locator('[data-close-detail]').click();
 await page.locator('[data-search-mode=machine]').click();assert(!(await page.locator('#detailData').isVisible()));assert(!new URL(page.url()).searchParams.has('seat'));
 // Null orientation must not be treated as a real heading; valid heading rotates the map.
 await page.evaluate(()=>{window.DeviceOrientationEvent=function(){};});await page.locator('#phoneOrientationBtn').click();await page.evaluate(()=>{const e=new Event('deviceorientation');Object.assign(e,{alpha:null,webkitCompassHeading:null});window.dispatchEvent(e)});assert.match(await page.locator('#phoneOrientationStatus').textContent(),/基準設定中/);
 await page.evaluate(()=>{for(const alpha of [0,90]){const e=new Event('deviceorientation');Object.assign(e,{alpha});window.dispatchEvent(e)}});await page.waitForFunction(()=>document.querySelector('#mapContent').getAttribute('transform').includes('rotate'));
 await page.locator('#zoomIn').click();const before=await page.locator('#floorMap').getAttribute('viewBox');await page.evaluate(()=>{window.dispatchEvent(new Event('beforeprint'))});assert.equal(await page.locator('#mapContent').getAttribute('transform'),'');await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('#floorMap').getAttribute('viewBox'),before);
 await page.locator('#phoneOrientationBtn').click();
 // Every HTML route renders and shared hall listing searches work.
 for(const route of ['','halls/','about.html','contact.html','privacy.html','terms.html','404.html','offline.html']){await page.goto('http://floor777.test/floor777/'+route);if(route===''||route==='halls/'){await page.waitForSelector('.hall-card');await page.locator('#hallSearch').fill('存在しない店');assert.equal(await page.locator('#hallList .hall-card').count(),0)}await assertNoOverflow()}
 noStats=true;await open();await page.locator('[data-screen=recommend]').click();assert.match(await page.locator('#recommendedList').innerText(),/読み込めません/);assert(!(await page.locator('#loadError').isVisible()));noStats=false;
 // Storage corruption / denied storage must not crash the app.
 await page.evaluate(()=>{localStorage.setItem('floor777:favorites:v1','{}');localStorage.setItem('floor777:recent:v1','null')});await open();
 await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})});await open();await page.locator('[data-screen=picks]').click();await page.locator('#bulkSeats').fill('561');await page.locator('#bulkForm button').click();assert.match(await page.locator('#pickSaveStatus').textContent(),/保存できません/);
 assert.deepEqual(errors,[]);
 console.log('PASS: 551-seat map; real tap; fullwidth search; recommendations & independent missing values; shortlist autosave/reload/order/export/import/delete; 320–1440px overflow; null graph and orientation; print restoration; all pages; unavailable stats and denied storage.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
