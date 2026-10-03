const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'};
function pages(dir=root){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(['.git','node_modules','test-results','hall-output','playwright-report'].includes(e.name)?[]:pages(path.join(dir,e.name))):e.name.endsWith('.html')?[path.join(dir,e.name)]:[])}
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname);try{res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end('not found')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}: {})});
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage();await page.goto(base+'/site.webmanifest');
  const assets=new Map();
  for(const file of pages()){
   const links=await page.evaluate(html=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('link')].map(x=>({rel:x.rel,href:x.getAttribute('href'),sizes:x.getAttribute('sizes'),type:x.type})),fs.readFileSync(file,'utf8'));
   for(const rel of ['apple-touch-icon','icon','manifest']){
    const matches=links.filter(x=>x.rel===rel);assert.equal(matches.length,1,`${file}: exactly one ${rel}`);
    const link=matches[0];assert(link.href.startsWith('/'),`${file}: root-relative ${rel}`);
    const resolved=new URL(link.href,base+'/'+path.relative(root,file));assert.equal(resolved.origin,base);
    assets.set(resolved.href,rel==='apple-touch-icon'?180:rel==='icon'?192:0);
   }
  }
  const manifestLink=[...assets].find(([,size])=>size===0)[0];const response=await fetch(manifestLink);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/manifest\+json/);
  const manifest=await response.json();assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/');
  assert.deepEqual(manifest.icons.map(x=>x.sizes).sort(),['192x192','512x512']);
  for(const icon of manifest.icons){assert.equal(icon.type,'image/png');assert.equal(icon.purpose,'any');assets.set(new URL(icon.src,manifestLink).href,parseInt(icon.sizes))}
  for(const [url,size] of assets){if(!size)continue;const r=await fetch(url);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^image\/png/);assert.deepEqual([...new Uint8Array(await r.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
   const pixels=await page.evaluate(async({url})=>{const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let red=0,transparent=0;for(let i=0;i<d.length;i+=4){if(d[i]>150&&d[i]-d[i+1]>80&&d[i]-d[i+2]>60)red++;if(d[i+3]!==255)transparent++}return {width:im.width,height:im.height,red,transparent}},{url});
   assert.equal(pixels.width,size);assert.equal(pixels.height,size);assert(pixels.red>size*size*.005,`${url}: retain red brand accents`);assert.equal(pixels.transparent,0);
  }
  assert.equal((await fetch(base+'/assets/icons/does-not-exist.png')).status,404);
  console.log(`PASS: ${pages().length} HTML pages; root-relative touch/favicon/manifest; HTTP status/MIME; 180/192/512 PNG decoding, opaque pixels and red accents; missing icon 404.`);
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
