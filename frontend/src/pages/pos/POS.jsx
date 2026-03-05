// Punto de Venta — POS con motor de promociones local
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ModalCobrar from '../../components/pos/ModalCobrar'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

// Precio con descuentos base del artículo (no promo)
function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

// Verificar si un item del carrito matchea una regla aplicar_a
function itemMatcheaRegla(item, aplicarA) {
  if (!aplicarA || aplicarA.length === 0) return true
  for (const regla of aplicarA) {
    if (regla.tipo === 'todos') return true
    if (regla.tipo === 'articulo' && item.articulo.id === regla.id) return true
    if (regla.tipo === 'rubro' && item.articulo.rubro?.id === regla.id) return true
    if (regla.tipo === 'subrubro' && item.articulo.subRubro?.id === regla.id) return true
  }
  return false
}

// Verificar si la promo está dentro de rango de fechas
function promoEnRango(promo) {
  const hoy = new Date().toISOString().split('T')[0]
  if (promo.fecha_desde && hoy < promo.fecha_desde) return false
  if (promo.fecha_hasta && hoy > promo.fecha_hasta) return false
  return true
}

// Motor de promociones local
function calcularPromocionesLocales(carrito, promociones) {
  const aplicadas = []

  for (const promo of promociones) {
    if (!promo.activa || !promoEnRango(promo)) continue
    const reglas = promo.reglas || {}

    switch (promo.tipo) {
      case 'porcentaje': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const cantMin = reglas.cantidad_minima || 1
        if (cantidadTotal < cantMin) break
        const subtotalItems = itemsMatch.reduce((s, i) => s + calcularPrecioConDescuentosBase(i.articulo) * i.cantidad, 0)
        const descuento = subtotalItems * ((reglas.valor || 0) / 100)
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'porcentaje',
          detalle: `${reglas.valor}% off`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
        })
        break
      }

      case 'monto_fijo': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const cantMin = reglas.cantidad_minima || 1
        if (cantidadTotal < cantMin) break
        const cantidadQueCalifica = cantidadTotal
        const descuento = (reglas.valor || 0) * cantidadQueCalifica
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'monto_fijo',
          detalle: `${formatPrecio(reglas.valor)} off x${cantidadQueCalifica}`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
        })
        break
      }

      case 'nxm': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const llevar = reglas.llevar || 3
        const pagar = reglas.pagar || 2
        if (cantidadTotal < llevar) break
        const grupos = Math.floor(cantidadTotal / llevar)
        const unidadesGratis = grupos * (llevar - pagar)
        const precioMasBajo = Math.min(...itemsMatch.map(i => calcularPrecioConDescuentosBase(i.articulo)))
        const descuento = unidadesGratis * precioMasBajo
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'nxm',
          detalle: `${llevar}x${pagar} (${unidadesGratis} gratis)`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
        })
        break
      }

      case 'combo': {
        const articulosCombo = reglas.articulos || []
        if (articulosCombo.length < 2) break
        let combosPosibles = Infinity
        let sumaPreciosIndividuales = 0
        for (const artCombo of articulosCombo) {
          const enCarrito = carrito.find(i => i.articulo.id === artCombo.id)
          if (!enCarrito) { combosPosibles = 0; break }
          const cantRequerida = artCombo.cantidad || 1
          combosPosibles = Math.min(combosPosibles, Math.floor(enCarrito.cantidad / cantRequerida))
          sumaPreciosIndividuales += calcularPrecioConDescuentosBase(enCarrito.articulo) * cantRequerida
        }
        if (combosPosibles <= 0 || !isFinite(combosPosibles)) break
        const precioCombo = reglas.precio_combo || 0
        const descuento = (sumaPreciosIndividuales - precioCombo) * combosPosibles
        if (descuento <= 0) break
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'combo',
          detalle: `Combo x${combosPosibles}`,
          descuento,
          itemsAfectados: articulosCombo.map(a => a.id),
        })
        break
      }
    }
  }

  return aplicadas
}

