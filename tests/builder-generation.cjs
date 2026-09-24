const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),server=spawn(process.env.PYTHON_PATH||'python3',['-m','http.server','8778','--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
 let browser;
 try{
  const url='http://127.0.0.1:8778/tools/hall-editor.html';
  for(let i=0;i<50;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,400);x.fillStyle='#222';x.fillRect(60,60,18,260);x.fillStyle='#165fee';x.fillRect(120,60,18,260);x.strokeStyle='#c020a0';x.lineWidth=16;x.beginPath();x.arc(380,190,85,0,Math.PI*2);x.stroke();return c.toDataURL().split(',')[1];});
  let files=[{name:'sample.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')},{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not a PNG')}];
  if(process.env.MAP_INPUT_DIR)files=fs.readdirSync(process.env.MAP_INPUT_DIR).filter(f=>/\.(jpg|png|webp)$/i.test(f)).map(f=>path.join(process.env.MAP_INPUT_DIR,f));
  await page.locator('#batchFiles').setInputFiles(files);
  await page.waitForFunction(()=>document.querySelector('#batchMessage').textContent.includes('店舗を保存'),{},{timeout:120000});
  const projects=await page.evaluate(async()=>{const m=await import('./builder-store.mjs');return (await m.listProjects()).filter(p=>p.image);});
  assert.equal(projects.length,process.env.MAP_INPUT_DIR?files.length:1);
  for(const p of projects){assert(p.islands.length>0);assert(p.islands.every(i=>!i.confirmed&&!i.numbers.length));assert(p.islands.flatMap(i=>i.points).every(q=>q.every(Number.isFinite)));}
  if(!process.env.MAP_INPUT_DIR)assert((await page.locator('#batchMessage').textContent()).includes('broken.png'));
  const imported=await page.evaluate(async projects=>{const m=await import('./builder-model.mjs');return projects.map(p=>m.importProject(p).islands.length);},projects);assert.deepEqual(imported,projects.map(p=>p.islands.length));
  if(process.env.MAP_OUTPUT_DIR){fs.mkdirSync(process.env.MAP_OUTPUT_DIR,{recursive:true});for(const [i,p]of projects.entries())fs.writeFileSync(path.join(process.env.MAP_OUTPUT_DIR,`${i+1}-project.json`),JSON.stringify(p));}
  // Generated paths remain editable; changing count survives save and reload.
  const first=projects[0].islands[0].count;
  await page.locator('#count').fill(String(first+2));await page.locator('#applyGeometry').click();
  await page.waitForFunction(n=>document.querySelector('#numberCount').value===String(n),first+2);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));
  assert.equal(await page.locator('#count').inputValue(),String(first+2));
  // Region selection is stored, undoable, and copied through JSON import.
  await page.locator('#selectRegion').click();const b=await page.locator('#map').boundingBox();
  await page.mouse.move(b.x+b.width*.3,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.7);await page.mouse.up();
  assert.equal(await page.locator('#regionState').textContent(),'指定範囲だけ生成');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('自動保存済み'));
  await page.evaluate(async()=>{const s=await import('./builder-store.mjs'),m=await import('./builder-model.mjs');const p=(await s.listProjects()).find(p=>p.detectionRegion);if(!p||!m.importProject(p).detectionRegion)throw Error('region lost');});
  await page.locator('#undo').click();assert.equal(await page.locator('#regionState').textContent(),'画像全体を生成');
  const cancelled=await page.evaluate(async()=>{const m=await import('./builder-import.mjs');const c=new AbortController();c.abort();return m.generateProjects([new File(['x'],'x.png',{type:'image/png'})],{signal:c.signal,onProject:()=>{throw Error('must not save')}});});assert(cancelled.cancelled);assert.equal(cancelled.created.length,0);
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/builder-generation.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS: batch save, invalid image isolation, editable counts, reload, JSON roundtrip, region selection/undo, cancellation, mobile layout',projects.map(p=>({name:p.name,rows:p.islands.length})));
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
