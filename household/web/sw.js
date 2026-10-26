const VERSION='household-shell-1';
const ASSETS=['/','/index.html','/app.js','/app.css','/focus.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/v1/'))return;
  if(!ASSETS.includes(url.pathname)&&event.request.mode!=='navigate')return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request.mode==='navigate'?'/':event.request)));
});
