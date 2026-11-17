/* RBH Safety PWA Build 4 — deliberately narrow service worker.
 * Cache only public, non-sensitive app shell resources.
 * Never cache dashboard HTML, Supabase responses, Auth tokens, images uploaded
 * to Storage, incident records or POST/PUT/PATCH/DELETE requests.
 */
const CACHE_NAME = 'rbh-public-shell-v18-20261117-push';
const SCOPE = new URL(self.registration.scope);
const FORM = new URL('index.html', SCOPE);
const OFFLINE = new URL('offline.html', SCOPE);
const ASSETS = [
  FORM.href, OFFLINE.href,
  new URL('pwa-client.js',SCOPE).href,
  new URL('turnstile-intake.js',SCOPE).href,
  new URL('offline-queue.js',SCOPE).href,
  new URL('icons/icon-192.png',SCOPE).href,
  new URL('icons/icon-512.png',SCOPE).href,
  new URL('icons/apple-touch-icon.png',SCOPE).href
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    await self.skipWaiting();
  })());
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
  // Cache-busting query strings are canonicalized to the safe static asset key.
  // JS scripts are network-first so a prior Safari cache cannot keep the old
  // "do not submit" handler after Build 5 has enabled offline submission.
  const staticKey=new URL(url.pathname,url.origin).href;
  if(ASSETS.includes(staticKey)&&url.pathname!==FORM.pathname&&url.pathname!==OFFLINE.pathname){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      try{
        const response=await fetch(req);
        if(response.ok&&response.type==='basic')await cache.put(staticKey,response.clone());
        return response;
      }catch(e){
        const cached=await cache.match(staticKey);
        if(cached)return cached;
        throw e;
      }
    })());
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

/* Staff-only web push: generic content, never report details or identifiers.
 * Backend controls delivery; this worker does not subscribe or send anything.
 */
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    const dashboard=new URL('dashboard.html',SCOPE);
    // The server sends only an opaque event tag. Ignore supplied title/body/URL.
    let tag='rbh-safety-work';
    try{
      const data=event.data?event.data.json():null;
      if(data&&typeof data.tag==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(data.tag))tag='rbh-'+data.tag;
    }catch(_){}
    await self.registration.showNotification('RBH Safety',{
      body:'You have a safety item requiring attention. Sign in to review.',
      icon:new URL('icons/icon-192.png',SCOPE).href,
      badge:new URL('icons/icon-192.png',SCOPE).href,
      tag,
      data:{url:dashboard.href},
      requireInteraction:false
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL('dashboard.html',SCOPE);
    // Never follow a notification-supplied URL or identify report/action in a URL.
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>{
      try{const u=new URL(client.url);return u.origin===SCOPE.origin&&u.pathname===target.pathname;}catch(_){return false;}
    });
    if(existing){await existing.focus();return;}
    if(self.clients.openWindow)await self.clients.openWindow(target.href);
  })());
});
