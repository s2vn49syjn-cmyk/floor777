const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');const server=spawn('python3',['-m','http.server','8777','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});let browser;
 const url='http://127.0.0.1:8777/tools/hall-editor.html';
 try{
  for(let i=0;i<40;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));
  async function fill(id,value){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).blur();}
  async function saved(){await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));}
  await fill('name','検証用店舗');await fill('id','builder-test');await fill('city','堺市');
  await page.locator('[data-add=line]').click();await fill('count',5);await page.locator('#confirmed').check();await page.locator('#applyGeometry').click();await saved();
  assert.equal(await page.locator('.seat').count(),5);
  await page.locator('#fieldMode').click();await fill('startNumber',101);await page.locator('#numberDetails').evaluate(e=>e.open=true);await fill('skipNumbers',104);await page.locator('#assign').click();await saved();
  assert.deepEqual(await page.locator('.seat-label').allTextContents(),['101','102','103','105','106']);
  await page.locator('#homeMode').click();await page.locator('[data-add=arc]').click();await fill('count',3);await fill('x',750);await fill('y',400);await page.locator('#confirmed').check();await page.locator('#applyGeometry').click();await saved();
  await page.locator('#fieldMode').click();await fill('startNumber',102);await page.locator('#assign').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('重複'));
  await fill('startNumber',201);await page.locator('#reverse').selectOption('reverse');await page.locator('#assign').click();await saved();
  assert.deepEqual((await page.locator('.seat-label').allTextContents()).slice(5),['203','202','201']);
  await page.locator('#check').click();assert.equal(await page.locator('#reportExport').isDisabled(),false);await page.locator('#closeReport').click();
  const dl=page.waitForEvent('download');await page.locator('#export').click();const download=await dl;assert(download.suggestedFilename().endsWith('.zip'));await download.saveAs('/tmp/builder-browser.zip');
  // Reload the entire app without network. Geometry and numbering must survive.
  await page.waitForFunction(()=>document.querySelector('#offlineState').textContent.includes('利用できます'));
  await page.reload();await saved();await context.setOffline(true);await page.reload();await saved();assert.equal(await page.locator('.seat').count(),8);
  assert((await page.locator('#network').textContent()).includes('オフライン'));
  await page.locator('#islandSelect').selectOption({index:0});await fill('startNumber',301);await page.locator('#assign').click();await saved();await page.reload();await saved();assert((await page.locator('.seat-label').allTextContents()).includes('301'));await context.setOffline(false);
  // Number-free export doesn't mutate the current project.
  const layoutDl=page.waitForEvent('download');await page.locator('#saveLayout').click();const layout=await layoutDl;const layoutPath=await layout.path();const blank=JSON.parse(fs.readFileSync(layoutPath));assert(blank.islands.every(i=>!i.numbers.length));assert((await page.locator('.seat-label').allTextContents()).includes('301'));
  await page.locator('#importFile').setInputFiles({name:'layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(blank))});await saved();await page.waitForFunction(()=>document.querySelectorAll('.project-card').length===2);assert((await page.locator('.seat-label').allTextContents()).every(t=>t==='·'));
  assert(await page.locator('#undo').isDisabled());
  await page.locator('#newProject').click();await saved();assert.equal(await page.locator('.seat').count(),0);
  // A real colored image exercises canvas decoding, worker detection and preview.
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;const x=c.getContext('2d');x.fillStyle='#eee';x.fillRect(0,0,600,400);x.fillStyle='#168aff';x.fillRect(100,60,25,220);x.fillStyle='#dc3c56';x.beginPath();x.arc(360,190,90,0,Math.PI*2);x.lineWidth=18;x.strokeStyle='#dc3c56';x.stroke();return c.toDataURL('image/png').split(',')[1];});
  await page.locator('#imageFile').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await saved();await page.locator('#detect').click();await page.locator('#candidates').waitFor({state:'visible'});assert(await page.locator('.candidate-row').count()>=2);await page.locator('#acceptCandidates').click();await saved();assert(await page.locator('.seat').count()>0);
  await page.reload();await saved();assert((await page.locator('#underlay').getAttribute('href')).startsWith('data:image/'));
  // Desktop layout, mobile field workflow and no horizontal overflow.
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/builder-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#fieldMode').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:path.join(root,'test-results/builder-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: PC/mobile UI, numbering/skips/reverse/duplicates, ZIP, image detection, multiple projects, offline reload and IndexedDB restoration');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
