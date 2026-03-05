// Punto de Venta — POS con promociones de Centum
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ModalCobrar from '../../components/pos/ModalCobrar'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

// Extraer cantidad mínima del nombre de la promo (ej: "a partir de 6" → 6)
function extraerCantidadMinima(nombre) {
  const match = nombre.match(/(?:a partir de|desde|min(?:imo)?\.?\s*)\s*(\d+)/i)
  if (match) return parseInt(match[1])
  const matchNum = nombre.match(/(\d+)\s*(?:unid|bot|u\.)/i)
  if (matchNum) return parseInt(matchNum[1])
  return 1
}

// Determinar si una promo aplica a una lista de precio
function promoAplicaALista(promo, listaPrecioId) {
  const nombre = (promo.nombre || '').toUpperCase()
  // Si el nombre contiene "MINORISTA" → lista 1
  if (nombre.includes('MINORISTA') && listaPrecioId === 1) return true
  // Si contiene "L3" → lista 5
  if (nombre.includes('L3') && listaPrecioId === 5) return true
  // Si no tiene indicador de lista → aplica a todas
  if (!nombre.includes('MINORISTA') && !nombre.includes('L3') && !nombre.includes('L2') && !nombre.includes('L4')) return true
  return false
}

// Calcular promociones aplicables al carrito
function calcularPromociones(carrito, promociones, listaPrecioId) {
  const aplicadas = []

  for (const promo of promociones) {
    if (!promoAplicaALista(promo, listaPrecioId)) continue

    const cantidadMinima = extraerCantidadMinima(promo.nombre)

    for (const detalle of promo.detalles) {
      // Buscar items del carrito que matcheen
      const itemsMatch = carrito.filter(item => {
        if (detalle.tipo === 'SubRubro' && item.articulo.subRubro?.id === detalle.entidadId) return true
        if (detalle.tipo === 'Rubro' && item.articulo.rubro?.id === detalle.entidadId) return true
        if (detalle.tipo === 'Articulo' && item.articulo.id === detalle.entidadId) return true
        return false
      })

      if (itemsMatch.length === 0) continue

      const cantidadTotal = itemsMatch.reduce((sum, i) => sum + i.cantidad, 0)
      if (cantidadTotal < cantidadMinima) continue

      // Calcular descuento
      const subtotalItems = itemsMatch.reduce((sum, i) => {
        const precioConDesc = calcularPrecioConDescuentosBase(i.articulo)
        return sum + precioConDesc * i.cantidad
      }, 0)

      const descuento = subtotalItems * (detalle.porcentajeDescuento / 100)

      aplicadas.push({
        promoId: promo.id,
        promoNombre: promo.nombre,
        tipo: detalle.tipo,
        entidadId: detalle.entidadId,
        porcentajeDescuento: detalle.porcentajeDescuento,
        cantidadMinima,
        cantidadActual: cantidadTotal,
        descuento,
        itemsAfectados: itemsMatch.map(i => i.articulo.id),
      })
    }
  }

  return aplicadas
}

// Precio con descuentos base del artículo (no promo)
function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

