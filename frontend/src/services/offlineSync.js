// Sincronización automática de colas offline (ventas, consumo interno, cierres)
import api, { isNetworkError } from './api'
import { getVentasPendientes, borrarVentaPendiente } from './offlineDB'
import { getConsumoPendiente, borrarConsumoPendiente } from './offlineDB'
import { getCierresPendientes, borrarCierrePendiente } from './offlineDB'

let syncing = false

// Sync genérico para cualquier cola offline
async function syncCola(nombre, getItems, borrarItem, enviar) {
  let synced = 0
  let failed = 0
  let descartadas = 0

  const pendientes = await getItems()
  if (pendientes.length === 0) return { synced, failed, descartadas }

  for (const item of pendientes) {
    try {
      await enviar(item)
      await borrarItem(item.id)
      synced++
    } catch (err) {
      if (isNetworkError(err)) {
        failed++
        break
      }
      if (err.response?.status === 401) {
        failed++
        break
      }
      const status = err.response?.status
      if (status === 400 || status === 422) {
        console.error(`[OfflineSync] ${nombre} descartado (${status}):`, err.response?.data?.error || err.message)
        await borrarItem(item.id)
        descartadas++
        continue
      }
      failed++
      break
    }
  }

  return { synced, failed, descartadas }
}

export async function syncVentasPendientes() {
  if (syncing) return { synced: 0, failed: 0, descartadas: 0 }
  syncing = true
  try {
    return await syncCola('Venta', getVentasPendientes, borrarVentaPendiente, async (venta) => {
      const { id, _timestamp, ...payload } = venta
      if (_timestamp) payload.created_at_offline = new Date(_timestamp).toISOString()
      await api.post('/api/pos/ventas', payload)
    })
  } finally {
    syncing = false
  }
}

export async function syncConsumoPendiente() {
  return syncCola('Consumo', getConsumoPendiente, borrarConsumoPendiente, async (item) => {
    const { id, _timestamp, ...payload } = item
    await api.post('/api/compras/consumo-interno', payload)
  })
}

export async function syncCierresPendientes() {
  return syncCola('Cierre', getCierresPendientes, borrarCierrePendiente, async (item) => {
    const { id, _timestamp, cierreId, ...payload } = item
    await api.put(`/api/cierres-pos/${cierreId}/cerrar`, payload)
  })
}

// Sync completo de todas las colas
export async function syncAll() {
  const ventas = await syncVentasPendientes()
  const consumo = await syncConsumoPendiente()
  const cierres = await syncCierresPendientes()

  const totalSynced = ventas.synced + consumo.synced + cierres.synced
  if (totalSynced > 0) {
    console.log(`[OfflineSync] Sincronizado: ${ventas.synced} ventas, ${consumo.synced} consumos, ${cierres.synced} cierres`)
  }

  return { ventas, consumo, cierres }
}

// Escuchar evento online para auto-sync
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncAll()
  })
}
