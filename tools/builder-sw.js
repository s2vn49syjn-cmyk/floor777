self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('f777-island-builder-v2-'))await caches.delete(key);await self.registration.unregister();})()));
