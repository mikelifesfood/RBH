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
    // Only a fixed, versioned event-type catalogue can influence lock-screen copy.
    // Ignore untrusted titles, descriptions and URLs, including report-specific details.
    const messages=Object.freeze({
      new_report:['New safety report','A safety report is ready for review.'],
      report_owner_assignment:['Report assigned','A report has been assigned to you.'],
      action_assignment:['Corrective action assigned','You have a corrective action to complete.'],
      corrective_action_assignment:['Corrective action assigned','You have a corrective action to complete.'],
      corrective_action_verification_requested:['Verification required','A corrective action is ready for review.'],
      corrective_action_changes_requested:['Changes requested','Your corrective action needs attention.']
    });
    let tag='rbh-safety-work',copy=null;
    try{
      const data=event.data?event.data.json():null;
      if(data&&typeof data.tag==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(data.tag))tag='rbh-'+data.tag;
      if(data&&typeof data.type==='string'&&Object.prototype.hasOwnProperty.call(messages,data.type))
        copy=messages[data.type];
    }catch(_){}
    await self.registration.showNotification(copy?copy[0]:'RBH Safety',{
      body:copy?copy[1]:'You have a safety item requiring attention. Sign in to review.',
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
    target.hash='notifications'; // Safe fallback: no report/action IDs in the URL.
    const tag=event.notification&&event.notification.tag||'';
    const eventId=/^rbh-([a-f0-9]{32})$/.exec(tag);
    const notifyClient=client=>{
      if(eventId&&client&&typeof client.postMessage==='function')
        client.postMessage({type:'RBH_PUSH_OPEN',eventKey:eventId[1]});
    };
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>{
      try{const u=new URL(client.url);return u.origin===SCOPE.origin&&u.pathname===target.pathname;}catch(_){return false;}
    });
    if(existing){await existing.focus();notifyClient(existing);return;}
    if(self.clients.openWindow){const opened=await self.clients.openWindow(target.href);notifyClient(opened);}
  })());
});
