const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const handlers={},store=new Map(),deleted=[];let response=new Response('fresh',{status:200}),offline=false,quota=false;
 const scope='https://example.test/floor777/';
 const cache={addAll:async()=>{},match:async key=>store.get(String(key))?.clone(),put:async(key,r)=>{if(quota)throw Error('quota');store.set(String(key),r.clone())}};
 const ctx={URL,Response,self:{registration:{scope},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['floor777-old','another-app'],delete:async k=>deleted.push(k)},fetch:async()=>{if(offline)throw Error('offline');return response.clone()}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../service-worker.js','utf8'),ctx);
 let activation;handlers.activate({waitUntil:p=>activation=p});await activation;assert.deepEqual(deleted,['floor777-old']);
 async function request(url,mode='cors'){let p;handlers.fetch({request:{url,method:'GET',mode},respondWith:r=>p=r});return p;}
 assert.equal(await (await request(scope+'assets/app.js?v=1')).text(),'fresh');assert(store.has(scope+'assets/app.js'));
 offline=true;assert.equal(await (await request(scope+'assets/app.js?v=2')).text(),'fresh');
 store.set(scope+'offline.html',new Response('offline page'));assert.equal(await (await request(scope+'new-page/','navigate')).text(),'offline page');assert.equal((await request(scope+'missing.json')).type,'error');
 offline=false;response=new Response('bad',{status:500});assert.equal(await (await request(scope+'assets/app.js')).text(),'fresh');
 response=new Response('newest');quota=true;assert.equal(await (await request(scope+'assets/app.js')).text(),'newest');assert.equal(await request('https://example.test/another-site/a.js'),undefined);
 console.log('PASS: cache version queries, network failure/500 fallback, quota errors, HTML-only offline fallback and sibling-site cache isolation.');
})().catch(e=>{console.error(e);process.exit(1)});
