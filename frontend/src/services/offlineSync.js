// Sincronización automática de ventas pendientes offline
import api, { isNetworkError } from './api'
import { getVentasPendientes, borrarVentaPendiente } from './offlineDB'

let syncing = false

export async function syncVentasPendientes() {
  if (syncing) return { synced: 0, failed: 0, descartadas: 0 }
  syncing = true

  let synced = 0
  let failed = 0
  let descartadas = 0

  try {
    const pendientes = await getVentasPendientes()
    if (pendientes.length === 0) return { synced: 0, failed: 0, descartadas: 0 }

    for (const venta of pendientes) {
      try {
        const { id, _timestamp, ...payload } = venta
        if (_timestamp) payload.created_at_offline = new Date(_timestamp).toISOString()
        await api.post('/api/pos/ventas', payload)
        await borrarVentaPendiente(id)
        synced++
      } catch (err) {
        // Sin red: parar sync, dejar en cola para reintentar después
        if (isNetworkError(err)) {
          failed++
          break
        }
        // Auth expirada: parar sync
        if (err.response?.status === 401) {
          failed++
          break
        }
        // Error de validación (400/422): descartar de la cola, no tiene sentido reintentar
        const status = err.response?.status
        if (status === 400 || status === 422) {
          console.error(`[OfflineSync] Venta descartada (${status}):`, err.response?.data?.error || err.message)
          await borrarVentaPendiente(venta.id)
          descartadas++
          continue
        }
        // Error 5xx del servidor: parar sync, reintentar después
        failed++
        break
      }
    }
  } finally {
    syncing = false
  }

  return { synced, failed, descartadas }
}

// Escuchar evento online para auto-sync
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncVentasPendientes().then(({ synced }) => {
      if (synced > 0) {
        console.log(`[OfflineSync] ${synced} venta(s) sincronizada(s) automáticamente`)
      }
    })
  })
}
