// Punto de Venta — POS con motor de promociones local
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import ModalCobrar from '../../components/pos/ModalCobrar'
import PedidosPOS from './PedidosPOS'
import NuevoClienteModal from '../../components/NuevoClienteModal'
import api, { isNetworkError } from '../../services/api'
import useOnlineStatus from '../../hooks/useOnlineStatus'
import { guardarArticulos, getArticulos, guardarPromociones, getPromociones, guardarClientes, getClientes } from '../../services/offlineDB'
import { syncVentasPendientes } from '../../services/offlineSync'

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

// ============ CONFIGURACIÓN TERMINAL POS ============
const TERMINAL_KEY = 'pos_terminal_config'

function getTerminalConfig() {
  try {
    return JSON.parse(localStorage.getItem(TERMINAL_KEY))
  } catch { return null }
}

function saveTerminalConfig(config) {
  localStorage.setItem(TERMINAL_KEY, JSON.stringify(config))
}

// Pantalla de configuración inicial del terminal (solo admin)
const ConfigurarTerminal = ({ onConfigurar, configActual }) => {
  const [sucursales, setSucursales] = useState([])
  const [cajas, setCajas] = useState([])
  const [sucursalId, setSucursalId] = useState(configActual?.sucursal_id || '')
  const [cajaId, setCajaId] = useState(configActual?.caja_id || '')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    api.get('/api/sucursales')
      .then(({ data }) => setSucursales(data || []))
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    if (!sucursalId) { setCajas([]); return }
    api.get('/api/cajas', { params: { sucursal_id: sucursalId } })
      .then(({ data }) => setCajas(data || []))
      .catch(() => setCajas([]))
  }, [sucursalId])

  const sucursalSeleccionada = sucursales.find(s => s.id === sucursalId)
  const cajaSeleccionada = cajas.find(c => c.id === cajaId)

  const confirmar = () => {
    if (!sucursalId || !cajaId) return
    onConfigurar({
      sucursal_id: sucursalId,
      sucursal_nombre: sucursalSeleccionada?.nombre || '',
      caja_id: cajaId,
      caja_nombre: cajaSeleccionada?.nombre || '',
    })
  }

  if (cargando) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Cargando configuracion...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Configurar Terminal POS</h2>
          <p className="text-sm text-gray-400 mt-1">Selecciona la sucursal y caja para esta PC</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal</label>
            <select
              value={sucursalId}
              onChange={e => { setSucursalId(e.target.value); setCajaId('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="">Seleccionar sucursal...</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Caja</label>
            <select
              value={cajaId}
              onChange={e => setCajaId(e.target.value)}
              disabled={!sucursalId}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">{sucursalId ? 'Seleccionar caja...' : 'Primero selecciona sucursal'}</option>
              {cajas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={confirmar}
          disabled={!sucursalId || !cajaId}
          className="w-full mt-6 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          Guardar configuracion
        </button>

        {configActual && (
          <button
            onClick={() => onConfigurar(null)}
            className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}

const POS = () => {
  const { usuario, esAdmin } = useAuth()
  const { isOnline, ventasPendientes, actualizarPendientes } = useOnlineStatus()

  // Terminal config (sucursal + caja de esta PC)
  const [terminalConfig, setTerminalConfig] = useState(() => getTerminalConfig())
  const [mostrarConfigTerminal, setMostrarConfigTerminal] = useState(false)

  function handleConfigurarTerminal(config) {
    if (config) {
      saveTerminalConfig(config)
      setTerminalConfig(config)
    }
    setMostrarConfigTerminal(false)
  }

  const necesitaConfig = !terminalConfig && !mostrarConfigTerminal

  // Estado cliente
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientesCentum, setClientesCentum] = useState([])
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const CLIENTE_DEFAULT = { id_centum: 0, razon_social: 'Consumidor Final', lista_precio_id: 1 }

  // Multi-ticket: 2 tickets en paralelo
  const [tickets, setTickets] = useState([
    { carrito: [], cliente: { ...CLIENTE_DEFAULT } },
    { carrito: [], cliente: { ...CLIENTE_DEFAULT } },
  ])
  const [ticketActivo, setTicketActivo] = useState(0)
  const ticketActivoRef = useRef(ticketActivo)
  ticketActivoRef.current = ticketActivo

  // Derivar carrito y cliente del ticket activo
  const carrito = tickets[ticketActivo].carrito
  const cliente = tickets[ticketActivo].cliente

  // Auto-expiración: si un ticket inactivo con items no se usa en 7 min, se limpia
  const TICKET_TIMEOUT = 7 * 60 * 1000
  const ticketTimestamps = useRef([0, 0]) // última actividad por ticket

  useEffect(() => {
    // Al cambiar de ticket, marcar timestamp del que se deja
    ticketTimestamps.current[ticketActivo] = Date.now()
  }, [ticketActivo])

  useEffect(() => {
    const interval = setInterval(() => {
      const ahora = Date.now()
      setTickets(prev => {
        let changed = false
        const nuevo = prev.map((t, idx) => {
          if (idx === ticketActivoRef.current) return t // no tocar el activo
          if (t.carrito.length === 0) return t // ya vacío
          const lastActivity = ticketTimestamps.current[idx]
          if (lastActivity > 0 && ahora - lastActivity >= TICKET_TIMEOUT) {
            changed = true
            ticketTimestamps.current[idx] = 0
            return { carrito: [], cliente: { ...CLIENTE_DEFAULT } }
          }
          return t
        })
        return changed ? nuevo : prev
      })
    }, 30000) // revisar cada 30s
    return () => clearInterval(interval)
  }, [CLIENTE_DEFAULT])

  // setCarrito/setCliente usan ref para que no cambien de identidad al cambiar de ticket
  const setCarrito = useCallback((updater) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      nuevo[idx] = {
        ...nuevo[idx],
        carrito: typeof updater === 'function' ? updater(nuevo[idx].carrito) : updater,
      }
      return nuevo
    })
  }, [])

  const setCliente = useCallback((cli) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cliente: cli }
      return nuevo
    })
  }, [])

  // Estado artículos
  const [articulos, setArticulos] = useState([])
  const [cargandoArticulos, setCargandoArticulos] = useState(false)
  const [busquedaArt, setBusquedaArt] = useState('')

  // Promociones
  const [promociones, setPromociones] = useState([])
  const [cargandoPromos, setCargandoPromos] = useState(false)

  // Modal cobrar
  const [mostrarCobrar, setMostrarCobrar] = useState(false)

  // Pedidos POS
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [guardandoPedido, setGuardandoPedido] = useState(false)

  // Modal wizard pedido (paso 0: cliente, paso 1: tipo, paso 2: dirección/sucursal, paso 3: pago anticipado)
  const [mostrarBuscarClientePedido, setMostrarBuscarClientePedido] = useState(false)
  const [pasoPedido, setPasoPedido] = useState(0) // 0=cliente, 1=tipo, 2=fecha, 3=dirección/sucursal, 4=pago
  const [fechaEntregaPedido, setFechaEntregaPedido] = useState('')
  const [mostrarCobrarPedido, setMostrarCobrarPedido] = useState(false)
  const pedidoWizardDataRef = useRef(null)
  const [clientePedido, setClientePedido] = useState(null)
  const [busquedaClientePedido, setBusquedaClientePedido] = useState('')
  const [clientesPedido, setClientesPedido] = useState([])
  const [buscandoClientePedido, setBuscandoClientePedido] = useState(false)
  const [mostrarCrearClientePedido, setMostrarCrearClientePedido] = useState(false)
  const inputClientePedidoRef = useRef(null)
  // Paso 2: direcciones delivery / sucursales retiro
  const [tipoPedidoSeleccionado, setTipoPedidoSeleccionado] = useState(null)
  const [direccionesPedido, setDireccionesPedido] = useState([])
  const [direccionSeleccionadaPedido, setDireccionSeleccionadaPedido] = useState(null)
  const [sucursalesPedido, setSucursalesPedido] = useState([])
  const [sucursalSeleccionadaPedido, setSucursalSeleccionadaPedido] = useState(null)
  const [cargandoDetallePedido, setCargandoDetallePedido] = useState(false)
  const [mostrarNuevaDirPedido, setMostrarNuevaDirPedido] = useState(false)
  const [nuevaDirPedido, setNuevaDirPedido] = useState({ direccion: '', localidad: '' })
  const [guardandoDirPedido, setGuardandoDirPedido] = useState(false)

  // Edición inline de precio
  const [editandoPrecio, setEditandoPrecio] = useState(null) // articuloId o null

  // Vista activa: tabs estilo Chrome (venta vs pedidos)
  const [vistaActiva, setVistaActiva] = useState('venta')

  // Pedido en proceso de entrega (viene de tab Pedidos)
  const [pedidoEnProceso, setPedidoEnProceso] = useState(null) // { id, esPagado, ... }

  // Carrito mobile toggle
  const [carritoVisible, setCarritoVisible] = useState(false)

  // Favoritos (persistidos en localStorage)
  const [favoritos, setFavoritos] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pos_favoritos') || '[]')
    } catch { return [] }
  })

  const inputBusquedaRef = useRef(null)

  // Refocus al buscador tras cualquier click (excepto otros inputs)
  const handlePOSClick = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    setTimeout(() => {
      if (document.activeElement?.tagName !== 'INPUT') {
        inputBusquedaRef.current?.focus()
      }
    }, 0)
  }, [])

  // Cargar promos, artículos y clientes al montar (1 sola vez)
  useEffect(() => {
    cargarPromociones()
    cargarArticulos()
    cargarClientesCache()
  }, [])

  async function cargarPromociones() {
    setCargandoPromos(true)
    try {
      const { data } = await api.get('/api/pos/promociones')
      const promos = data.promociones || []
      setPromociones(promos)
      guardarPromociones(promos).catch(() => {})
    } catch (err) {
      console.error('Error cargando promos:', err)
      if (isNetworkError(err)) {
        try {
          const cached = await getPromociones()
          if (cached.length > 0) setPromociones(cached)
        } catch {}
      }
    } finally {
      setCargandoPromos(false)
    }
  }

  // Precargar clientes en IndexedDB para búsqueda offline
  async function cargarClientesCache() {
    try {
      const { data } = await api.get('/api/clientes', { params: { limit: 5000 } })
      const clientes = data.clientes || data.data || []
      guardarClientes(clientes).catch(() => {})
    } catch (err) {
      // Si falla la red, no pasa nada — usaremos cache existente
      console.error('Error precargando clientes:', err)
    }
  }

  // Buscar clientes en Centum (debounced) — offline: busca en IndexedDB
  useEffect(() => {
    if (!busquedaCliente.trim() || busquedaCliente.trim().length < 2) {
      setClientesCentum([])
      return
    }

    const timeout = setTimeout(async () => {
      setBuscandoClientes(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', {
            params: { buscar: busquedaCliente.trim(), limit: 10 }
          })
          setClientesCentum(data.clientes || data.data || [])
        } else {
          const cached = await getClientes(busquedaCliente.trim())
          setClientesCentum(cached.slice(0, 10))
        }
      } catch (err) {
        console.error('Error buscando clientes:', err)
        // Fallback a IndexedDB si la API falla
        if (isNetworkError(err)) {
          try {
            const cached = await getClientes(busquedaCliente.trim())
            setClientesCentum(cached.slice(0, 10))
          } catch {}
        }
      } finally {
        setBuscandoClientes(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [busquedaCliente, isOnline])

  // Cargar artículos desde DB local (precios minoristas, sync 1x/día)
  async function cargarArticulos() {
    setCargandoArticulos(true)
    try {
      const { data } = await api.get('/api/pos/articulos')
      const arts = data.articulos || []
      setArticulos(arts)
      guardarArticulos(arts).catch(() => {})
    } catch (err) {
      console.error('Error cargando artículos:', err)
      try {
        const cached = await getArticulos()
        if (cached.length > 0) {
          setArticulos(cached)
          return
        }
      } catch {}
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

  // Favoritos: siempre visibles como tiles
  const articulosFavoritos = useMemo(() => {
    return articulos.filter(a => favoritos.includes(a.id))
  }, [articulos, favoritos])

  // Resultados de búsqueda: dropdown autocompletado
  const resultadosBusqueda = useMemo(() => {
    if (!busquedaArt.trim()) return []
    const terminos = busquedaArt.toLowerCase().trim().split(/\s+/)
    return articulos.filter(a => {
      const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
      return terminos.every(t => texto.includes(t))
    }).slice(0, 30)
  }, [articulos, busquedaArt])

  // Agregar al carrito (pesables suman 0.1, no pesables suman 1)
  const agregarAlCarrito = useCallback((articulo) => {
    const incremento = articulo.esPesable ? 0.1 : 1
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articulo.id)
      if (idx >= 0) {
        const nuevo = [...prev]
        nuevo[idx] = { ...nuevo[idx], cantidad: Math.round((nuevo[idx].cantidad + incremento) * 1000) / 1000 }
        return nuevo
      }
      return [...prev, { articulo, cantidad: incremento }]
    })
  }, [])

  // Buscar artículo por código de barras (también busca por código interno)
  const buscarPorBarcode = useCallback((barcode) => {
    const codigo = barcode.trim()
    // Buscar en codigos_barras
    let encontrado = articulos.find(a =>
      a.codigosBarras && a.codigosBarras.length > 0 && a.codigosBarras.includes(codigo)
    )
    // Si no se encuentra, buscar por código interno exacto
    if (!encontrado) {
      encontrado = articulos.find(a => a.codigo === codigo)
    }
    if (encontrado) {
      agregarAlCarrito(encontrado)
      setBusquedaArt('')
      return true
    }
    return false
  }, [articulos, agregarAlCarrito])

  // Detectar entrada rápida tipo escáner de barras
  const ultimoInputRef = useRef({ time: 0, buffer: '' })

  const handleBusquedaChange = useCallback((e) => {
    const valor = e.target.value
    setBusquedaArt(valor)

    // Detectar si es entrada rápida (escáner): varios caracteres pegados de golpe
    const ahora = Date.now()
    const dt = ahora - ultimoInputRef.current.time
    ultimoInputRef.current.time = ahora

    // Si el valor tiene 8+ dígitos y llegó rápido (< 50ms entre chars) o fue pegado
    if (/^\d{8,}$/.test(valor.trim()) && (dt < 50 || valor.length > 8)) {
      // Dar un pequeño delay para que el scanner termine de escribir
      setTimeout(() => {
        buscarPorBarcode(valor.trim())
      }, 100)
    }
  }, [buscarPorBarcode])

  const handleBusquedaKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const valor = busquedaArt.trim()
      // Si es un código numérico largo, buscar como barcode
      if (/^\d{4,}$/.test(valor)) {
        e.preventDefault()
        if (!buscarPorBarcode(valor)) {
          // No encontrado - dejar el texto para que el usuario vea "sin resultados"
        }
        return
      }
      // Si hay exactamente un resultado de búsqueda por texto, agregarlo
      if (resultadosBusqueda.length === 1) {
        e.preventDefault()
        agregarAlCarrito(resultadosBusqueda[0])
        setBusquedaArt('')
      }
    }
  }, [busquedaArt, buscarPorBarcode, resultadosBusqueda, agregarAlCarrito])

  const cambiarCantidad = useCallback((articuloId, delta, esPesable) => {
    const paso = esPesable ? 0.1 : 1
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevaCantidad = Math.round((prev[idx].cantidad + paso * delta) * 1000) / 1000
      if (nuevaCantidad <= 0) return prev.filter((_, i) => i !== idx)
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: nuevaCantidad }
      return nuevo
    })
  }, [])

  const setCantidadDirecta = useCallback((articuloId, cantidad) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      if (cantidad <= 0) return prev.filter((_, i) => i !== idx)
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: Math.round(cantidad * 1000) / 1000 }
      return nuevo
    })
  }, [])

  const quitarDelCarrito = useCallback((articuloId) => {
    setCarrito(prev => prev.filter(i => i.articulo.id !== articuloId))
  }, [])

  const setPrecioOverride = useCallback((articuloId, nuevoPrecio) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], precioOverride: nuevoPrecio }
      return nuevo
    })
  }, [])

  // Calcular totales — precio de Centum ya incluye IVA
  const { subtotal, descuentoTotal, total, promosAplicadas } = useMemo(() => {
    let sub = 0
    for (const item of carrito) {
      const precioBase = item.precioOverride != null ? item.precioOverride : calcularPrecioConDescuentosBase(item.articulo)
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
    setCliente({ ...CLIENTE_DEFAULT })
    setBusquedaArt('')
    setBusquedaCliente('')
    setPedidoEnProceso(null)
  }

  // Callback desde tab Pedidos: cargar pedido al carrito para entregar
  function handleEntregarPedido(pedido) {
    const itemsPedido = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items
    const nuevoCarrito = itemsPedido.map(item => ({
      articulo: {
        id: item.id,
        codigo: item.codigo || '',
        nombre: item.nombre,
        precio: item.precio,
        esPesable: item.esPesable || false,
        descuento1: 0, descuento2: 0, descuento3: 0,
      },
      cantidad: item.cantidad,
      precioOverride: item.precio,
    }))
    setCarrito(nuevoCarrito)
    if (pedido.nombre_cliente) {
      setCliente({
        id_centum: pedido.id_cliente_centum || 0,
        razon_social: pedido.nombre_cliente,
        lista_precio_id: 1,
      })
    }
    const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO')
    setPedidoEnProceso({ id: pedido.id, numero: pedido.numero, esPagado })
    setVistaActiva('venta')
  }

  // Marcar pedido como entregado en backend
  async function marcarPedidoEntregado(pedidoId) {
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/estado`, { estado: 'entregado' })
    } catch (err) {
      console.error('Error marcando pedido como entregado:', err)
    }
  }

  // Entregar pedido ya pagado: guardar venta directamente sin ModalCobrar
  async function handleEntregarPedidoPagado() {
    if (!pedidoEnProceso || carrito.length === 0) return
    setGuardandoPedido(true)
    try {
      const items = carrito.map(i => ({
        id_articulo: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio_unitario: i.precioOverride != null ? i.precioOverride : calcularPrecioConDescuentosBase(i.articulo),
        cantidad: i.cantidad,
        iva_tasa: i.articulo.iva?.tasa || 21,
        rubro: i.articulo.rubro?.nombre || null,
        subRubro: i.articulo.subRubro?.nombre || null,
      }))
      const payload = {
        id_cliente_centum: cliente.id_centum,
        nombre_cliente: cliente.razon_social,
        items,
        promociones_aplicadas: null,
        subtotal: total,
        descuento_total: 0,
        total,
        monto_pagado: total,
        vuelto: 0,
        pagos: [{ tipo: 'Pago anticipado', monto: total, detalle: null }],
        pedido_pos_id: pedidoEnProceso.id,
      }
      await api.post('/api/pos/ventas', payload)
      await marcarPedidoEntregado(pedidoEnProceso.id)
      limpiarVenta()
    } catch (err) {
      console.error('Error al entregar pedido pagado:', err)
      alert('Error al guardar venta: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleVentaExitosa() {
    setMostrarCobrar(false)
    // Si hay pedido en proceso, marcarlo como entregado
    if (pedidoEnProceso) {
      marcarPedidoEntregado(pedidoEnProceso.id)
    }
    setCarrito([])
    setCliente({ ...CLIENTE_DEFAULT })
    setBusquedaArt('')
    setPedidoEnProceso(null)
    syncVentasPendientes().then(() => actualizarPendientes()).catch(() => {})
  }

  function handleCobroPedidoExitoso(datosPago) {
    // Solo se registró el pago (sin crear venta). Guardar el pedido con marca de pagado.
    const wd = pedidoWizardDataRef.current
    setMostrarCobrarPedido(false)
    if (wd) {
      guardarComoPedidoConCliente(wd.cli, wd.tipo, wd.dirObj, wd.sucObj, true, wd.fecha, datosPago)
      pedidoWizardDataRef.current = null
    }
    // Limpiar wizard state
    setPasoPedido(0)
    setClientePedido(null)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
  }

  // ---- Buscar cliente para pedido (debounced) ----
  useEffect(() => {
    if (!mostrarBuscarClientePedido) return
    const termino = busquedaClientePedido.trim()
    if (termino.length < 2) { setClientesPedido([]); return }

    const timeout = setTimeout(async () => {
      setBuscandoClientePedido(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', { params: { buscar: termino, limit: 15 } })
          setClientesPedido(data.clientes || data.data || [])
        } else {
          const cached = await getClientes(termino)
          setClientesPedido(cached.slice(0, 15))
        }
      } catch (err) {
        console.error('Error buscando clientes para pedido:', err)
        if (isNetworkError(err)) {
          try {
            const cached = await getClientes(termino)
            setClientesPedido(cached.slice(0, 15))
          } catch {}
        }
      } finally {
        setBuscandoClientePedido(false)
      }
    }, 350)

    return () => clearTimeout(timeout)
  }, [busquedaClientePedido, mostrarBuscarClientePedido, isOnline])

  // Focus input al abrir modal cliente pedido
  useEffect(() => {
    if (mostrarBuscarClientePedido) {
      setTimeout(() => inputClientePedidoRef.current?.focus(), 100)
    }
  }, [mostrarBuscarClientePedido])

  function cerrarWizardPedido() {
    setMostrarBuscarClientePedido(false)
    setMostrarCobrarPedido(false)
    setPasoPedido(0)
    setClientePedido(null)
    setFechaEntregaPedido('')
    setBusquedaClientePedido('')
    setClientesPedido([])
    setMostrarCrearClientePedido(false)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
    setMostrarNuevaDirPedido(false)
    setNuevaDirPedido({ direccion: '', localidad: '' })
  }

  function seleccionarClienteParaPedido(cli) {
    if (!cli.id_centum) return
    setClientePedido(cli)
    setPasoPedido(1) // ir a elegir tipo
  }

  function onClientePedidoCreado(clienteNuevo) {
    setMostrarCrearClientePedido(false)
    if (clienteNuevo?.id_centum) {
      seleccionarClienteParaPedido(clienteNuevo)
    }
  }

  async function seleccionarTipoPedido(tipo) {
    if (!clientePedido) return
    setTipoPedidoSeleccionado(tipo)
    // Default fecha: mañana
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    setFechaEntregaPedido(manana.toISOString().split('T')[0])
    setPasoPedido(2) // ir a fecha
    // Pre-cargar direcciones/sucursales para el paso 3
    setCargandoDetallePedido(true)
    try {
      if (tipo === 'delivery') {
        const { data } = await api.get(`/api/clientes/${clientePedido.id}/direcciones`)
        setDireccionesPedido(data || [])
        if (data && data.length > 0) setDireccionSeleccionadaPedido(data[0].id)
      } else {
        const { data } = await api.get('/api/sucursales')
        setSucursalesPedido(data || [])
        if (data && data.length > 0) setSucursalSeleccionadaPedido(data[0].id)
      }
    } catch (err) {
      console.error('Error cargando datos paso 2:', err)
    } finally {
      setCargandoDetallePedido(false)
    }
  }

  async function guardarNuevaDirPedido() {
    if (!nuevaDirPedido.direccion.trim()) return
    setGuardandoDirPedido(true)
    try {
      const { data } = await api.post(`/api/clientes/${clientePedido.id}/direcciones`, {
        direccion: nuevaDirPedido.direccion.trim(),
        localidad: nuevaDirPedido.localidad.trim() || null,
      })
      setDireccionesPedido(prev => [...prev, data])
      setDireccionSeleccionadaPedido(data.id)
      setMostrarNuevaDirPedido(false)
      setNuevaDirPedido({ direccion: '', localidad: '' })
    } catch (err) {
      console.error('Error guardando dirección:', err)
      alert('Error al guardar dirección: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoDirPedido(false)
    }
  }

  function confirmarPedidoWizard() {
    // Ir al paso 4: preguntar pago anticipado
    setPasoPedido(4)
  }

  function finalizarPedidoWizard(conPago) {
    if (!clientePedido || !tipoPedidoSeleccionado) return
    const cli = {
      id_centum: clientePedido.id_centum,
      razon_social: clientePedido.razon_social,
      lista_precio_id: clientePedido.lista_precio_id || 1,
    }
    const dirObj = tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido
      ? direccionesPedido.find(d => d.id === direccionSeleccionadaPedido)
      : null
    const sucObj = tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido
      ? sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)
      : null
    setCliente(cli)

    if (conPago) {
      // Abrir pantalla de cobro — el wizard queda abierto detrás
      setMostrarBuscarClientePedido(false)
      setMostrarCobrarPedido(true)
      // Guardar datos del pedido en un ref para usar al confirmar cobro
      pedidoWizardDataRef.current = { cli, tipo: tipoPedidoSeleccionado, dirObj, sucObj, fecha: fechaEntregaPedido }
    } else {
      cerrarWizardPedido()
      guardarComoPedidoConCliente(cli, tipoPedidoSeleccionado, dirObj, sucObj, false, fechaEntregaPedido)
    }
  }

  function handleEsPedido() {
    if (carrito.length === 0) return
    // Si ya tiene cliente real, ir directo a tipo
    if (cliente.id_centum && cliente.id_centum !== 0) {
      setClientePedido(cliente)
      setPasoPedido(1)
      setMostrarBuscarClientePedido(true)
      return
    }
    // Si no, abrir buscador de cliente (paso 0)
    setPasoPedido(0)
    setMostrarBuscarClientePedido(true)
  }

  // ---- Pedidos POS (página separada en /pos/pedidos) ----

  async function guardarComoPedidoConCliente(cli, tipo, direccion, sucursal, pagado, fechaEntrega, datosPago) {
    if (carrito.length === 0) return
    if (!cli.id_centum || cli.id_centum === 0) return
    setGuardandoPedido(true)
    try {
      const itemsPayload = carrito.map(i => ({
        id: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio: i.precioOverride != null ? i.precioOverride : calcularPrecioConDescuentosBase(i.articulo),
        cantidad: i.cantidad,
        esPesable: i.articulo.esPesable || false,
      }))
      const payload = {
        id_cliente_centum: cli.id_centum,
        nombre_cliente: cli.razon_social,
        items: itemsPayload,
        total,
        tipo: tipo || 'retiro',
      }
      if (direccion) {
        payload.direccion_entrega = direccion.direccion + (direccion.localidad ? `, ${direccion.localidad}` : '')
        payload.direccion_entrega_id = direccion.id
      }
      if (sucursal) {
        payload.sucursal_retiro = sucursal.nombre
        payload.sucursal_retiro_id = sucursal.id
      }
      if (pagado) {
        // Guardar info de pago en observaciones (la venta se genera al entregar)
        if (datosPago?.pagos) {
          const resumenPago = datosPago.pagos.map(p => `${p.tipo}: $${p.monto}`).join(', ')
          payload.observaciones = `PAGO ANTICIPADO: ${resumenPago}`
        } else {
          payload.observaciones = 'PAGO ANTICIPADO'
        }
      }
      if (fechaEntrega) {
        payload.fecha_entrega = fechaEntrega
      }
      await api.post('/api/pos/pedidos', payload)
      limpiarVenta()
    } catch (err) {
      console.error('Error guardando pedido:', err)
      alert('Error al guardar pedido: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }


  const cantidadItems = carrito.reduce((s, i) => s + i.cantidad, 0)

  // Pantallas de configuración de terminal (antes del POS principal)
  if (necesitaConfig) {
    if (!esAdmin) {
      return (
        <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800">Terminal no configurado</h2>
            <p className="text-sm text-gray-400 mt-2">Un administrador debe configurar la sucursal y caja de esta PC antes de usar el POS.</p>
            <a href="/apps" className="inline-block mt-6 text-violet-600 hover:text-violet-700 text-sm font-medium">Volver al menu</a>
          </div>
        </div>
      )
    }
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={null} />
  }

  if (mostrarConfigTerminal) {
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={terminalConfig} />
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden" onClick={handlePOSClick}>
      {/* Barra tipo Chrome: tabs + info terminal */}
      <div className="bg-violet-900 flex-shrink-0">
        <div className="flex items-center justify-between">
          {/* Izquierda: botón volver + tabs */}
          <div className="flex items-center">
            <a
              href="/apps"
              className="px-3 py-2.5 text-violet-400 hover:text-white transition-colors"
              title="Volver al menú"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </a>

            {/* Tab Venta */}
            <button
              onClick={() => setVistaActiva('venta')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'venta'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Venta
            </button>

            {/* Tab Pedidos */}
            <button
              onClick={() => setVistaActiva('pedidos')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'pedidos'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Pedidos
            </button>
          </div>

          {/* Derecha: info terminal + config */}
          <div className="flex items-center gap-2 pr-3 text-xs">
            <span className="text-violet-300">{terminalConfig?.sucursal_nombre}</span>
            <span className="bg-violet-700 text-violet-100 px-1.5 py-0.5 rounded font-medium">{terminalConfig?.caja_nombre}</span>
            <span className="text-violet-300">|</span>
            <span className="text-violet-300">{usuario?.nombre}</span>
            {esAdmin && (
              <button
                onClick={() => setMostrarConfigTerminal(true)}
                className="text-violet-400 hover:text-white p-1 rounded transition-colors"
                title="Reconfigurar terminal"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* === TAB PEDIDOS === */}
      {vistaActiva === 'pedidos' && (
        <div className="flex-1 overflow-hidden">
          <PedidosPOS embebido onEntregarPedido={handleEntregarPedido} />
        </div>
      )}

      {/* === TAB VENTA === */}
      {vistaActiva === 'venta' && <>
      {/* Banner pedido en proceso */}
      {pedidoEnProceso && (
        <div className="flex items-center justify-between px-4 py-2 bg-violet-50 border-b border-violet-200">
          <span className="text-sm text-violet-700 font-medium">
            Entregando pedido {pedidoEnProceso.numero ? `#${pedidoEnProceso.numero}` : ''} de <strong>{cliente.razon_social}</strong>
            {pedidoEnProceso.esPagado ? ' (ya pagado)' : ' (pendiente de cobro)'}
          </span>
          <button
            onClick={limpiarVenta}
            className="text-xs text-violet-500 hover:text-violet-700 font-medium"
          >
            Cancelar entrega
          </button>
        </div>
      )}
      {/* Indicadores offline */}
      {(!isOnline || ventasPendientes > 0) && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b">
          {!isOnline && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Sin conexion
            </span>
          )}
          {ventasPendientes > 0 && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {ventasPendientes} venta{ventasPendientes > 1 ? 's' : ''} pendiente{ventasPendientes > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* ====== IZQUIERDA: PANEL CARRITO ====== */}
        <div className={`
          lg:w-[380px] xl:w-[420px] bg-white border-r flex flex-col flex-shrink-0
          ${carritoVisible ? 'fixed inset-0 z-20 lg:relative' : 'hidden lg:flex'}
        `}>
          {/* Tabs de tickets */}
          <div className="flex border-b bg-gray-100">
            {tickets.map((t, idx) => {
              const items = t.carrito.length
              const activo = idx === ticketActivo
              const ts = ticketTimestamps.current[idx]
              const inactivo = !activo && items > 0 && ts > 0
              const minRestantes = inactivo ? Math.max(0, Math.ceil((TICKET_TIMEOUT - (Date.now() - ts)) / 60000)) : null
              return (
                <button
                  key={idx}
                  onClick={() => { setTicketActivo(idx); setBusquedaArt(''); setBusquedaCliente('') }}
                  className={`flex-1 py-2 px-3 text-xs font-semibold transition-colors relative ${
                    activo
                      ? 'bg-white text-violet-700 border-b-2 border-violet-600'
                      : items > 0
                        ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Ticket {idx + 1}
                  {items > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activo ? 'bg-violet-100 text-violet-700' : 'bg-amber-200 text-amber-800'
                    }`}>
                      {items}
                    </span>
                  )}
                  {minRestantes != null && minRestantes <= 3 && (
                    <span className="ml-1 text-[9px] text-red-500 font-normal">{minRestantes}min</span>
                  )}
                </button>
              )
            })}
          </div>

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
                  const precioOriginal = calcularPrecioConDescuentosBase(item.articulo)
                  const precioUnit = item.precioOverride != null ? item.precioOverride : precioOriginal
                  const lineTotal = precioUnit * item.cantidad
                  const tieneOverride = item.precioOverride != null
                  const estaEditando = editandoPrecio === item.articulo.id
                  return (
                    <div key={item.articulo.id} className="px-3 py-2 hover:bg-gray-50/80">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate flex-1">{item.articulo.nombre}</span>
                        <span className="text-sm font-bold text-gray-800 flex-shrink-0">{formatPrecio(lineTotal)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, -1, item.articulo.esPesable)}
                            className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-600 text-sm font-bold"
                          >−</button>
                          {item.articulo.esPesable ? (
                            <input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={item.cantidad}
                              onChange={e => {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val > 0) setCantidadDirecta(item.articulo.id, val)
                              }}
                              onClick={e => e.target.select()}
                              className="w-16 text-center text-sm font-semibold border rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                            />
                          ) : (
                            <span className="w-7 text-center text-sm font-semibold">{item.cantidad}</span>
                          )}
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, 1, item.articulo.esPesable)}
                            className="w-6 h-6 rounded bg-violet-100 hover:bg-violet-200 flex items-center justify-center text-violet-700 text-sm font-bold"
                          >+</button>
                        </div>
                        {item.articulo.esPesable && <span className="text-[10px] text-amber-600 font-medium">kg</span>}
                        {estaEditando ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={precioUnit}
                            autoFocus
                            onClick={e => e.target.select()}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val >= 0) {
                                  setPrecioOverride(item.articulo.id, val === precioOriginal ? null : val)
                                }
                                setEditandoPrecio(null)
                              } else if (e.key === 'Escape') {
                                setEditandoPrecio(null)
                              }
                            }}
                            onBlur={e => {
                              const val = parseFloat(e.target.value)
                              if (!isNaN(val) && val >= 0) {
                                setPrecioOverride(item.articulo.id, val === precioOriginal ? null : val)
                              }
                              setEditandoPrecio(null)
                            }}
                            className="w-20 text-center text-xs font-semibold border border-violet-400 rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                          />
                        ) : (
                          <span
                            onClick={() => setEditandoPrecio(item.articulo.id)}
                            className={`text-xs cursor-pointer hover:underline ${tieneOverride ? 'text-violet-600 font-semibold' : 'text-gray-400'}`}
                            title="Click para editar precio"
                          >
                            {formatPrecio(precioUnit)} {item.articulo.esPesable ? '/kg' : 'c/u'}
                          </span>
                        )}
                        {tieneOverride && !estaEditando && (
                          <button
                            onClick={() => setPrecioOverride(item.articulo.id, null)}
                            className="text-violet-400 hover:text-violet-600 p-0.5"
                            title="Restaurar precio original"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
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
                  className="px-3 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                {/* Si NO hay pedido en proceso: botones normales */}
                {!pedidoEnProceso && (
                  <>
                    <button
                      onClick={handleEsPedido}
                      disabled={guardandoPedido}
                      className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {guardandoPedido ? 'Guardando...' : 'Es pedido'}
                    </button>
                    <button
                      onClick={() => setMostrarCobrar(true)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                    >
                      Cobrar {formatPrecio(total)}
                    </button>
                  </>
                )}
                {/* Si hay pedido en proceso NO pagado: cobrar primero */}
                {pedidoEnProceso && !pedidoEnProceso.esPagado && (
                  <button
                    onClick={() => setMostrarCobrar(true)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    Cobrar {formatPrecio(total)}
                  </button>
                )}
                {/* Si hay pedido en proceso YA pagado: entregar directo */}
                {pedidoEnProceso && pedidoEnProceso.esPagado && (
                  <button
                    onClick={handleEntregarPedidoPagado}
                    disabled={guardandoPedido}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    {guardandoPedido ? 'Guardando...' : `Entregar ${formatPrecio(total)}`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ====== DERECHA: PANEL PRODUCTOS ====== */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          {/* Buscador con dropdown autocompletado */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400 z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputBusquedaRef}
              type="text"
              placeholder="Buscar por nombre, código o escanear..."
              value={busquedaArt}
              onChange={handleBusquedaChange}
              onKeyDown={handleBusquedaKeyDown}
              className="w-full bg-white border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent shadow-sm"
              autoFocus
            />
            {cargandoArticulos && (
              <div className="absolute right-3 top-3 text-gray-400 text-xs z-10">Cargando...</div>
            )}

            {/* Dropdown de resultados de búsqueda */}
            {busquedaArt.trim() && !cargandoArticulos && (
              <div className="absolute z-30 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-80 overflow-y-auto">
                {resultadosBusqueda.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400 text-center">
                    Sin resultados para "{busquedaArt}"
                  </div>
                ) : (
                  resultadosBusqueda.map(art => {
                    const precioFinal = calcularPrecioConDescuentosBase(art)
                    const enCarrito = carrito.find(i => i.articulo.id === art.id)
                    const esFav = favoritos.includes(art.id)
                    return (
                      <div
                        key={art.id}
                        onClick={() => { agregarAlCarrito(art); setBusquedaArt(''); inputBusquedaRef.current?.focus() }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-b last:border-b-0 transition-colors ${
                          enCarrito ? 'bg-violet-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <button
                          onClick={(e) => toggleFavorito(art.id, e)}
                          className={`mr-3 flex-shrink-0 transition-colors ${
                            esFav ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-amber-400'
                          }`}
                        >
                          <svg className="w-5 h-5" fill={esFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                          </svg>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{art.nombre}</div>
                          <div className="text-xs text-gray-400 truncate">
                            {art.codigo && <span className="mr-2">{art.codigo}</span>}
                            {art.rubro?.nombre && <span>{art.rubro.nombre}</span>}
                            {art.subRubro?.nombre && <span> / {art.subRubro.nombre}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                          <span className="text-sm font-semibold text-gray-700">{formatPrecio(precioFinal)}</span>
                          {enCarrito && (
                            <span className="bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                              {enCarrito.cantidad}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Grilla de favoritos (siempre visible) */}
          <div className="flex-1 overflow-y-auto">
            {cargandoArticulos ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Cargando artículos...
              </div>
            ) : articulosFavoritos.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                <p className="text-sm font-medium">No tenés favoritos aún</p>
                <p className="text-xs mt-1 text-gray-300">Buscá un artículo y agregalo desde el buscador</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {articulosFavoritos.map(art => {
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
      </>}

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
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          pedidoPosId={pedidoEnProceso?.id || null}
        />
      )}

      {/* Modal de cobro para pedido (pago anticipado) */}
      {mostrarCobrarPedido && (
        <ModalCobrar
          total={total}
          subtotal={subtotal}
          descuentoTotal={descuentoTotal}
          ivaTotal={0}
          carrito={carrito}
          cliente={cliente}
          promosAplicadas={promosAplicadas}
          onConfirmar={handleCobroPedidoExitoso}
          onCerrar={() => { setMostrarCobrarPedido(false); pedidoWizardDataRef.current = null }}
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          soloPago
        />
      )}

      {/* Pedidos ahora es una página separada en /pos/pedidos */}

      {/* Modal buscar cliente para pedido */}
      {/* Modal wizard pedido: paso 0 = cliente, paso 1 = tipo */}
      {mostrarBuscarClientePedido && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cerrarWizardPedido}>
          <div
            className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">
                  {pasoPedido === 0 ? 'Seleccionar cliente' : pasoPedido === 1 ? 'Tipo de pedido' : pasoPedido === 2 ? 'Fecha de entrega' : pasoPedido === 3 ? (tipoPedidoSeleccionado === 'delivery' ? 'Direccion de entrega' : 'Sucursal de retiro') : 'Pago anticipado'}
                </h2>
                <button onClick={cerrarWizardPedido} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {pasoPedido === 1 && (
                <button onClick={() => { setPasoPedido(0); setClientePedido(null) }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar cliente
                </button>
              )}
              {pasoPedido === 2 && (
                <button onClick={() => { setPasoPedido(1); setTipoPedidoSeleccionado(null); setFechaEntregaPedido('') }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar tipo
                </button>
              )}
              {pasoPedido === 3 && (
                <button onClick={() => setPasoPedido(2)} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar fecha
                </button>
              )}
              {pasoPedido === 4 && (
                <button onClick={() => setPasoPedido(3)} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Volver
                </button>
              )}
              {/* Progress dots */}
              <div className="flex gap-1.5 mt-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i <= pasoPedido ? 'bg-amber-500' : 'bg-gray-200'}`} />
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3">

              {/* PASO 0: Buscar cliente */}
              {pasoPedido === 0 && (
                <>
                  <input
                    ref={inputClientePedidoRef}
                    type="text"
                    value={busquedaClientePedido}
                    onChange={e => setBusquedaClientePedido(e.target.value)}
                    placeholder="Buscar por nombre, CUIT o codigo..."
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                  />
                  {buscandoClientePedido && (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                  {!buscandoClientePedido && clientesPedido.length > 0 && (
                    <div className="space-y-1">
                      {clientesPedido.map(c => (
                        <button
                          key={c.id || c.id_centum}
                          onClick={() => seleccionarClienteParaPedido(c)}
                          disabled={!c.id_centum}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            c.id_centum
                              ? 'border-gray-100 hover:border-amber-300 hover:bg-amber-50/50'
                              : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800 truncate">{c.razon_social}</span>
                            {!c.id_centum && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Sin Centum</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {c.cuit && <span>{c.cuit}</span>}
                            {c.direccion && <span> · {c.direccion}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!buscandoClientePedido && busquedaClientePedido.trim().length >= 2 && clientesPedido.length === 0 && (
                    <div className="text-center py-4 space-y-3">
                      <p className="text-sm text-gray-400">No se encontraron clientes</p>
                      <button
                        onClick={() => setMostrarCrearClientePedido(true)}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                        <span className="text-sm font-medium">Crear nuevo cliente</span>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* PASO 1: Tipo de pedido */}
              {pasoPedido === 1 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm">
                    <span className="text-gray-500">Cliente:</span>{' '}
                    <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <button
                      onClick={() => seleccionarTipoPedido('delivery')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Delivery</span>
                    </button>
                    <button
                      onClick={() => seleccionarTipoPedido('retiro')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Retiro por Sucursal</span>
                    </button>
                  </div>
                </>
              )}

              {/* PASO 2: Fecha de entrega */}
              {pasoPedido === 2 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha de {tipoPedidoSeleccionado === 'delivery' ? 'entrega' : 'retiro'}
                    </label>
                    <input
                      type="date"
                      value={fechaEntregaPedido}
                      onChange={e => setFechaEntregaPedido(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <button
                    onClick={() => { if (fechaEntregaPedido) setPasoPedido(3) }}
                    disabled={!fechaEntregaPedido}
                    className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors mt-2"
                  >
                    Continuar
                  </button>
                </>
              )}

              {/* PASO 3: Dirección (delivery) o Sucursal (retiro) */}
              {pasoPedido === 3 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                  </div>

                  {cargandoDetallePedido ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600" />
                    </div>
                  ) : tipoPedidoSeleccionado === 'delivery' ? (
                    <>
                      {/* Direcciones del cliente */}
                      {direccionesPedido.length === 0 && !mostrarNuevaDirPedido && (
                        <p className="text-sm text-gray-400 py-2">Este cliente no tiene direcciones cargadas.</p>
                      )}
                      {direccionesPedido.length > 0 && (
                        <div className="space-y-1">
                          {direccionesPedido.map(d => (
                            <button
                              key={d.id}
                              onClick={() => { setDireccionSeleccionadaPedido(d.id); setMostrarNuevaDirPedido(false) }}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                direccionSeleccionadaPedido === d.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm text-gray-800">{d.direccion}</span>
                              {d.localidad && <span className="text-xs text-gray-400 ml-1">({d.localidad})</span>}
                              {d.es_principal && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-2">Principal</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Nueva dirección */}
                      {mostrarNuevaDirPedido ? (
                        <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                          <input
                            type="text"
                            value={nuevaDirPedido.direccion}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, direccion: e.target.value }))}
                            placeholder="Direccion *"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={nuevaDirPedido.localidad}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, localidad: e.target.value }))}
                            placeholder="Localidad"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setMostrarNuevaDirPedido(false); setNuevaDirPedido({ direccion: '', localidad: '' }) }}
                              className="flex-1 text-sm py-2 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={guardarNuevaDirPedido}
                              disabled={guardandoDirPedido || !nuevaDirPedido.direccion.trim()}
                              className="flex-1 text-sm py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                            >
                              {guardandoDirPedido ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMostrarNuevaDirPedido(true); setDireccionSeleccionadaPedido(null) }}
                          className="w-full mt-2 flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          <span className="text-sm font-medium">Nueva direccion</span>
                        </button>
                      )}

                      {/* Botón confirmar delivery */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!direccionSeleccionadaPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Sucursales para retiro */}
                      {sucursalesPedido.length > 0 && (
                        <div className="space-y-1">
                          {sucursalesPedido.map(s => (
                            <button
                              key={s.id}
                              onClick={() => setSucursalSeleccionadaPedido(s.id)}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                sucursalSeleccionadaPedido === s.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm font-medium text-gray-800">{s.nombre}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Botón confirmar retiro */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!sucursalSeleccionadaPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* PASO 4: Pago anticipado */}
              {pasoPedido === 4 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    {fechaEntregaPedido && (
                      <div>
                        <span className="text-gray-500">Fecha:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                    {tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Direccion:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {(() => { const d = direccionesPedido.find(x => x.id === direccionSeleccionadaPedido); return d ? `${d.direccion}${d.localidad ? `, ${d.localidad}` : ''}` : '' })()}
                        </span>
                      </div>
                    )}
                    {tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Sucursal:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)?.nombre || ''}
                        </span>
                      </div>
                    )}
                    <div className="pt-1 border-t border-gray-200 mt-1">
                      <span className="text-gray-500">Total:</span>{' '}
                      <span className="font-bold text-gray-800">{formatPrecio(total)}</span>
                    </div>
                  </div>

                  <div className="text-center py-2">
                    <p className="text-sm font-medium text-gray-700">¿Desea abonar por anticipado?</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => finalizarPedidoWizard(false)}
                      disabled={guardandoPedido}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50"
                    >
                      <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">No, solo guardar</span>
                    </button>
                    <button
                      onClick={() => finalizarPedidoWizard(true)}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all"
                    >
                      <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                      </svg>
                      <span className="text-sm font-medium text-green-700">Si, cobrar ahora</span>
                    </button>
                  </div>
                  {guardandoPedido && (
                    <div className="flex justify-center py-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Modal crear cliente (se superpone) */}
          {mostrarCrearClientePedido && (
            <NuevoClienteModal
              onClose={() => setMostrarCrearClientePedido(false)}
              onCreado={onClientePedidoCreado}
              cuitInicial={busquedaClientePedido.trim()}
            />
          )}
        </div>
      )}
    </div>
  )
}

// Error boundary para diagnosticar pantalla blanca
class POSErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-xl shadow p-6 max-w-lg">
            <h2 className="text-red-600 font-bold text-lg mb-2">Error en POS</h2>
            <pre className="text-sm text-red-800 whitespace-pre-wrap">{this.state.error.message}</pre>
            <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{this.state.error.stack}</pre>
            <button onClick={() => window.location.reload()} className="mt-4 bg-red-600 text-white px-4 py-2 rounded">Recargar</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const POSWithErrorBoundary = () => (
  <POSErrorBoundary>
    <POS />
  </POSErrorBoundary>
)

export default POSWithErrorBoundary