// Paleta de colores para tiles por rubro
const TILE_COLORS = [
  { border: '#3B82F6', bg: '#EFF6FF', tab: '#3B82F6' },
  { border: '#10B981', bg: '#ECFDF5', tab: '#10B981' },
  { border: '#8B5CF6', bg: '#F5F3FF', tab: '#8B5CF6' },
  { border: '#F59E0B', bg: '#FFFBEB', tab: '#F59E0B' },
  { border: '#EC4899', bg: '#FDF2F8', tab: '#EC4899' },
  { border: '#14B8A6', bg: '#F0FDFA', tab: '#14B8A6' },
  { border: '#F97316', bg: '#FFF7ED', tab: '#F97316' },
  { border: '#6366F1', bg: '#EEF2FF', tab: '#6366F1' },
  { border: '#EF4444', bg: '#FEF2F2', tab: '#EF4444' },
  { border: '#06B6D4', bg: '#ECFEFF', tab: '#06B6D4' },
]

const POS = () => {
  const { usuario } = useAuth()

  // Estado cliente
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientesCentum, setClientesCentum] = useState([])
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const CLIENTE_DEFAULT = { id_centum: 0, razon_social: 'Consumidor Final', lista_precio_id: 1 }
  const [cliente, setCliente] = useState(CLIENTE_DEFAULT)

  // Estado artículos
  const [articulos, setArticulos] = useState([])
  const [cargandoArticulos, setCargandoArticulos] = useState(false)
  const [busquedaArt, setBusquedaArt] = useState('')

  // Carrito
  const [carrito, setCarrito] = useState([])

  // Promociones
  const [promociones, setPromociones] = useState([])
  const [cargandoPromos, setCargandoPromos] = useState(false)

  // Modal cobrar
  const [mostrarCobrar, setMostrarCobrar] = useState(false)

  // Carrito mobile toggle
  const [carritoVisible, setCarritoVisible] = useState(false)

  // Favoritos (persistidos en localStorage)
  const [favoritos, setFavoritos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_favoritos') || '[]')
    } catch { return [] }
  })

  // Categoría activa (tab seleccionado)
  const [categoriaActiva, setCategoriaActiva] = useState('todos')

  const inputBusquedaRef = useRef(null)

  // Cargar promos y artículos al montar (1 sola vez)
  useEffect(() => {
    cargarPromociones()
    cargarArticulos()
  }, [])

  async function cargarPromociones() {
    setCargandoPromos(true)
    try {
      const { data } = await api.get('/api/pos/promociones')
      setPromociones(data.promociones || [])
    } catch (err) {
      console.error('Error cargando promos:', err)
    } finally {
      setCargandoPromos(false)
    }
  }

  // Buscar clientes en Centum (debounced)
  useEffect(() => {
    if (!busquedaCliente.trim() || busquedaCliente.trim().length < 2) {
      setClientesCentum([])
      return
    }

    const timeout = setTimeout(async () => {
      setBuscandoClientes(true)
      try {
        const { data } = await api.get('/api/clientes', {
          params: { buscar: busquedaCliente.trim(), limit: 10 }
        })
        setClientesCentum(data.clientes || data.data || [])
      } catch (err) {
        console.error('Error buscando clientes:', err)
      } finally {
        setBuscandoClientes(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [busquedaCliente])

  // Cargar artículos desde DB local (precios minoristas, sync 1x/día)
  async function cargarArticulos() {
    setCargandoArticulos(true)
    try {
      const { data } = await api.get('/api/pos/articulos')
      setArticulos(data.articulos || [])
    } catch (err) {
      console.error('Error cargando artículos:', err)
      alert('Error al cargar artículos: ' + (err.response?.data?.error || err.message))
    } finally {
      setCargandoArticulos(false)
    }
  }

  function seleccionarCliente(cli) {
    setCliente({
      id_centum: cli.id_centum,
      razon_social: cli.razon_social,
      lista_precio_id: cli.lista_precio_id || 1,
    })
    setBusquedaCliente('')
    setClientesCentum([])
  }

  // Extraer rubros únicos de los artículos cargados
  const rubros = useMemo(() => {
    const map = new Map()
    articulos.forEach(a => {
      if (a.rubro?.nombre && !map.has(a.rubro.nombre)) {
        map.set(a.rubro.nombre, a.rubro)
      }
    })
    return Array.from(map.values())
  }, [articulos])

  // Mapa rubro -> color
  const rubroColorMap = useMemo(() => {
    const map = {}
    rubros.forEach((r, i) => {
      map[r.nombre] = TILE_COLORS[i % TILE_COLORS.length]
    })
    return map
  }, [rubros])

  // Toggle favorito
  const toggleFavorito = useCallback((articuloId, e) => {
    e.stopPropagation()
    setFavoritos(prev => {
      const next = prev.includes(articuloId)
        ? prev.filter(id => id !== articuloId)
        : [...prev, articuloId]
      localStorage.setItem('pos_favoritos', JSON.stringify(next))
      return next
    })
  }, [])

  // Filtrar artículos por búsqueda + categoría activa
  const articulosMostrados = useMemo(() => {
    let filtered = articulos

    if (busquedaArt.trim()) {
      const terminos = busquedaArt.toLowerCase().trim().split(/\s+/)
      filtered = articulos.filter(a => {
        const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
        return terminos.every(t => texto.includes(t))
      })
    } else if (categoriaActiva === 'favoritos') {
      filtered = articulos.filter(a => favoritos.includes(a.id))
    } else if (categoriaActiva !== 'todos') {
      filtered = articulos.filter(a => a.rubro?.nombre === categoriaActiva)
    }

    return filtered.slice(0, 60)
  }, [articulos, busquedaArt, categoriaActiva, favoritos])

  // Agregar al carrito
  const agregarAlCarrito = useCallback((articulo) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articulo.id)
      if (idx >= 0) {
        const nuevo = [...prev]
        nuevo[idx] = { ...nuevo[idx], cantidad: nuevo[idx].cantidad + 1 }
        return nuevo
      }
      return [...prev, { articulo, cantidad: 1 }]
    })
  }, [])

  const cambiarCantidad = useCallback((articuloId, delta) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevaCantidad = prev[idx].cantidad + delta
      if (nuevaCantidad <= 0) return prev.filter((_, i) => i !== idx)
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: nuevaCantidad }
      return nuevo
    })
  }, [])

  const quitarDelCarrito = useCallback((articuloId) => {
    setCarrito(prev => prev.filter(i => i.articulo.id !== articuloId))
  }, [])

  // Calcular totales — precio de Centum ya incluye IVA
  const { subtotal, descuentoTotal, total, promosAplicadas } = useMemo(() => {
    let sub = 0
    for (const item of carrito) {
      const precioBase = calcularPrecioConDescuentosBase(item.articulo)
      sub += precioBase * item.cantidad
    }

    const aplicadas = calcularPromocionesLocales(carrito, promociones)
    const descTotal = aplicadas.reduce((sum, p) => sum + p.descuento, 0)

    return {
      subtotal: sub,
      descuentoTotal: descTotal,
      total: sub - descTotal,
      promosAplicadas: aplicadas,
    }
  }, [carrito, promociones])

  function limpiarVenta() {
    setCarrito([])
    setCliente(CLIENTE_DEFAULT)
    setBusquedaArt('')
    setBusquedaCliente('')
  }

  function handleVentaExitosa() {
    setMostrarCobrar(false)
    setCarrito([])
    setBusquedaArt('')
  }

  const cantidadItems = carrito.reduce((s, i) => s + i.cantidad, 0)

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navbar titulo="Punto de Venta" sinTabs volverA="/apps" />

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ====== IZQUIERDA: PANEL CARRITO ====== */}
        <div className={`
          lg:w-[380px] xl:w-[420px] bg-white border-r flex flex-col flex-shrink-0
          ${carritoVisible ? 'fixed inset-0 z-20 lg:relative' : 'hidden lg:flex'}
        `}>
          {/* Barra cliente */}
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-1 rounded truncate">
                    {cliente.razon_social}
                  </span>
                  <span className="text-xs text-gray-400 flex-shrink-0">Lista {cliente.lista_precio_id}</span>
                </div>
                <div className="relative mt-2">
                  <input
                    type="text"
                    placeholder="Cambiar cliente..."
                    value={busquedaCliente}
                    onChange={e => setBusquedaCliente(e.target.value)}
                    className="w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                  />
                  {buscandoClientes && (
                    <div className="absolute right-2 top-1 text-gray-400 text-[10px]">Buscando...</div>
                  )}
                  {clientesCentum.length > 0 && (
                    <div className="absolute z-20 w-full bg-white border rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {clientesCentum.map(cli => (
                        <button
                          key={cli.id || cli.id_centum}
                          onClick={() => seleccionarCliente(cli)}
                          className="w-full text-left px-2 py-1.5 hover:bg-violet-50 text-xs border-b last:border-b-0"
                        >
                          <span className="font-medium">{cli.razon_social}</span>
                          {cli.cuit && <span className="text-gray-400 ml-1">CUIT: {cli.cuit}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Cerrar carrito (mobile) */}
              <button
                onClick={() => setCarritoVisible(false)}
                className="lg:hidden text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Items del carrito */}
          <div className="flex-1 overflow-y-auto">
            {carrito.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-300 text-sm">
                Carrito vacío
              </div>
            ) : (
              <div className="divide-y">
                {carrito.map(item => {
                  const precioUnit = calcularPrecioConDescuentosBase(item.articulo)
                  const lineTotal = precioUnit * item.cantidad
                  return (
                    <div key={item.articulo.id} className="px-3 py-2 hover:bg-gray-50/80">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate flex-1">{item.articulo.nombre}</span>
                        <span className="text-sm font-bold text-gray-800 flex-shrink-0">{formatPrecio(lineTotal)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, -1)}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-600 text-sm font-bold"
                          >−</button>
                          <span className="w-7 text-center text-sm font-semibold">{item.cantidad}</span>
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, 1)}
                            className="w-6 h-6 rounded bg-violet-100 hover:bg-violet-200 flex items-center justify-center text-violet-700 text-sm font-bold"
                          >+</button>
                        </div>
                        <span className="text-xs text-gray-400">{formatPrecio(precioUnit)} c/u</span>
                        <div className="flex-1" />
                        <button
                          onClick={() => quitarDelCarrito(item.articulo.id)}
                          className="text-red-300 hover:text-red-500 p-0.5"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Promos aplicadas */}
            {promosAplicadas.length > 0 && (
              <div className="px-3 py-2 space-y-1 border-t">
                {promosAplicadas.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-2 py-1 text-xs text-green-700">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                    <span className="flex-1 truncate">{p.promoNombre} ({p.detalle})</span>
                    <span className="font-semibold">-{formatPrecio(p.descuento)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totales + botones */}
          <div className="border-t bg-gray-50 px-4 py-3">
            <div className="space-y-0.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span>{formatPrecio(subtotal)}</span>
              </div>
              {descuentoTotal > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Descuentos</span>
                  <span>-{formatPrecio(descuentoTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-gray-800 pt-1 border-t">
                <span>TOTAL</span>
                <span>{formatPrecio(total)}</span>
              </div>
            </div>

            {carrito.length > 0 && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={limpiarVenta}
                  className="px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => setMostrarCobrar(true)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                >
                  Cobrar {formatPrecio(total)}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ====== DERECHA: PANEL PRODUCTOS ====== */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          {/* Buscador */}
          <div className="relative mb-3">
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputBusquedaRef}
              type="text"
              placeholder="Buscar artículo por nombre o código..."
              value={busquedaArt}
              onChange={e => setBusquedaArt(e.target.value)}
              className="w-full bg-white border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent shadow-sm"
              autoFocus
            />
            {cargandoArticulos && (
              <div className="absolute right-3 top-3 text-gray-400 text-xs">Cargando...</div>
            )}
          </div>

          {/* Tabs de categorías */}
          <div className="flex flex-wrap gap-2 mb-4">
            {/* Todos */}
            <button
              onClick={() => { setCategoriaActiva('todos'); setBusquedaArt('') }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                categoriaActiva === 'todos' && !busquedaArt
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'bg-white text-gray-600 hover:bg-gray-200 border border-gray-200'
              }`}
            >
              Todos
            </button>
            {/* Favoritos */}
            <button
              onClick={() => { setCategoriaActiva('favoritos'); setBusquedaArt('') }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1 ${
                categoriaActiva === 'favoritos' && !busquedaArt
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-amber-600 hover:bg-amber-50 border border-amber-200'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
              </svg>
              Favoritos
            </button>
            {/* Rubros */}
            {rubros.map((rubro, idx) => {
              const color = TILE_COLORS[idx % TILE_COLORS.length]
              const isActive = categoriaActiva === rubro.nombre && !busquedaArt
              return (
                <button
                  key={rubro.nombre}
                  onClick={() => { setCategoriaActiva(rubro.nombre); setBusquedaArt('') }}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={isActive
                    ? { backgroundColor: color.tab, color: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
                    : { backgroundColor: '#fff', color: color.tab, border: `1px solid ${color.tab}40` }
                  }
                >
                  {rubro.nombre}
                </button>
              )
            })}
          </div>

          {/* Grilla de productos */}
          <div className="flex-1 overflow-y-auto -mx-1">
            {cargandoArticulos ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Cargando artículos...
              </div>
            ) : articulosMostrados.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                {categoriaActiva === 'favoritos' && !busquedaArt ? (
                  <div>
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                    </svg>
                    <p className="text-sm font-medium">No tenés favoritos aún</p>
                    <p className="text-xs mt-1 text-gray-300">Tocá la estrella en un artículo para agregarlo</p>
                  </div>
                ) : busquedaArt ? (
                  <p className="text-sm">Sin resultados para "<span className="font-medium">{busquedaArt}</span>"</p>
                ) : (
                  <p className="text-sm">No hay artículos en esta categoría</p>
                )}
              </div>
            ) : categoriaActiva === 'favoritos' && !busquedaArt ? (
              /* ── Favoritos: tiles/bloques ── */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 px-1">
                {articulosMostrados.map(art => {
                  const precioFinal = calcularPrecioConDescuentosBase(art)
                  const enCarrito = carrito.find(i => i.articulo.id === art.id)
                  const color = rubroColorMap[art.rubro?.nombre] || TILE_COLORS[0]

                  return (
                    <div
                      key={art.id}
                      onClick={() => agregarAlCarrito(art)}
                      className={`relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.02] active:scale-95 select-none ${
                        enCarrito ? 'ring-2 ring-violet-500 shadow-md' : 'shadow-sm'
                      }`}
                      style={{ borderTop: `4px solid ${color.border}`, backgroundColor: enCarrito ? color.bg : '#fff' }}
                    >
                      {enCarrito && (
                        <span className="absolute -top-2 -right-2 bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow z-10">
                          {enCarrito.cantidad}
                        </span>
                      )}
                      <div className="p-3 flex flex-col items-center text-center min-h-[100px] justify-center">
                        <span className="text-base font-bold text-gray-800">{formatPrecio(precioFinal)}</span>
                        <span className="text-xs text-gray-600 mt-1.5 line-clamp-2 leading-tight">{art.nombre}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* ── Búsqueda / categorías: listado ── */
              <div className="space-y-1 px-1">
                {articulosMostrados.map(art => {
                  const precioFinal = calcularPrecioConDescuentosBase(art)
                  const enCarrito = carrito.find(i => i.articulo.id === art.id)

                  return (
                    <div
                      key={art.id}
                      onClick={() => agregarAlCarrito(art)}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        enCarrito ? 'bg-violet-50 border-violet-200' : 'bg-white border-gray-100 hover:border-violet-200 hover:bg-violet-50/50'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{art.nombre}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {art.codigo && <span className="mr-2">{art.codigo}</span>}
                          {art.rubro?.nombre && <span>{art.rubro.nombre}</span>}
                          {art.subRubro?.nombre && <span> / {art.subRubro.nombre}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <span className="text-sm font-semibold text-gray-700">{formatPrecio(precioFinal)}</span>
                        {enCarrito && (
                          <span className="bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                            {enCarrito.cantidad}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Botón flotante carrito (mobile) */}
      <button
        onClick={() => setCarritoVisible(!carritoVisible)}
        className="lg:hidden fixed bottom-4 right-4 z-30 bg-violet-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        {cantidadItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {cantidadItems}
          </span>
        )}
      </button>

      {/* Modal de cobro */}
      {mostrarCobrar && (
        <ModalCobrar
          total={total}
          subtotal={subtotal}
          descuentoTotal={descuentoTotal}
          ivaTotal={0}
          carrito={carrito}
          cliente={cliente}
          promosAplicadas={promosAplicadas}
          onConfirmar={handleVentaExitosa}
          onCerrar={() => setMostrarCobrar(false)}
        />
      )}
    </div>
  )
}

export default POS
