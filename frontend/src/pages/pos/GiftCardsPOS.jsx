// Gestión de Gift Cards — embebido en POS
import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../services/api'
import ModalCobrar from '../../components/pos/ModalCobrar'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const ESTADOS = [
  { value: '', label: 'Todas' },
  { value: 'activa', label: 'Activas' },
  { value: 'agotada', label: 'Agotadas' },
  { value: 'anulada', label: 'Anuladas' },
]

const BADGE_COLORS = {
  activa: 'bg-emerald-100 text-emerald-700',
  agotada: 'bg-gray-100 text-gray-600',
  anulada: 'bg-red-100 text-red-700',
}

export default function GiftCardsPOS({ embebido }) {
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'admin'

  // Activar
  const [codigo, setCodigo] = useState('')
  const [monto, setMonto] = useState('')
  const [compradorNombre, setCompradorNombre] = useState('')
  const [activando, setActivando] = useState(false)
  const [msgActivar, setMsgActivar] = useState(null)
  const codigoRef = useRef(null)
  const [mostrarCobro, setMostrarCobro] = useState(false) // ModalCobrar
  const [datosPendientes, setDatosPendientes] = useState(null) // { codigo, monto, comprador_nombre }

  // Lista
  const [giftCards, setGiftCards] = useState([])
  const [cargando, setCargando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [buscar, setBuscar] = useState('')

  // Drawer
  const [cardSeleccionada, setCardSeleccionada] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [anulando, setAnulando] = useState(false)

  // Consulta individual (operarios)
  const [consultaCodigo, setConsultaCodigo] = useState('')
  const [consultaResult, setConsultaResult] = useState(null) // { gift_card, movimientos } | null
  const [consultaError, setConsultaError] = useState(null)
  const [consultando, setConsultando] = useState(false)
  const consultaRef = useRef(null)

  useEffect(() => {
    if (esAdmin) cargarGiftCards()
  }, [filtroEstado])

  async function cargarGiftCards() {
    setCargando(true)
    try {
      const params = new URLSearchParams()
      if (filtroEstado) params.append('estado', filtroEstado)
      if (buscar.trim()) params.append('buscar', buscar.trim())
      const { data } = await api.get(`/api/gift-cards?${params}`)
      setGiftCards(data.gift_cards || [])
    } catch (err) {
      console.error('Error cargando gift cards:', err)
    } finally {
      setCargando(false)
    }
  }

  async function handleConsulta(e) {
    e.preventDefault()
    if (!consultaCodigo.trim()) return
    setConsultando(true)
    setConsultaError(null)
    setConsultaResult(null)
    try {
      const { data } = await api.get(`/api/gift-cards/consultar/${encodeURIComponent(consultaCodigo.trim())}`)
      setConsultaResult(data)
    } catch (err) {
      setConsultaError(err.response?.data?.error || 'Gift card no encontrada')
    } finally {
      setConsultando(false)
    }
  }

  function handleActivar(e) {
    e.preventDefault()
    if (!codigo.trim() || !monto || parseFloat(monto) <= 0) return

    setMsgActivar(null)
    // Guardar datos y abrir ModalCobrar
    setDatosPendientes({
      codigo: codigo.trim(),
      monto: parseFloat(monto),
      comprador_nombre: compradorNombre.trim() || null,
    })
    setMostrarCobro(true)
  }

  async function handleCobroConfirmado(datosPago) {
    // datosPago viene de ModalCobrar en modo soloPago: { pagos, total, monto_pagado, vuelto }
    setMostrarCobro(false)
    setActivando(true)
    try {
      await api.post('/api/gift-cards/activar', {
        ...datosPendientes,
        pagos: datosPago.pagos,
      })
      setMsgActivar({ tipo: 'ok', texto: `Gift card ${datosPendientes.codigo} activada por ${formatPrecio(datosPendientes.monto)}` })
      setCodigo('')
      setMonto('')
      setCompradorNombre('')
      setDatosPendientes(null)
      codigoRef.current?.focus()
      cargarGiftCards()
    } catch (err) {
      setMsgActivar({ tipo: 'error', texto: err.response?.data?.error || 'Error al activar' })
    } finally {
      setActivando(false)
    }
  }

  function handleBuscar(e) {
    e.preventDefault()
    cargarGiftCards()
  }

  async function abrirDetalle(gc) {
    setCardSeleccionada(gc)
    setCargandoDetalle(true)
    try {
      const { data } = await api.get(`/api/gift-cards/consultar/${gc.codigo}`)
      setCardSeleccionada(data.gift_card)
      setMovimientos(data.movimientos || [])
    } catch (err) {
      console.error('Error cargando detalle:', err)
    } finally {
      setCargandoDetalle(false)
    }
  }

  async function handleAnular() {
    if (!cardSeleccionada || !window.confirm('¿Anular esta gift card? Se perderá el saldo restante.')) return
    setAnulando(true)
    try {
      await api.put(`/api/gift-cards/${cardSeleccionada.id}/anular`)
      setCardSeleccionada(prev => ({ ...prev, estado: 'anulada', saldo: 0 }))
      cargarGiftCards()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al anular')
    } finally {
      setAnulando(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Zona superior: Activar gift card (solo admin) */}
      {esAdmin && <div className="flex-shrink-0 bg-white border-b px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Activar Gift Card</h3>
        <form onSubmit={handleActivar} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Código (escanear)</label>
            <input
              ref={codigoRef}
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              placeholder="Escanear o tipear código..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              autoFocus
            />
          </div>
          <div className="w-36">
            <label className="block text-xs text-gray-500 mb-1">Monto</label>
            <input
              type="number"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              placeholder="$0"
              min="0"
              step="0.01"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
          <div className="w-44">
            <label className="block text-xs text-gray-500 mb-1">Comprador (opcional)</label>
            <input
              type="text"
              value={compradorNombre}
              onChange={e => setCompradorNombre(e.target.value)}
              placeholder="Nombre..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
          <button
            type="submit"
            disabled={activando || !codigo.trim() || !monto}
            className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
          >
            {activando ? 'Activando...' : 'Activar'}
          </button>
        </form>
        {msgActivar && (
          <div className={`mt-2 text-sm font-medium ${msgActivar.tipo === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
            {msgActivar.texto}
          </div>
        )}
      </div>}

      {/* --- Vista OPERARIO: solo consultar por código --- */}
      {!esAdmin && (
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8">
          <div className="w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-700 text-center mb-1">Consultar Gift Card</h3>
            <p className="text-sm text-gray-400 text-center mb-5">Ingresá o escaneá el código de la gift card</p>
            <form onSubmit={handleConsulta} className="flex gap-2 mb-5">
              <input
                ref={consultaRef}
                type="text"
                value={consultaCodigo}
                onChange={e => { setConsultaCodigo(e.target.value); setConsultaResult(null); setConsultaError(null) }}
                placeholder="Código de gift card..."
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={consultando || !consultaCodigo.trim()}
                className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                {consultando ? 'Buscando...' : 'Consultar'}
              </button>
            </form>

            {consultaError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 text-center">
                {consultaError}
              </div>
            )}

            {consultaResult && consultaResult.gift_card && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-sm font-semibold text-gray-800">{consultaResult.gift_card.codigo}</span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${BADGE_COLORS[consultaResult.gift_card.estado]}`}>
                    {consultaResult.gift_card.estado}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <span className="text-xs text-gray-500">Saldo actual</span>
                    <span className="block text-2xl font-bold text-emerald-600">{formatPrecio(parseFloat(consultaResult.gift_card.saldo))}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Monto inicial</span>
                    <span className="block text-2xl font-bold text-gray-400">{formatPrecio(parseFloat(consultaResult.gift_card.monto_inicial))}</span>
                  </div>
                </div>
                {consultaResult.movimientos && consultaResult.movimientos.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Últimos movimientos</h4>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {consultaResult.movimientos.map(m => (
                        <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                          <div>
                            <span className="block text-sm text-gray-700">{m.motivo}</span>
                            <span className="block text-xs text-gray-400">{new Date(m.created_at).toLocaleString('es-AR')}</span>
                          </div>
                          <span className={`text-sm font-bold ${parseFloat(m.monto) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {parseFloat(m.monto) >= 0 ? '+' : ''}{formatPrecio(parseFloat(m.monto))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Vista ADMIN: filtros + lista completa --- */}
      {esAdmin && <>
        {/* Filtros */}
        <div className="flex-shrink-0 px-5 py-3 flex items-center gap-3 bg-white border-b">
          <div className="flex gap-1.5">
            {ESTADOS.map(e => (
              <button
                key={e.value}
                onClick={() => setFiltroEstado(e.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filtroEstado === e.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleBuscar} className="flex-1 flex gap-2">
            <input
              type="text"
              value={buscar}
              onChange={e => setBuscar(e.target.value)}
              placeholder="Buscar por código..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
            <button type="submit" className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              Buscar
            </button>
          </form>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {cargando ? (
            <div className="text-center text-gray-400 py-12">Cargando...</div>
          ) : giftCards.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No hay gift cards</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {giftCards.map(gc => (
                <button
                  key={gc.id}
                  onClick={() => abrirDetalle(gc)}
                  className="bg-white rounded-xl border border-gray-200 p-4 text-left hover:shadow-md hover:border-violet-300 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-semibold text-gray-800">{gc.codigo}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_COLORS[gc.estado] || 'bg-gray-100'}`}>
                      {gc.estado}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-xs text-gray-500">Saldo</span>
                      <span className="block text-lg font-bold text-gray-900">{formatPrecio(parseFloat(gc.saldo))}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400">Monto inicial</span>
                      <span className="block text-sm text-gray-500">{formatPrecio(parseFloat(gc.monto_inicial))}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span className="truncate">{gc.comprador_nombre || ''}</span>
                    <span className="flex-shrink-0 ml-2">{gc.created_at ? new Date(gc.created_at).toLocaleDateString('es-AR') : ''}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </>}

      {/* Drawer lateral */}
      {cardSeleccionada && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setCardSeleccionada(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-lg font-bold text-gray-800">Gift Card</h3>
              <button onClick={() => setCardSeleccionada(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Info */}
            <div className="px-5 py-4 border-b space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-lg font-bold">{cardSeleccionada.codigo}</span>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${BADGE_COLORS[cardSeleccionada.estado]}`}>
                  {cardSeleccionada.estado}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-500">Saldo actual</span>
                  <span className="block text-2xl font-bold text-emerald-600">{formatPrecio(parseFloat(cardSeleccionada.saldo))}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Monto inicial</span>
                  <span className="block text-2xl font-bold text-gray-400">{formatPrecio(parseFloat(cardSeleccionada.monto_inicial))}</span>
                </div>
              </div>
              {cardSeleccionada.comprador_nombre && (
                <div>
                  <span className="text-xs text-gray-500">Comprador</span>
                  <span className="block text-sm text-gray-700">{cardSeleccionada.comprador_nombre}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-500">Creada</span>
                  <span className="block text-sm text-gray-700">{new Date(cardSeleccionada.created_at).toLocaleString('es-AR')}</span>
                </div>
                {cardSeleccionada.cajero_nombre && (
                  <div>
                    <span className="text-xs text-gray-500">Cajero</span>
                    <span className="block text-sm text-gray-700">{cardSeleccionada.cajero_nombre}</span>
                  </div>
                )}
              </div>
              {(cardSeleccionada.venta_activacion || cardSeleccionada.caja_nombre || (Array.isArray(cardSeleccionada.pagos) && cardSeleccionada.pagos.length > 0)) && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 space-y-1.5">
                  <span className="text-xs font-semibold text-violet-700 uppercase">Datos de activación</span>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {cardSeleccionada.venta_activacion?.numero_venta && (
                      <div>
                        <span className="text-[10px] text-gray-500">Nro. venta</span>
                        <span className="block text-sm font-medium text-gray-800">#{cardSeleccionada.venta_activacion.numero_venta}</span>
                      </div>
                    )}
                    {cardSeleccionada.caja_nombre && (
                      <div>
                        <span className="text-[10px] text-gray-500">Caja</span>
                        <span className="block text-sm text-gray-700">{cardSeleccionada.caja_nombre}</span>
                      </div>
                    )}
                    {cardSeleccionada.venta_activacion?.sucursal_nombre && (
                      <div>
                        <span className="text-[10px] text-gray-500">Sucursal</span>
                        <span className="block text-sm text-gray-700">{cardSeleccionada.venta_activacion.sucursal_nombre}</span>
                      </div>
                    )}
                    {Array.isArray(cardSeleccionada.pagos) && cardSeleccionada.pagos.length > 0 && (
                      <div>
                        <span className="text-[10px] text-gray-500">Forma de cobro</span>
                        <span className="block text-sm text-gray-700">
                          {cardSeleccionada.pagos.map(p => p.tipo || p.nombre).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Movimientos */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Historial</h4>
              {cargandoDetalle ? (
                <div className="text-gray-400 text-center py-6">Cargando...</div>
              ) : movimientos.length === 0 ? (
                <div className="text-gray-400 text-center py-6">Sin movimientos</div>
              ) : (
                <div className="space-y-2">
                  {movimientos.map(m => (
                    <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <span className="block text-sm font-medium text-gray-700">
                          {m.motivo}
                          {m.numero_venta ? <span className="text-gray-400 font-normal"> · Venta #{m.numero_venta}</span> : ''}
                        </span>
                        <span className="block text-xs text-gray-400">
                          {new Date(m.created_at).toLocaleString('es-AR')}
                          {m.venta_cajero ? ` · ${m.venta_cajero}` : ''}
                        </span>
                      </div>
                      <span className={`text-sm font-bold flex-shrink-0 ml-2 ${parseFloat(m.monto) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {parseFloat(m.monto) >= 0 ? '+' : ''}{formatPrecio(parseFloat(m.monto))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Botón anular (admin) */}
            {esAdmin && cardSeleccionada.estado === 'activa' && (
              <div className="px-5 py-4 border-t">
                <button
                  onClick={handleAnular}
                  disabled={anulando}
                  className="w-full bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {anulando ? 'Anulando...' : 'Anular Gift Card'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ModalCobrar para cobrar la activación */}
      {mostrarCobro && datosPendientes && (
        <ModalCobrar
          total={datosPendientes.monto}
          subtotal={datosPendientes.monto}
          descuentoTotal={0}
          ivaTotal={0}
          carrito={[]}
          cliente={{ id_centum: 0, razon_social: datosPendientes.comprador_nombre || 'Gift Card' }}
          promosAplicadas={[]}
          onConfirmar={handleCobroConfirmado}
          onCerrar={() => { setMostrarCobro(false); setDatosPendientes(null) }}
          isOnline={true}
          soloPago
        />
      )}
    </div>
  )
}
