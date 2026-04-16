// Módulo Posventa Mercado Libre — Mensajes, Reclamos, Devoluciones
import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../../services/api'

const formatMoney = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)
const formatFecha = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const timeAgo = (iso) => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `hace ${days}d`
}

const TABS = [
  { key: 'mensajes', label: 'Mensajes', icon: '💬' },
  { key: 'reclamos', label: 'Reclamos', icon: '⚠️' },
  { key: 'devoluciones', label: 'Devoluciones', icon: '📦' },
]

const MLPosventa = () => {
  const [tab, setTab] = useState('mensajes')
  const [contadores, setContadores] = useState({ mensajes_pendientes: 0, reclamos_abiertos: 0, devoluciones_activas: 0 })
  const [sincronizando, setSincronizando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  const cargarContadores = useCallback(async () => {
    try {
      const { data } = await api.get('/api/mercadolibre/posventa/contadores')
      setContadores(data)
    } catch {}
  }, [])

  useEffect(() => { cargarContadores() }, [cargarContadores])

  const syncPosventa = async () => {
    setSincronizando(true)
    try {
      await api.post('/api/mercadolibre/posventa/sync')
      await cargarContadores()
      setMensaje({ tipo: 'ok', texto: 'Posventa sincronizada' })
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al sincronizar' })
    } finally {
      setSincronizando(false)
    }
  }

  const badgeCount = (key) => {
    if (key === 'mensajes') return contadores.mensajes_pendientes
    if (key === 'reclamos') return contadores.reclamos_abiertos
    if (key === 'devoluciones') return contadores.devoluciones_activas
    return 0
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/mercadolibre" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="font-bold text-gray-800 text-lg">Posventa ML</h1>
            <p className="text-xs text-gray-400">Mensajes, reclamos y devoluciones</p>
          </div>
        </div>
        <button
          onClick={syncPosventa}
          disabled={sincronizando}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
        >
          <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      </nav>

      {/* Mensaje */}
      {mensaje && (
        <div className={`mx-4 mt-4 p-3 rounded-lg text-sm ${
          mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {mensaje.texto}
          <button onClick={() => setMensaje(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 mb-6">
          {TABS.map(t => {
            const count = badgeCount(t.key)
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-yellow-400 text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {count > 0 && (
                  <span className={`min-w-[20px] h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                    active ? 'bg-gray-900 text-yellow-400' : 'bg-red-500 text-white'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Contenido */}
        {tab === 'mensajes' && <TabMensajes onUpdate={cargarContadores} />}
        {tab === 'reclamos' && <TabReclamos />}
        {tab === 'devoluciones' && <TabDevoluciones />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Tab Mensajes — Split view (lista + chat)
// ═══════════════════════════════════════════════════════════════

const TabMensajes = ({ onUpdate }) => {
  const [mensajes, setMensajes] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState('pendiente')
  const [selected, setSelected] = useState(null)
  const [chat, setChat] = useState(null)
  const [chatCargando, setChatCargando] = useState(false)
  const [respuesta, setRespuesta] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (filtro) params.set('estado', filtro)
      const { data } = await api.get(`/api/mercadolibre/posventa/mensajes?${params}`)
      setMensajes(data.mensajes || [])
      setTotal(data.total || 0)
    } catch {
      setMensajes([])
    } finally {
      setCargando(false)
    }
  }, [filtro])

  useEffect(() => { cargar() }, [cargar])

  const abrirChat = async (msg) => {
    setSelected(msg)
    setChatCargando(true)
    try {
      const { data } = await api.get(`/api/mercadolibre/posventa/mensajes/${msg.pack_id}`)
      setChat(data)
    } catch {
      setChat(null)
    } finally {
      setChatCargando(false)
    }
  }

  const enviarRespuesta = async (e) => {
    e.preventDefault()
    if (!respuesta.trim() || !selected) return
    setEnviando(true)
    try {
      await api.post(`/api/mercadolibre/posventa/mensajes/${selected.pack_id}`, { texto: respuesta.trim() })
      setRespuesta('')
      // Recargar chat y lista
      await abrirChat(selected)
      await cargar()
      onUpdate?.()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al enviar mensaje')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[500px]">
      {/* Panel izquierdo — Lista */}
      <div className="w-80 flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        {/* Filtro */}
        <div className="p-3 border-b border-gray-100">
          <select
            value={filtro}
            onChange={e => { setFiltro(e.target.value); setSelected(null); setChat(null) }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="pendiente">Pendientes</option>
            <option value="respondido">Respondidos</option>
            <option value="">Todos</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">{total} conversaciones</p>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-500 mx-auto" />
            </div>
          ) : mensajes.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">
              {filtro === 'pendiente' ? 'Sin mensajes pendientes' : 'No hay conversaciones'}
            </div>
          ) : (
            mensajes.map(msg => (
              <button
                key={msg.id}
                onClick={() => abrirChat(msg)}
                className={`w-full text-left p-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                  selected?.id === msg.id ? 'bg-yellow-50 border-l-2 border-l-yellow-400' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm text-gray-800 truncate">
                    {msg.comprador_nickname || `Pack #${msg.pack_id}`}
                  </span>
                  {msg.cantidad_sin_leer > 0 && (
                    <span className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
                      {msg.cantidad_sin_leer}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{msg.ultimo_mensaje_texto || 'Sin preview'}</p>
                <p className="text-[10px] text-gray-400 mt-1">{timeAgo(msg.ultimo_mensaje_fecha)}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Panel derecho — Chat */}
      <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              <p className="text-sm">Seleccioná una conversación</p>
            </div>
          </div>
        ) : chatCargando ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
          </div>
        ) : (
          <>
            {/* Header chat */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">{selected.comprador_nickname || `Pack #${selected.pack_id}`}</h3>
                {selected.ml_order_id && (
                  <p className="text-xs text-gray-400">Orden #{selected.ml_order_id}</p>
                )}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                selected.estado === 'pendiente' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
              }`}>
                {selected.estado === 'pendiente' ? 'Pendiente' : 'Respondido'}
              </span>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(chat?.mensajes || []).map((msg, i) => {
                const esMio = String(msg.from?.user_id) === String(chat?.seller_id)
                return (
                  <div key={i} className={`flex ${esMio ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                      esMio
                        ? 'bg-yellow-400 text-gray-900'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.text || msg.message_text || ''}</p>
                      <p className={`text-[10px] mt-1 ${esMio ? 'text-yellow-700' : 'text-gray-400'}`}>
                        {formatFecha(msg.date_created || msg.created_at)}
                      </p>
                    </div>
                  </div>
                )
              })}
              {chat?.mensajes?.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-8">No hay mensajes en esta conversación</div>
              )}
            </div>

            {/* Input respuesta */}
            <form onSubmit={enviarRespuesta} className="p-3 border-t border-gray-100 flex gap-2">
              <input
                type="text"
                value={respuesta}
                onChange={e => setRespuesta(e.target.value)}
                placeholder="Escribí tu respuesta..."
                className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
                disabled={enviando}
              />
              <button
                type="submit"
                disabled={enviando || !respuesta.trim()}
                className="px-4 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-xl disabled:opacity-50 text-sm flex items-center gap-1"
              >
                {enviando ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                )}
                Enviar
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Tab Reclamos
// ═══════════════════════════════════════════════════════════════

const stageColor = (stage) => {
  switch (stage) {
    case 'claim': return 'bg-yellow-100 text-yellow-700'
    case 'dispute': return 'bg-red-100 text-red-700'
    case 'recontact': return 'bg-blue-100 text-blue-700'
    default: return 'bg-gray-100 text-gray-600'
  }
}

const stageLabel = (stage) => {
  switch (stage) {
    case 'claim': return 'Reclamo'
    case 'dispute': return 'Mediación'
    case 'recontact': return 'Recontacto'
    default: return stage || '-'
  }
}

const statusLabel = (status) => {
  switch (status) {
    case 'opened': return 'Abierto'
    case 'closed': return 'Cerrado'
    default: return status || '-'
  }
}

const TabReclamos = () => {
  const [reclamos, setReclamos] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [filtroStage, setFiltroStage] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('opened')
  const [detalle, setDetalle] = useState(null)
  const [detalleCargando, setDetalleCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page: pagina, limit: 20 })
      if (filtroStage) params.set('stage', filtroStage)
      if (filtroStatus) params.set('status', filtroStatus)
      const { data } = await api.get(`/api/mercadolibre/posventa/reclamos?${params}`)
      setReclamos(data.reclamos || [])
      setTotal(data.total || 0)
      setPaginas(data.paginas || 1)
    } catch {
      setReclamos([])
    } finally {
      setCargando(false)
    }
  }, [pagina, filtroStage, filtroStatus])

  useEffect(() => { cargar() }, [cargar])

  const verDetalle = async (claimId) => {
    setDetalleCargando(true)
    try {
      const { data } = await api.get(`/api/mercadolibre/posventa/reclamos/${claimId}`)
      setDetalle(data)
    } catch {
      setDetalle(null)
    } finally {
      setDetalleCargando(false)
    }
  }

  return (
    <div>
      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Etapa</label>
          <select
            value={filtroStage}
            onChange={e => { setPagina(1); setFiltroStage(e.target.value) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="claim">Reclamo</option>
            <option value="dispute">Mediación</option>
            <option value="recontact">Recontacto</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Estado</label>
          <select
            value={filtroStatus}
            onChange={e => { setPagina(1); setFiltroStatus(e.target.value) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="opened">Abiertos</option>
            <option value="closed">Cerrados</option>
          </select>
        </div>
        <div className="flex items-end ml-auto">
          <span className="text-xs text-gray-400">{total} reclamos</span>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {cargando ? (
          <div className="p-10 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mx-auto" />
          </div>
        ) : reclamos.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {filtroStatus === 'opened' ? 'No hay reclamos abiertos' : 'No hay reclamos'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Claim</th>
                  <th className="px-4 py-3">Orden</th>
                  <th className="px-4 py-3">Comprador</th>
                  <th className="px-4 py-3">Razón</th>
                  <th className="px-4 py-3 text-center">Etapa</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reclamos.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{r.claim_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {r.ml_order_id ? `#${r.ml_order_id}` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{r.comprador_nickname || '-'}</div>
                      {r.comprador_nombre && <div className="text-xs text-gray-400">{r.comprador_nombre}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[150px] truncate">
                      {r.razon || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${stageColor(r.stage)}`}>
                        {stageLabel(r.stage)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                        r.status === 'opened' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {formatFecha(r.fecha_creacion)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => verDetalle(r.claim_id)}
                        className="text-yellow-600 hover:text-yellow-800 text-xs font-medium"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {paginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Página {pagina} de {paginas} ({total} resultados)</p>
            <div className="flex gap-1">
              <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50">
                Anterior
              </button>
              <button onClick={() => setPagina(p => Math.min(paginas, p + 1))} disabled={pagina >= paginas}
                className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50">
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal detalle */}
      {(detalle || detalleCargando) && (
        <DetalleReclamoModal
          detalle={detalle}
          cargando={detalleCargando}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}

const DetalleReclamoModal = ({ detalle, cargando, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
    <div className="bg-white rounded-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      {cargando ? (
        <div className="p-10 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mx-auto" />
        </div>
      ) : detalle ? (
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-800">
              Reclamo #{detalle.id || detalle.claim_id}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <InfoItem label="Etapa" value={stageLabel(detalle.stage)} />
            <InfoItem label="Estado" value={statusLabel(detalle.status)} />
            <InfoItem label="Razón" value={detalle.reason_id || detalle.razon || '-'} />
            <InfoItem label="Tipo recurso" value={detalle.resource_type || detalle.tipo_recurso || '-'} />
            <InfoItem label="Fecha creación" value={formatFecha(detalle.date_created || detalle.fecha_creacion)} />
            <InfoItem label="Última actualización" value={formatFecha(detalle.last_updated || detalle.fecha_actualizacion)} />
          </div>

          {/* Players */}
          {detalle.players && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Partes involucradas</h3>
              <div className="grid grid-cols-2 gap-3">
                {detalle.players.complainant && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Comprador</p>
                    <p className="font-medium text-gray-800 text-sm">
                      {detalle.players.complainant.nickname || detalle.players.complainant.name || '-'}
                    </p>
                  </div>
                )}
                {detalle.players.respondent && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400">Vendedor</p>
                    <p className="font-medium text-gray-800 text-sm">
                      {detalle.players.respondent.nickname || detalle.players.respondent.name || '-'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Resolution */}
          {detalle.resolution && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Resolución</h3>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-gray-700">
                {typeof detalle.resolution === 'string'
                  ? detalle.resolution
                  : JSON.stringify(detalle.resolution, null, 2)}
              </div>
            </div>
          )}

          {/* Devolución asociada */}
          {detalle.devolucion && (
            <div className="mb-4">
              <h3 className="font-semibold text-gray-700 text-sm mb-2">Devolución</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <InfoItem label="Estado" value={detalle.devolucion.status || '-'} />
                  <InfoItem label="Tracking" value={detalle.devolucion.tracking_number || '-'} />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  </div>
)

const InfoItem = ({ label, value }) => (
  <div>
    <p className="text-xs text-gray-400">{label}</p>
    <p className="text-sm text-gray-800 font-medium">{value}</p>
  </div>
)

// ═══════════════════════════════════════════════════════════════
// Tab Devoluciones
// ═══════════════════════════════════════════════════════════════

const devStatusColor = (status) => {
  if (!status) return 'bg-gray-100 text-gray-600'
  if (status.includes('delivered')) return 'bg-green-100 text-green-700'
  if (status.includes('shipped')) return 'bg-blue-100 text-blue-700'
  if (status.includes('waiting')) return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-600'
}

const TabDevoluciones = () => {
  const [devoluciones, setDevoluciones] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get(`/api/mercadolibre/posventa/devoluciones?page=${pagina}&limit=20`)
      setDevoluciones(data.devoluciones || [])
      setTotal(data.total || 0)
      setPaginas(data.paginas || 1)
    } catch {
      setDevoluciones([])
    } finally {
      setCargando(false)
    }
  }, [pagina])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {cargando ? (
        <div className="p-10 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mx-auto" />
        </div>
      ) : devoluciones.length === 0 ? (
        <div className="p-10 text-center text-gray-400">No hay devoluciones activas</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Claim</th>
                <th className="px-4 py-3">Orden</th>
                <th className="px-4 py-3">Comprador</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Fecha límite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devoluciones.map(d => {
                const reclamo = d.ml_reclamos || {}
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">#{d.claim_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {(d.ml_order_id || reclamo.ml_order_id) ? `#${d.ml_order_id || reclamo.ml_order_id}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      {reclamo.comprador_nickname || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${devStatusColor(d.status)}`}>
                        {d.status || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {d.tracking_number || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      {formatFecha(d.fecha_limite)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">Página {pagina} de {paginas} ({total} resultados)</p>
          <div className="flex gap-1">
            <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50">
              Anterior
            </button>
            <button onClick={() => setPagina(p => Math.min(paginas, p + 1))} disabled={pagina >= paginas}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50">
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default MLPosventa
