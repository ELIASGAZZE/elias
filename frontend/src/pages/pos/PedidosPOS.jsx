// Página de Pedidos POS — ventana separada del POS
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import ModalArticulosPedidos from '../../components/pos/ModalArticulosPedidos'
import ModalGuiaDelivery from '../../components/pos/ModalGuiaDelivery'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const FILTROS_ESTADO = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'entregado', label: 'Entregados' },
  { value: 'cancelado', label: 'Cancelados' },
  { value: 'todos', label: 'Todos' },
]

const hoyISO = () => new Date().toISOString().split('T')[0]

const FILTROS_KEY = 'pedidos_pos_filtros'

function getFiltrosGuardados(defaultSucursal) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTROS_KEY))
    if (saved) return saved
  } catch {}
  return { estado: 'pendiente', fecha: '', sucursal: '' }
}

const PedidosPOS = ({ embebido, terminalConfig, onEntregarPedido, onEditarPedido, onCobrarEnCaja }) => {
  const { usuario, esAdmin } = useAuth()
  const filtrosIniciales = getFiltrosGuardados(terminalConfig?.sucursal_id)
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState(filtrosIniciales.estado)
  const [filtroFecha, setFiltroFecha] = useState(filtrosIniciales.fecha)
  const [filtroSucursal, setFiltroSucursal] = useState(filtrosIniciales.sucursal)
  const [filtroTipo, setFiltroTipo] = useState(filtrosIniciales.tipo || 'todos')
  const [filtroPago, setFiltroPago] = useState(filtrosIniciales.pago || 'todos')
  const [sucursales, setSucursales] = useState([])
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [generandoLink, setGenerandoLink] = useState(null)
  const [linkCopiado, setLinkCopiado] = useState(null)
  const [mostrarArticulos, setMostrarArticulos] = useState(false)
  const [mostrarGuiaDelivery, setMostrarGuiaDelivery] = useState(false)

  // Cargar sucursales para el dropdown
  useEffect(() => {
    api.get('/api/sucursales')
      .then(({ data }) => setSucursales((data || []).filter(s => s.permite_pedidos)))
      .catch(() => {})
  }, [])

  // Persistir filtros en sessionStorage
  useEffect(() => {
    sessionStorage.setItem(FILTROS_KEY, JSON.stringify({ estado: filtroEstado, fecha: filtroFecha, sucursal: filtroSucursal, tipo: filtroTipo, pago: filtroPago }))
  }, [filtroEstado, filtroFecha, filtroSucursal, filtroTipo, filtroPago])

  // Debounce de búsqueda (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setBusquedaDebounced(busqueda), 400)
    return () => clearTimeout(timer)
  }, [busqueda])

  const cargarPedidos = useCallback(async () => {
    setCargando(true)
    try {
      const params = { estado: filtroEstado }
      if (filtroTipo !== 'todos') params.tipo = filtroTipo
      if (busquedaDebounced.trim()) {
        // Con búsqueda: solo filtrar por estado + nombre (ignorar fecha/sucursal)
        params.busqueda = busquedaDebounced.trim()
      } else {
        // Sin búsqueda: aplicar filtros de fecha y sucursal
        if (filtroFecha) params.fecha = filtroFecha
        if (filtroSucursal) params.sucursal_id = filtroSucursal
      }
      const { data } = await api.get('/api/pos/pedidos', { params })
      setPedidos(data.pedidos || [])
    } catch (err) {
      console.error('Error cargando pedidos:', err)
    } finally {
      setCargando(false)
    }
  }, [filtroEstado, filtroFecha, filtroSucursal, filtroTipo, busquedaDebounced])

  useEffect(() => {
    cargarPedidos()
  }, [cargarPedidos])

  // Filtrar por estado de pago (client-side)
  const pedidosFiltrados = useMemo(() => {
    if (filtroPago === 'todos') return pedidos
    return pedidos.filter(p => {
      const obs = p.observaciones || ''
      const totalPagado = parseFloat(p.total_pagado) || 0
      const esPagado = obs.includes('PAGO ANTICIPADO') || totalPagado > 0
      const pagaEfectivo = obs.includes('PAGO EN ENTREGA: EFECTIVO')
      if (filtroPago === 'pago') return esPagado
      if (filtroPago === 'efectivo') return pagaEfectivo
      if (filtroPago === 'no_pago') return !esPagado && !pagaEfectivo
      return true
    })
  }, [pedidos, filtroPago])

  async function marcarPagaEfectivo(pedidoId) {
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/pago`, {
        total_pagado: 0,
        observaciones: 'PAGO EN ENTREGA: EFECTIVO',
      })
      cargarPedidos()
    } catch (err) {
      console.error('Error marcando paga en efectivo:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function cambiarEstado(pedidoId, estado) {
    const pedido = pedidos.find(p => p.id === pedidoId)
    const esPagado = pedido && (pedido.observaciones || '').includes('PAGO ANTICIPADO')
    const totalPagado = pedido ? (parseFloat(pedido.total_pagado) || 0) : 0

    if (estado === 'cancelado' && esPagado && totalPagado > 0) {
      if (!confirm(`Se generará saldo a favor de ${formatPrecio(totalPagado)} para el cliente.\n\n¿Cancelar pedido?`)) return
    } else {
      if (!confirm(`¿Marcar pedido como "${estado}"?`)) return
    }
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/estado`, { estado })
      setPedidos(prev => prev.filter(p => p.id !== pedidoId))
      setPedidoSeleccionado(null)
    } catch (err) {
      console.error('Error cambiando estado:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function generarLinkMP(pedidoId) {
    setGenerandoLink(pedidoId)
    try {
      const { data } = await api.post(`/api/pos/pedidos/${pedidoId}/link-pago`)
      if (data.link) {
        try {
          await navigator.clipboard.writeText(data.link)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = data.link
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setLinkCopiado(pedidoId)
        setTimeout(() => setLinkCopiado(null), 2000)
        // El backend ya actualiza observaciones al generar el link
        cargarPedidos()
      }
    } catch (err) {
      console.error('Error generando link MP:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGenerandoLink(null)
    }
  }

  // Datos del pedido seleccionado para el drawer
  const pedidoDetalle = useMemo(() => {
    if (!pedidoSeleccionado) return null
    const p = pedidos.find(p => p.id === pedidoSeleccionado)
    if (!p) return null
    const totalPagado = parseFloat(p.total_pagado) || 0
    const esPagado = (p.observaciones || '').includes('PAGO ANTICIPADO') || totalPagado > 0
    const pagaEfectivoEntrega = (p.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
    const pagaConLink = (p.observaciones || '').match(/PAGO PENDIENTE: LINK (MP|TALO)/)
    const diferencia = esPagado ? (p.total - totalPagado) : 0
    return {
      ...p,
      items: typeof p.items === 'string' ? JSON.parse(p.items) : p.items,
      esPagado,
      pagaEfectivoEntrega,
      pagaConLink,
      totalPagado,
      diferencia, // >0 debe más, <0 devolver
    }
  }, [pedidoSeleccionado, pedidos])

  return (
    <div className={embebido ? 'h-full bg-gray-50 flex flex-col overflow-hidden' : 'min-h-screen bg-gray-50'}>
      {/* Header — solo en modo standalone */}
      {!embebido && (
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a href="/apps" className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                </svg>
              </a>
              <h1 className="text-lg font-bold text-gray-800">Pedidos POS</h1>
            </div>
            <button
              onClick={cargarPedidos}
              className="text-sm text-violet-600 hover:text-violet-700 font-medium"
            >
              Actualizar
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className={embebido ? 'px-4 pt-3 space-y-2' : 'max-w-4xl mx-auto px-4 pt-4 space-y-2'}>
        {/* Fila 1: estados + actualizar */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {FILTROS_ESTADO.map(f => (
              <button
                key={f.value}
                onClick={() => setFiltroEstado(f.value)}
                className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  filtroEstado === f.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-gray-600 border hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setMostrarGuiaDelivery(true)}
              className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Guía envíos
            </button>
            <button
              onClick={() => setMostrarArticulos(true)}
              className="text-sm bg-violet-100 hover:bg-violet-200 text-violet-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Ver Artículos
            </button>
            {embebido && (
              <button onClick={cargarPedidos} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
                Actualizar
              </button>
            )}
          </div>
        </div>

        {/* Fila 2: fecha + sucursal + buscador */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filtroFecha}
            onChange={e => setFiltroFecha(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
          <select
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[100px]"
          >
            <option value="todos">Todos</option>
            <option value="delivery">Delivery</option>
            <option value="retiro">Retiro</option>
          </select>
          <select
            value={filtroPago}
            onChange={e => setFiltroPago(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[110px]"
          >
            <option value="todos">Todo pago</option>
            <option value="pago">Pagó</option>
            <option value="efectivo">Paga en efectivo</option>
            <option value="no_pago">No pagó</option>
          </select>
          <select
            value={filtroSucursal}
            onChange={e => setFiltroSucursal(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[140px]"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre de cliente..."
              className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {busquedaDebounced.trim() && (
          <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded">
            Buscando por nombre en todos los pedidos {filtroEstado !== 'todos' ? filtroEstado + 's' : ''} (sin filtro de fecha/sucursal)
          </p>
        )}
      </div>

      {/* Lista */}
      <div className={embebido ? 'flex-1 overflow-y-auto px-4 py-3' : 'max-w-4xl mx-auto px-4 py-4'}>
        {cargando ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Cargando pedidos...
          </div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            {busqueda ? 'Sin resultados para la búsqueda' : `No hay pedidos ${filtroEstado !== 'todos' ? filtroEstado + 's' : ''}`}
          </div>
        ) : pedidosFiltrados.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            No hay pedidos con ese filtro de pago
          </div>
        ) : (
          <div className="space-y-3">
            {pedidosFiltrados.map(pedido => {
              const fecha = new Date(pedido.created_at)
              const totalPagado = parseFloat(pedido.total_pagado) || 0
              const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO') || totalPagado > 0
              const pagaEfectivoEntrega = (pedido.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
              const pagaConLink = (pedido.observaciones || '').match(/PAGO PENDIENTE: LINK (MP|TALO)/)
              const diferencia = esPagado ? (pedido.total - totalPagado) : 0
              const items = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items

              return (
                <div
                  key={pedido.id}
                  className={`bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:bg-gray-50 transition-colors ${pedidoSeleccionado === pedido.id ? 'ring-2 ring-violet-500' : ''}`}
                  onClick={() => setPedidoSeleccionado(pedidoSeleccionado === pedido.id ? null : pedido.id)}
                >
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pedido.numero && (
                          <span className="text-xs font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                            #{pedido.numero}
                          </span>
                        )}
                        <span className="text-sm font-semibold text-gray-800 truncate">
                          {pedido.nombre_cliente || 'Consumidor Final'}
                        </span>
                        {pedido.tipo && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            pedido.tipo === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {pedido.tipo === 'delivery' ? 'Delivery' : 'Retiro'}
                          </span>
                        )}
                        {esPagado ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700">
                            Pagó
                          </span>
                        ) : pagaEfectivoEntrega ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">
                            Paga en efectivo
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">
                            No pagó
                          </span>
                        )}
                        {esPagado && diferencia > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">
                            Debe {formatPrecio(diferencia)}
                          </span>
                        )}
                        {esPagado && diferencia < 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700">
                            Saldo +{formatPrecio(Math.abs(diferencia))}
                          </span>
                        )}
                        {pedido.estado !== 'pendiente' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            pedido.estado === 'entregado' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            {pedido.estado.charAt(0).toUpperCase() + pedido.estado.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm font-bold text-gray-800">{formatPrecio(pedido.total)}</span>
                        <span className="text-xs text-gray-400">{items.length} art.</span>
                      </div>
                    </div>
                    {pedido.fecha_entrega && (
                      <div className="mt-1">
                        <span className="text-base font-bold text-purple-600">Entrega: {new Date(pedido.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span>
                        {fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {pedido.turno_entrega && (
                        <>
                          <span>|</span>
                          <span className="font-medium">{pedido.turno_entrega === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                        </>
                      )}
                      {pedido.sucursales?.nombre && (
                        <>
                          <span>|</span>
                          <span>{pedido.sucursales.nombre}</span>
                        </>
                      )}
                      {pedido.perfiles?.nombre && (
                        <>
                          <span>|</span>
                          <span>Cajero: {pedido.perfiles.nombre}</span>
                        </>
                      )}
                    </div>
                    {/* Botones de acción en la card */}
                    {pedido.estado === 'pendiente' && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                        {onEditarPedido && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditarPedido({ ...pedido, items, esPagado, totalPagado: parseFloat(pedido.total_pagado) || 0, diferencia }); setPedidoSeleccionado(null) }}
                            className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (esPagado && diferencia > 0) { alert(`Falta cobrar ${formatPrecio(diferencia)} antes de entregar`); return }
                            onEntregarPedido ? onEntregarPedido({ ...pedido, items, esPagado, totalPagado: parseFloat(pedido.total_pagado) || 0, diferencia }) : cambiarEstado(pedido.id, 'entregado')
                          }}
                          className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                        >
                          {esPagado && diferencia < 0 ? `Entregar (saldo +${formatPrecio(Math.abs(diferencia))})` : 'Entregar'}
                        </button>
                        {(!esPagado || diferencia > 0) && (<>
                          {onCobrarEnCaja && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onCobrarEnCaja({ id: pedido.id, total: diferencia > 0 ? diferencia : pedido.total, items: pedido.items, nombre_cliente: pedido.nombre_cliente, id_cliente_centum: pedido.id_cliente_centum }) }}
                              className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                            >
                              {diferencia > 0 ? `Cobrar dif. ${formatPrecio(diferencia)}` : 'Cobrar en caja'}
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); generarLinkMP(pedido.id) }}
                            disabled={generandoLink === pedido.id}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                          >
                            {generandoLink === pedido.id ? (
                              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                            ) : linkCopiado === pedido.id ? 'Copiado!' : diferencia > 0 ? `Link dif. ${formatPrecio(diferencia)}` : 'Link pago'}
                          </button>
                        </>)}
                        {!esPagado && !pagaEfectivoEntrega && (
                          <button
                            onClick={(e) => { e.stopPropagation(); marcarPagaEfectivo(pedido.id) }}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                          >
                            Paga en efectivo
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); cambiarEstado(pedido.id, 'cancelado') }}
                          className="bg-red-100 hover:bg-red-200 text-red-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Drawer lateral derecho */}
      {pedidoDetalle && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setPedidoSeleccionado(null)}
          />
          {/* Panel */}
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
            {/* Header del drawer */}
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  {pedidoDetalle.numero && (
                    <span className="text-sm font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded">
                      #{pedidoDetalle.numero}
                    </span>
                  )}
                  <h2 className="text-lg font-bold text-gray-800">
                    {pedidoDetalle.nombre_cliente || 'Consumidor Final'}
                  </h2>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>
                    {new Date(pedidoDetalle.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                    {new Date(pedidoDetalle.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {pedidoDetalle.tipo && (
                    <>
                      <span>|</span>
                      <span className={`px-1.5 py-0.5 rounded font-medium ${
                        pedidoDetalle.tipo === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {pedidoDetalle.tipo === 'delivery' ? 'Delivery' : 'Retiro'}
                      </span>
                    </>
                  )}
                  {pedidoDetalle.esPagado ? (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700">Pagó</span>
                  ) : pedidoDetalle.pagaEfectivoEntrega ? (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">Paga en efectivo</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">No pagó</span>
                  )}
                  {pedidoDetalle.estado !== 'pendiente' && (
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      pedidoDetalle.estado === 'entregado' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {pedidoDetalle.estado.charAt(0).toUpperCase() + pedidoDetalle.estado.slice(1)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setPedidoSeleccionado(null)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Items scrolleables */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Badges de diferencia en el drawer */}
              {pedidoDetalle.esPagado && pedidoDetalle.diferencia !== 0 && (
                <div className={`mb-3 px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${
                  pedidoDetalle.diferencia > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  <span>
                    {pedidoDetalle.diferencia > 0
                      ? `Debe ${formatPrecio(pedidoDetalle.diferencia)}`
                      : `Saldo a favor: +${formatPrecio(Math.abs(pedidoDetalle.diferencia))}`
                    }
                  </span>
                  <span className="text-xs opacity-70">Pagó {formatPrecio(pedidoDetalle.totalPagado)}</span>
                </div>
              )}

              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                {pedidoDetalle.items.length} artículos
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left font-medium pb-2">Producto</th>
                    <th className="text-center font-medium pb-2 w-14">Cant.</th>
                    <th className="text-right font-medium pb-2 w-24">Precio</th>
                    <th className="text-right font-medium pb-2 w-24">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pedidoDetalle.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 text-gray-700">{item.nombre}</td>
                      <td className="py-2 text-center text-gray-500">{item.cantidad}</td>
                      <td className="py-2 text-right text-gray-500">{formatPrecio(item.precio)}</td>
                      <td className="py-2 text-right font-medium text-gray-700">{formatPrecio(item.precio * item.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Observaciones */}
              {pedidoDetalle.observaciones && (
                <div className="mt-4 px-3 py-2 text-xs text-gray-600 bg-amber-50 rounded-lg border border-amber-100">
                  {pedidoDetalle.observaciones}
                </div>
              )}

              {/* Info extra */}
              {pedidoDetalle.fecha_entrega && (
                <div className="mt-3 text-xs text-gray-500">
                  Fecha entrega: {new Date(pedidoDetalle.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </div>
              )}
              {pedidoDetalle.turno_entrega && (
                <div className="mt-1 text-xs text-gray-500">
                  Turno: <span className="font-medium text-gray-700">{pedidoDetalle.turno_entrega === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                </div>
              )}
              {pedidoDetalle.sucursales?.nombre && (
                <div className="mt-1 text-xs text-gray-500">
                  Sucursal: {pedidoDetalle.sucursales.nombre}
                </div>
              )}
              {pedidoDetalle.perfiles?.nombre && (
                <div className="mt-1 text-xs text-gray-500">
                  Cajero: {pedidoDetalle.perfiles.nombre}
                </div>
              )}
            </div>

            {/* Footer con total + acciones */}
            <div className="border-t bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">Total</span>
                <span className="text-xl font-bold text-gray-800">{formatPrecio(pedidoDetalle.total)}</span>
              </div>

              {pedidoDetalle.estado === 'pendiente' && (
                <div className="flex flex-wrap gap-2">
                  {onEditarPedido && (
                    <button
                      onClick={() => { onEditarPedido(pedidoDetalle); setPedidoSeleccionado(null) }}
                      className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (pedidoDetalle.esPagado && pedidoDetalle.diferencia > 0) {
                        alert(`Falta cobrar ${formatPrecio(pedidoDetalle.diferencia)} antes de entregar`)
                        return
                      }
                      onEntregarPedido ? onEntregarPedido(pedidoDetalle) : cambiarEstado(pedidoDetalle.id, 'entregado')
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                  >
                    {pedidoDetalle.esPagado && pedidoDetalle.diferencia < 0
                      ? `Entregar (saldo +${formatPrecio(Math.abs(pedidoDetalle.diferencia))})`
                      : onEntregarPedido ? 'Entregar' : 'Marcar entregado'
                    }
                  </button>
                  {(!pedidoDetalle.esPagado || pedidoDetalle.diferencia > 0) && (<>
                    {onCobrarEnCaja && (
                      <button
                        onClick={() => { setPedidoSeleccionado(null); onCobrarEnCaja({ id: pedidoDetalle.id, total: pedidoDetalle.diferencia > 0 ? pedidoDetalle.diferencia : pedidoDetalle.total, items: pedidoDetalle.items, nombre_cliente: pedidoDetalle.nombre_cliente, id_cliente_centum: pedidoDetalle.id_cliente_centum }) }}
                        className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {pedidoDetalle.diferencia > 0 ? `Cobrar dif. ${formatPrecio(pedidoDetalle.diferencia)}` : 'Cobrar en caja'}
                      </button>
                    )}
                    <button
                      onClick={() => generarLinkMP(pedidoDetalle.id)}
                      disabled={generandoLink === pedidoDetalle.id}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {generandoLink === pedidoDetalle.id ? 'Generando...' : linkCopiado === pedidoDetalle.id ? 'Copiado!' : pedidoDetalle.diferencia > 0 ? `Link dif. ${formatPrecio(pedidoDetalle.diferencia)}` : 'Link pago'}
                    </button>
                  </>)}
                  {!pedidoDetalle.esPagado && !pedidoDetalle.pagaEfectivoEntrega && (
                    <button
                      onClick={() => { marcarPagaEfectivo(pedidoDetalle.id); setPedidoSeleccionado(null) }}
                      className="bg-amber-100 hover:bg-amber-200 text-amber-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Paga en efectivo
                    </button>
                  )}
                  <button
                    onClick={() => cambiarEstado(pedidoDetalle.id, 'cancelado')}
                    className="bg-red-100 hover:bg-red-200 text-red-600 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal artículos a preparar */}
      {mostrarArticulos && (
        <ModalArticulosPedidos
          onCerrar={() => setMostrarArticulos(false)}
          terminalConfig={terminalConfig}
          sucursales={sucursales}
        />
      )}

      {/* Modal guía de delivery */}
      {mostrarGuiaDelivery && (
        <ModalGuiaDelivery onCerrar={() => setMostrarGuiaDelivery(false)} cajaId={terminalConfig?.caja_id} />
      )}

      {/* CSS para animación del drawer */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
    </div>
  )
}

export default PedidosPOS
