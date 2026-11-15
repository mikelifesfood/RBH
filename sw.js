/* RBH Safety PWA Build 4 — deliberately narrow service worker.
 * Cache only public, non-sensitive app shell resources.
 * Never cache dashboard HTML, Supabase responses, Auth tokens, images uploaded
 * to Storage, incident records or POST/PUT/PATCH/DELETE requests.
 */
const CACHE_NAME = 'rbh-public-shell-v6-20261115';
const SCOPE = new URL(self.registration.scope);
const FORM = new URL('index.html', SCOPE);
const OFFLINE = new URL('offline.html', SCOPE);
const ASSETS = [
  FORM.href, OFFLINE.href,
  new URL('pwa-client.js',SCOPE).href,
  new URL('offline-queue.js',SCOPE).href,
  new URL('icons/icon-192.png',SCOPE).href,
  new URL('icons/icon-512.png',SCOPE).href,
  new URL('icons/apple-touch-icon.png',SCOPE).href
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('rbh-public-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==SCOPE.origin)return;
  // These safe static assets must be readable offline as well as the HTML shell.
  // In particular pwa-client.js supplies the explicit no-offline-submission notice.
  if(ASSETS.includes(url.href)&&url.pathname!==FORM.pathname&&url.pathname!==OFFLINE.pathname){
    event.respondWith(caches.match(url.href).then(cached=>cached||fetch(req)));
    return;
  }
  if(req.mode!=='navigate')return;
  // Query parameters can contain an opaque site token, never use query as cache key.
  const publicForm=url.pathname===SCOPE.pathname||url.pathname===FORM.pathname;
  const staffDashboard=url.pathname===new URL('dashboard.html',SCOPE).pathname;
  if(!publicForm&&!staffDashboard)return;

  event.respondWith((async()=>{
    try{
      const response=await fetch(req);
      if(publicForm&&response.ok&&response.type==='basic'){
        const cache=await caches.open(CACHE_NAME);
        await cache.put(FORM.href,response.clone());
      }
      return response;
    }catch(error){
      if(publicForm){
        const shell=await caches.match(FORM.href);
        if(shell)return shell;
      }
      const page=await caches.match(OFFLINE.href);
      if(page)return page;
      return new Response('Offline. Connect to the internet before using RBH Safety.',{
        status:503,headers:{'Content-Type':'text/plain;charset=utf-8','Cache-Control':'no-store'}
      });
    }
  })());
});
