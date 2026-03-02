import { precacheAndRoute } from 'workbox-precaching'

// Precaching de assets generados por Vite
precacheAndRoute(self.__WB_MANIFEST)

// Offline fallback: si la navegación falla (sin conexión), mostrar página offline
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Sin conexión - Padano SRL</title>
          <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#374151;text-align:center}
          .c{max-width:320px;padding:2rem}.t{font-size:2.5rem;margin-bottom:1rem}.btn{margin-top:1.5rem;padding:0.75rem 1.5rem;background:#2563eb;color:#fff;border:none;border-radius:0.75rem;font-size:0.875rem;cursor:pointer}</style></head>
          <body><div class="c"><div class="t">Sin conexión</div><p>No hay conexión a internet. Revisá tu conexión e intentá de nuevo.</p>
          <button class="btn" onclick="location.reload()">Reintentar</button></div></body></html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
    )
  }
})

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
