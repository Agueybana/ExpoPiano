// service-worker.js (v3 cache-bust to add AI module)
const CACHE = 'starlight-piano-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/utils.js',
  './js/theme.js',
  './js/midi.js',
  './js/audio.js',
  './js/piano.js',
  './js/renderer.js',
  './js/timeline.js',
  './js/settings.js',
  './js/ai.js' // NEW: cache AI
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

function fromNetworkFirst(request){
  return fetch(request).then(resp=>{
    const copy = resp.clone();
    caches.open(CACHE).then(cache=>cache.put(request, copy)).catch(()=>{});
    return resp;
  }).catch(()=>{
    return caches.match(request);
  });
}

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // For JS/CSS/HTML, try network first to pick up dev iterations; fall back to cache.
  if(url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.html')){
    e.respondWith(fromNetworkFirst(e.request));
    return;
  }
  // Default: cache-first
  e.respondWith(caches.match(e.request).then(r=>r || fetch(e.request)));
});