const POS = () => {
  const { usuario } = useAuth()

  // Estado cliente
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientesCentum, setClientesCentum] = useState([])
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const [cliente, setCliente] = useState(null) // { id_centum, razon_social, lista_precio_id }

  // Estado artículos
  const [articulos, setArticulos] = useState([])
  const [cargandoArticulos, setCargandoArticulos] = useState(false)
  const [busquedaArt, setBusquedaArt] = useState('')

  // Carrito
  const [carrito, setCarrito] = useState([]) // [{ articulo, cantidad }]

  // Promociones
  const [promociones, setPromociones] = useState([])
  const [cargandoPromos, setCargandoPromos] = useState(false)

  // Modal cobrar
  const [mostrarCobrar, setMostrarCobrar] = useState(false)

  // Carrito mobile toggle
  const [carritoVisible, setCarritoVisible] = useState(false)

  const inputBusquedaRef = useRef(null)

  // Cargar promos al montar
  useEffect(() => {
    cargarPromociones()
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

  // Cargar artículos cuando se selecciona cliente
  async function cargarArticulos(idClienteCentum) {
    setCargandoArticulos(true)
    try {
      const { data } = await api.get('/api/pos/articulos', {
        params: { id_cliente_centum: idClienteCentum }
      })
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
    cargarArticulos(cli.id_centum)
  }

  // Filtrar artículos por búsqueda
  const articulosFiltrados = useMemo(() => {
    if (!busquedaArt.trim()) return articulos.slice(0, 50)
    const terminos = busquedaArt.toLowerCase().trim().split(/\s+/)
    return articulos.filter(a => {
      const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
      return terminos.every(t => texto.includes(t))
    }).slice(0, 50)
  }, [articulos, busquedaArt])

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

  // Calcular totales
  // Precio de Centum ya incluye IVA — no sumar IVA
  const { subtotal, descuentoTotal, total, promosAplicadas } = useMemo(() => {
    let sub = 0
    for (const item of carrito) {
      const precioBase = calcularPrecioConDescuentosBase(item.articulo)
      sub += precioBase * item.cantidad
    }

    const aplicadas = calcularPromociones(carrito, promociones, cliente?.lista_precio_id || 1)
    const descTotal = aplicadas.reduce((sum, p) => sum + p.descuento, 0)

    return {
      subtotal: sub,
      descuentoTotal: descTotal,
      total: sub - descTotal,
      promosAplicadas: aplicadas,
    }
  }, [carrito, promociones, cliente])

  function limpiarVenta() {
    setCarrito([])
    setCliente(null)
    setArticulos([])
    setBusquedaArt('')
    setBusquedaCliente('')
  }

  function handleVentaExitosa() {
    setMostrarCobrar(false)
    setCarrito([])
    setBusquedaArt('')
    // Mantener cliente y artículos para ventas consecutivas
  }

  const cantidadItems = carrito.reduce((s, i) => s + i.cantidad, 0)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar titulo="Punto de Venta" sinTabs volverA="/apps" />

      {/* Barra cliente */}
      <div className="bg-white border-b px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          {!cliente ? (
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Buscar cliente..."
                value={busquedaCliente}
                onChange={e => setBusquedaCliente(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                autoFocus
              />
              {buscandoClientes && (
                <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Buscando...</div>
              )}
              {clientesCentum.length > 0 && (
                <div className="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                  {clientesCentum.map(cli => (
                    <button
                      key={cli.id || cli.id_centum}
                      onClick={() => seleccionarCliente(cli)}
                      className="w-full text-left px-3 py-2 hover:bg-violet-50 text-sm border-b last:border-b-0"
                    >
                      <span className="font-medium">{cli.razon_social}</span>
                      {cli.cuit && <span className="text-gray-400 ml-2">CUIT: {cli.cuit}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5 text-sm">
                <span className="text-violet-700 font-medium">{cliente.razon_social}</span>
                <span className="text-violet-400 ml-2">Lista {cliente.lista_precio_id}</span>
              </div>
              <button
                onClick={() => { setCliente(null); setArticulos([]); setBusquedaCliente('') }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cambiar
              </button>
            </div>
          )}

          <button
            onClick={limpiarVenta}
            className="text-sm text-red-500 hover:text-red-700 font-medium"
          >
            Limpiar venta
          </button>
        </div>
      </div>

      {/* Contenido principal */}
      {!cliente ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <p className="text-lg font-medium">Selecciona un cliente para comenzar</p>
            <p className="text-sm mt-1">Busca por nombre o CUIT</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full">
          {/* Panel izquierdo: artículos */}
          <div className="flex-1 lg:w-3/5 p-4 flex flex-col min-h-0">
            {/* Buscador de artículos */}
            <div className="relative mb-3">
              <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                ref={inputBusquedaRef}
                type="text"
                placeholder="Buscar artículo por nombre o código..."
                value={busquedaArt}
                onChange={e => setBusquedaArt(e.target.value)}
                className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                autoFocus
              />
              {cargandoArticulos && (
                <div className="absolute right-3 top-2.5 text-gray-400 text-xs">Cargando...</div>
              )}
            </div>

            {/* Lista de artículos */}
            <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
              {cargandoArticulos ? (
                <div className="flex items-center justify-center py-20 text-gray-400">
                  <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Cargando artículos...
                </div>
              ) : articulosFiltrados.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  {busquedaArt ? 'Sin resultados' : `${articulos.length} artículos cargados — escriba para buscar`}
                </div>
              ) : (
                articulosFiltrados.map(art => {
                  const precioFinal = calcularPrecioConDescuentosBase(art)
                  const enCarrito = carrito.find(i => i.articulo.id === art.id)
                  return (
                    <div
                      key={art.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        enCarrito ? 'bg-violet-50 border-violet-200' : 'bg-white border-gray-100 hover:border-violet-200 hover:bg-violet-50/50'
                      }`}
                      onClick={() => agregarAlCarrito(art)}
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
                        <button className="text-violet-600 hover:text-violet-800 p-1">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Botón floating carrito (mobile) */}
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

          {/* Panel derecho: carrito */}
          <div className={`
            lg:w-2/5 lg:max-w-md bg-white border-l flex flex-col
            ${carritoVisible ? 'fixed inset-0 z-20 lg:relative lg:inset-auto' : 'hidden lg:flex'}
          `}>
            {/* Header carrito */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800">
                Carrito
                {cantidadItems > 0 && <span className="text-gray-400 font-normal ml-1">({cantidadItems})</span>}
              </h2>
              <button
                onClick={() => setCarritoVisible(false)}
                className="lg:hidden text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Items del carrito */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {carrito.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">
                  Carrito vacío
                </div>
              ) : (
                carrito.map(item => {
                  const precioUnitario = calcularPrecioConDescuentosBase(item.articulo)
                  return (
                    <div key={item.articulo.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0 mr-2">
                        <div className="text-sm font-medium text-gray-800 truncate">{item.articulo.nombre}</div>
                        <div className="text-xs text-gray-400">{formatPrecio(precioUnitario)} c/u</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => cambiarCantidad(item.articulo.id, -1)}
                          className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-600"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" />
                          </svg>
                        </button>
                        <span className="w-8 text-center text-sm font-semibold">{item.cantidad}</span>
                        <button
                          onClick={() => cambiarCantidad(item.articulo.id, 1)}
                          className="w-7 h-7 rounded-full bg-violet-100 hover:bg-violet-200 flex items-center justify-center text-violet-700"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </button>
                        <span className="w-20 text-right text-sm font-semibold text-gray-700">
                          {formatPrecio(precioUnitario * item.cantidad)}
                        </span>
                        <button
                          onClick={() => quitarDelCarrito(item.articulo.id)}
                          className="ml-1 text-red-400 hover:text-red-600"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })
              )}

              {/* Promos aplicadas */}
              {promosAplicadas.length > 0 && (
                <div className="mt-3 space-y-1">
                  {promosAplicadas.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 text-xs text-green-700">
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                      </svg>
                      <span className="flex-1 truncate">
                        -{p.porcentajeDescuento}% {p.promoNombre}
                      </span>
                      <span className="font-semibold">-{formatPrecio(p.descuento)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totales */}
            {carrito.length > 0 && (
              <div className="border-t p-4 space-y-2 bg-gray-50">
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Subtotal</span>
                  <span>{formatPrecio(subtotal)}</span>
                </div>
                {descuentoTotal > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Descuentos</span>
                    <span>-{formatPrecio(descuentoTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-gray-800 pt-1 border-t">
                  <span>TOTAL</span>
                  <span>{formatPrecio(total)}</span>
                </div>
                <button
                  onClick={() => setMostrarCobrar(true)}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 rounded-xl text-lg transition-colors mt-2"
                >
                  COBRAR {formatPrecio(total)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
