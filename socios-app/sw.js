/* ==========================================================================
   MIA GENDA · programa de fondo (service worker)

   Hace tres cosas:
     1. Guarda la app para que se abra aunque no haya conexión.
     2. Recibe los avisos de la nube y los enseña, aunque la app esté cerrada.
     3. Al tocar un aviso, abre (o trae al frente) la app.

   No toca tus datos: lo que va y viene de la nube pasa directo, sin guardarse aquí.
   ========================================================================== */
const VERSION = 'mia-genda-2.0.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/badge.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('mia-genda-') && n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** La página de la app: primero la red (para tener siempre la última versión) y, si tarda o no hay, la copia guardada. */
async function appPage(request) {
  const cache = await caches.open(VERSION);
  const saved = (await cache.match('./index.html')) || (await cache.match('./'));
  // 'no-cache': se pregunta siempre al servidor si hay versión nueva, sin fiarse de la copia
  // que el navegador guarda por su cuenta (el servidor le deja guardarla unos minutos).
  const fresh = fetch(request, { cache: 'no-cache' })
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put('./index.html', res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (!saved) return (await fresh) || new Response('Sin conexión. Vuelve a abrir Mia Genda cuando tengas Internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const first = await Promise.race([fresh, wait(3500).then(() => 'tarde')]);
  if (first && first !== 'tarde' && first.ok) return first;
  return saved;
}

/** Iconos y demás archivos fijos: la copia guardada al instante, y se renueva por detrás. */
async function staticFile(request) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(request);
  // Las fotos del cielo y los fondos de serie no cambian: si ya están guardados, no hace falta volver a pedirlos.
  if (saved && /\/(fondos|tableros|columnas)\//.test(request.url)) return saved;
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return saved || (await fresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // la nube y lo demás: directo a Internet
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (url.pathname.includes('/ayudante/') || url.pathname.includes('/pro/') || url.pathname.includes('/socios-app/') || url.pathname.endsWith('/sw.js')) return; // /pro/: la página de descargas de Mia Genda Pro
  if (url.pathname.endsWith('.php') || url.pathname.endsWith('.json')) return; // servidor de socios de AIAO (api.php, admin.php…) y listas de archivos: siempre a la red
  const isPage = request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  event.respondWith(isPage ? appPage(request) : staticFile(request));
});

/* ---------- Avisos ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Mia Genda';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge.png',
    lang: 'es',
    data: { url: data.url || '' },
  };
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const target = new URL((event.notification.data && event.notification.data.url) || './', scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(scope) && 'focus' in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

// Si el navegador renueva el permiso de avisos, se vuelve a pedir con los mismos datos.
// La app apunta la nueva dirección en la nube la próxima vez que se abre.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        if (old && old.options) await self.registration.pushManager.subscribe(old.options);
      } catch (e) {
        /* se arreglará al abrir la app */
      }
    })(),
  );
});
