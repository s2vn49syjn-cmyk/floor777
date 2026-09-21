const CACHE='floor777-kikuya-sakai-20260920-1';
const CORE=['./halls/kikuya-sakai-honten/','./data/kikuya-sakai-honten.json','./data/positions-kikuya-sakai-honten.json','./','./index.html','./halls/','./halls/hyper-arrow-mihara/','./halls/super-cosmo-sakai/','./assets/styles.css','./assets/common.js','./assets/home.js','./assets/app.js','./assets/shortlist.js','./assets/ads.js','./assets/site-config.js','./data/halls.json','./data/hyper-arrow-mihara.json','./data/positions-mihara.json','./data/super-cosmo-sakai.json','./data/positions-super-cosmo-sakai.json','./offline.html'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('floor777-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  // Version query strings share one cache entry; HTML and data always try the network.
  const key=new URL(url);key.search='';
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(e.request,{cache:'no-cache'});
      if(response.ok){try{await cache.put(key.href,response.clone())}catch{}}
      else if(response.status>=500){const cached=await cache.match(key.href);if(cached)return cached;}
      return response;
    }catch{
      const cached=await cache.match(key.href);if(cached)return cached;
      if(e.request.mode==='navigate')return await cache.match(new URL('offline.html',scope).href)||Response.error();
      return Response.error();
    }
  })());
});
