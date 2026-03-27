import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// Precaching de assets generados por Vite
precacheAndRoute(self.__WB_MANIFEST)

// NetworkFirst cache para rutas POS (safety net adicional al IndexedDB del frontend)
const POS_API_PATTERNS = [
  /\/api\/pos\/articulos/,
  /\/api\/pos\/promociones/,
  /\/api\/clientes/,
  /\/api\/denominaciones/,
  /\/api\/formas-cobro/,
]

POS_API_PATTERNS.forEach(pattern => {
  registerRoute(
    ({ url }) => pattern.test(url.pathname),
    new NetworkFirst({
      cacheName: 'pos-api-cache',
      networkTimeoutSeconds: 5,
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
      ],
    })
  )
})

// Offline fallback para navegación: servir index.html cacheado (SPA)
// precacheAndRoute ya cachea index.html — este handler solo actúa si falla el fetch
import { NavigationRoute, createHandlerBoundToURL } from 'workbox-routing'
const navHandler = createHandlerBoundToURL('/index.html')
registerRoute(new NavigationRoute(navHandler))

// Push notification listener
self.addEventListener('push', (event) => {
  let data = { title: 'Padano SRL', body: 'Nueva notificación' }

  try {
    if (event.data) {
      data = event.data.json()
    }
  } catch {
    // Si no es JSON válido, usar defaults
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-192x192.svg',
      vibrate: [200, 100, 200],
      data: { url: '/pedidos' },
    })
  )
})

// Click en la notificación: abrir/focar la app en /pedidos
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const urlToOpen = new URL('/pedidos', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta, focarla y navegar
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          client.navigate(urlToOpen)
          return client.focus()
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      return self.clients.openWindow(urlToOpen)
    })
  )
})
