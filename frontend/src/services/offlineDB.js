// IndexedDB wrapper para POS offline — usa librería 'idb'
import { openDB } from 'idb'

const DB_NAME = 'padano-pos'
const DB_VERSION = 2

function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('articulos')) {
        db.createObjectStore('articulos', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('clientes')) {
        db.createObjectStore('clientes', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('promociones')) {
        db.createObjectStore('promociones', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('denominaciones')) {
        db.createObjectStore('denominaciones', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('formasCobro')) {
        db.createObjectStore('formasCobro', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('ventasPendientes')) {
        db.createObjectStore('ventasPendientes', { autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('empleadosPIN')) {
        db.createObjectStore('empleadosPIN', { keyPath: 'id' })
      }
    },
  })
}

// --- Artículos ---
export async function guardarArticulos(items) {
  const db = await getDB()
  const tx = db.transaction('articulos', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_articulos', Date.now())
}

export async function getArticulos() {
  const db = await getDB()
  return db.getAll('articulos')
}

// --- Clientes ---
export async function guardarClientes(items) {
  const db = await getDB()
  const tx = db.transaction('clientes', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_clientes', Date.now())
}

export async function getClientes(busqueda) {
  const db = await getDB()
  const todos = await db.getAll('clientes')
  if (!busqueda || !busqueda.trim()) return todos
  const term = busqueda.toLowerCase().trim()
  return todos.filter(c => {
    const texto = `${c.razon_social || ''} ${c.cuit || ''} ${c.codigo || ''}`.toLowerCase()
    return texto.includes(term)
  })
}

// --- Promociones ---
export async function guardarPromociones(items) {
  const db = await getDB()
  const tx = db.transaction('promociones', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_promociones', Date.now())
}

export async function getPromociones() {
  const db = await getDB()
  return db.getAll('promociones')
}

// --- Denominaciones ---
export async function guardarDenominaciones(items) {
  const db = await getDB()
  const tx = db.transaction('denominaciones', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_denominaciones', Date.now())
}

export async function getDenominaciones() {
  const db = await getDB()
  return db.getAll('denominaciones')
}

// --- Formas de cobro ---
export async function guardarFormasCobro(items) {
  const db = await getDB()
  const tx = db.transaction('formasCobro', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_formasCobro', Date.now())
}

export async function getFormasCobro() {
  const db = await getDB()
  return db.getAll('formasCobro')
}

// --- Ventas pendientes (cola offline) ---
export async function encolarVenta(payload) {
  const db = await getDB()
  await db.add('ventasPendientes', { ...payload, _timestamp: Date.now() })
}

export async function getVentasPendientes() {
  const db = await getDB()
  const tx = db.transaction('ventasPendientes', 'readonly')
  const items = []
  let cursor = await tx.store.openCursor()
  while (cursor) {
    items.push({ id: cursor.key, ...cursor.value })
    cursor = await cursor.continue()
  }
  return items.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0))
}

export async function contarVentasPendientes() {
  const db = await getDB()
  return db.count('ventasPendientes')
}

export async function borrarVentaPendiente(id) {
  const db = await getDB()
  await db.delete('ventasPendientes', id)
}

// --- Empleados PIN (para login offline) ---
export async function guardarEmpleadosPIN(items) {
  const db = await getDB()
  const tx = db.transaction('empleadosPIN', 'readwrite')
  await tx.store.clear()
  for (const item of items) {
    await tx.store.put(item)
  }
  await tx.done
  await setMeta('lastSync_empleadosPIN', Date.now())
}

export async function getEmpleadosPIN() {
  const db = await getDB()
  return db.getAll('empleadosPIN')
}

// --- Meta (timestamps de sync) ---
export async function setMeta(key, value) {
  const db = await getDB()
  await db.put('meta', { key, value })
}

export async function getMeta(key) {
  const db = await getDB()
  const entry = await db.get('meta', key)
  return entry?.value ?? null
}
