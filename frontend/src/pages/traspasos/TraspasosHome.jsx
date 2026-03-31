// Dashboard principal de Traspasos
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import { imprimirPallet } from '../../utils/imprimirPallet'

const ESTADO_BADGE = {
  pendiente: 'bg-gray-100 text-gray-600',
  en_preparacion: 'bg-amber-100 text-amber-600',
  preparado: 'bg-blue-100 text-blue-600',
  despachado: 'bg-purple-100 text-purple-600',
  recibido: 'bg-green-100 text-green-600',
  con_diferencia: 'bg-red-100 text-red-600',
  cancelado: 'bg-red-50 text-red-400',
}

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  despachado: 'Despachado',
  recibido: 'Recibido',
  con_diferencia: 'Con diferencia',
  cancelado: 'Cancelado',
}

const ESTADO_BULTO_BADGE = {
  en_preparacion: 'bg-amber-100 text-amber-600',
  en_origen: 'bg-blue-100 text-blue-600',
  en_transito: 'bg-purple-100 text-purple-600',
  en_destino: 'bg-cyan-100 text-cyan-600',
  controlado: 'bg-green-100 text-green-600',
  con_diferencia: 'bg-red-100 text-red-600',
}

const ESTADO_BULTO_LABEL = {
  en_preparacion: 'En preparación',
  en_origen: 'En origen',
  en_transito: 'En tránsito',
  en_destino: 'En destino',
  controlado: 'Controlado',
  con_diferencia: 'Con diferencia',
}

const ESTADO_BULTO_CARD = {
  en_preparacion: 'border-amber-300 bg-amber-50',
  en_origen: 'border-blue-300 bg-blue-50',
  en_transito: 'border-purple-300 bg-purple-50',
  en_destino: 'border-cyan-300 bg-cyan-50',
  controlado: 'border-green-300 bg-green-50',
  con_diferencia: 'border-red-300 bg-red-50',
}

const TIPO_BULTO_STYLE = {
  canasto: { icon: '🧺', bg: 'bg-amber-100 text-amber-800 border-amber-200' },
  pallet: { icon: '📦', bg: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  bulto: { icon: '📋', bg: 'bg-gray-100 text-gray-800 border-gray-200' },
}

const TraspasosHome = () => {
  const [tab, setTab] = useState('ordenes')
  const [dashboard, setDashboard] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [ordenes, setOrdenes] = useState([])
  const [filtroEstado, setFiltroEstado] = useState('')
  const [bultos, setBultos] = useState([])
  const [cargandoBultos, setCargandoBultos] = useState(false)
  const [filtroBultoTipo, setFiltroBultoTipo] = useState('')
  const [filtroBultoEstado, setFiltroBultoEstado] = useState('')
  const [bultoExpandido, setBultoExpandido] = useState(null)

  useEffect(() => {
    api.get('/api/traspasos/dashboard')
      .then(r => setDashboard(r.data))
      .catch(err => console.error('Error cargando dashboard:', err))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    const params = filtroEstado ? `?estado=${filtroEstado}` : ''
    api.get(`/api/traspasos/ordenes${params}`)
      .then(r => setOrdenes(r.data))
      .catch(err => console.error('Error cargando ordenes:', err))
  }, [filtroEstado])

  useEffect(() => {
    if (tab === 'bultos') {
      setCargandoBultos(true)
      api.get('/api/traspasos/bultos')
        .then(r => setBultos(r.data || []))
        .catch(err => console.error('Error cargando bultos:', err))
        .finally(() => setCargandoBultos(false))
    }
  }, [tab])

  // Ocultar bultos que están dentro de un pallet
  const bultosVisibles = bultos.filter(b => !b.pallet_id)
  const bultosFiltrados = bultosVisibles
    .filter(b => !filtroBultoTipo || b.tipo === filtroBultoTipo)
    .filter(b => !filtroBultoEstado || b.estado === filtroBultoEstado)
  // Bultos hijos agrupados por pallet_id para mostrar dentro del pallet expandido
  const bultosHijosPorPallet = {}
  bultos.filter(b => b.pallet_id).forEach(b => {
    if (!bultosHijosPorPallet[b.pallet_id]) bultosHijosPorPallet[b.pallet_id] = []
    bultosHijosPorPallet[b.pallet_id].push(b)
  })

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Traspasos" sinTabs volverA="/apps" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Traspasos entre Sucursales" sinTabs volverA="/apps" />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setTab('ordenes')}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
              tab === 'ordenes' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >Órdenes de traspaso</button>
          <button
            onClick={() => setTab('bultos')}
            className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
              tab === 'bultos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >Bultos</button>
        </div>

        {tab === 'ordenes' && (
          <>
            {/* KPIs clickeables como filtro */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { key: 'pendiente', label: 'Creadas', value: dashboard?.pendientes || 0,
                  textColor: 'text-gray-600', activeBorder: 'border-gray-400 bg-gray-50 ring-2 ring-gray-200' },
                { key: 'en_preparacion', label: 'En preparación', value: dashboard?.en_preparacion || 0,
                  textColor: 'text-amber-600', activeBorder: 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' },
                { key: 'preparado', label: 'Preparadas', value: dashboard?.preparados || 0,
                  textColor: 'text-blue-600', activeBorder: 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' },
              ].map(kpi => (
                <button key={kpi.key}
                  onClick={() => setFiltroEstado(filtroEstado === kpi.key ? '' : kpi.key)}
                  className={`rounded-xl border-2 p-4 text-center transition-all cursor-pointer ${
                    filtroEstado === kpi.key
                      ? kpi.activeBorder
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`text-2xl font-bold ${kpi.textColor}`}>{kpi.value}</div>
                  <div className="text-xs text-gray-500 mt-1">{kpi.label}</div>
                </button>
              ))}
            </div>

            {/* Accesos rápidos */}
            <div>
              <Link to="/traspasos/nueva"
                className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow flex items-center gap-4">
                <div className="bg-sky-100 text-sky-600 w-12 h-12 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-gray-800">Nueva Orden de Traspaso</div>
                  <div className="text-xs text-gray-400">Crear pedido de envío a sucursal</div>
                </div>
              </Link>
            </div>

            {/* Lista de órdenes */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-700 text-sm">
                  {filtroEstado ? ESTADO_LABEL[filtroEstado] : 'Todas las órdenes'}
                </h2>
                {filtroEstado && (
                  <button onClick={() => setFiltroEstado('')}
                    className="text-xs text-sky-600 hover:text-sky-800 font-medium">
                    Ver todas
                  </button>
                )}
              </div>

              {ordenes.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No hay órdenes</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {ordenes.map(o => (
                    <Link key={o.id} to={`/traspasos/ordenes/${o.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-800">{o.numero}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[o.estado]}`}>
                            {ESTADO_LABEL[o.estado]}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {o.sucursal_origen_nombre} → {o.sucursal_destino_nombre}
                          <span className="mx-1.5">·</span>
                          {new Date(o.created_at).toLocaleDateString('es-AR')}
                          {o.items && <span className="ml-1.5">· {Array.isArray(o.items) ? o.items.length : 0} art.</span>}
                        </div>
                        {o.notas?.startsWith('Pendientes de ') && (
                          <div className="text-[11px] text-amber-600 mt-0.5">Proviene de {o.notas.replace('Pendientes de ', '')}</div>
                        )}
                      </div>
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'bultos' && (
          <>
            {/* Filtros de tipo */}
            <div className="flex gap-2">
              {[
                { key: '', label: 'Todos' },
                { key: 'canasto', label: 'Canastos' },
                { key: 'pallet', label: 'Pallets' },
                { key: 'bulto', label: 'Bultos' },
              ].map(f => (
                <button key={f.key}
                  onClick={() => setFiltroBultoTipo(f.key)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    filtroBultoTipo === f.key
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >{f.label}</button>
              ))}
              <span className="text-xs text-gray-400 self-center ml-2">
                {bultosFiltrados.length} resultado{bultosFiltrados.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Filtros de estado */}
            <div className="flex gap-2 flex-wrap">
              {[
                { key: '', label: 'Todos' },
                { key: 'en_preparacion', label: 'En preparación' },
                { key: 'en_origen', label: 'En origen' },
                { key: 'en_transito', label: 'En tránsito' },
                { key: 'en_destino', label: 'En destino' },
                { key: 'controlado', label: 'Controlado' },
                { key: 'con_diferencia', label: 'Con diferencia' },
              ].map(f => {
                const activo = filtroBultoEstado === f.key
                const badgeStyle = f.key && !activo ? ESTADO_BULTO_BADGE[f.key] : ''
                return (
                  <button key={f.key}
                    onClick={() => setFiltroBultoEstado(f.key)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                      activo
                        ? 'bg-gray-800 text-white'
                        : badgeStyle || 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >{f.label}</button>
                )
              })}
            </div>

            {cargandoBultos ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
              </div>
            ) : bultosFiltrados.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No hay bultos</div>
            ) : (
              <div className="space-y-2">
                {bultosFiltrados.map(b => {
                  const expandido = bultoExpandido === b.id
                  const items = Array.isArray(b.items) ? b.items : []
                  const diferencias = Array.isArray(b.diferencias) ? b.diferencias : []
                  const tipoStyle = TIPO_BULTO_STYLE[b.tipo] || TIPO_BULTO_STYLE.bulto
                  const cardColor = ESTADO_BULTO_CARD[b.estado] || 'border-gray-200 bg-white'

                  return (
                    <div key={b.id} className={`rounded-xl border-2 overflow-hidden ${cardColor}`}>
                      <button
                        onClick={() => setBultoExpandido(expandido ? null : b.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:opacity-90 transition-all text-left"
                      >
                        {/* Tipo grande */}
                        <div className={`flex-shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-xl border ${tipoStyle.bg}`}>
                          <span className="text-2xl leading-none">{tipoStyle.icon}</span>
                          <span className="text-[10px] font-bold uppercase mt-0.5">{b.tipo}</span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-800">
                              {b.precinto || b.numero_pallet || 'Sin ID'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BULTO_BADGE[b.estado] || 'bg-gray-100 text-gray-500'}`}>
                              {ESTADO_BULTO_LABEL[b.estado] || b.estado}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {b.orden_numero}
                            <span className="mx-1.5">·</span>
                            {b.sucursal_origen} → {b.sucursal_destino}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {b.peso_origen != null && (
                              <span>{b.peso_origen} kg</span>
                            )}
                            {b.tipo === 'pallet' && b.cantidad_bultos_origen != null && (
                              <span>{b.peso_origen != null && <span className="mx-1">·</span>}{b.cantidad_bultos_origen} bultos</span>
                            )}
                            {items.length > 0 && (
                              <span>{(b.peso_origen != null || b.cantidad_bultos_origen != null) && <span className="mx-1">·</span>}{items.length} art.</span>
                            )}
                          </div>
                        </div>
                        <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expandido ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      {expandido && (
                        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                          {/* Info general */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <span className="text-gray-400">Orden:</span>
                              <Link to={`/traspasos/ordenes/${b.orden_traspaso_id}`}
                                className="ml-1 text-sky-600 hover:text-sky-800 font-medium">{b.orden_numero}</Link>
                            </div>
                            <div>
                              <span className="text-gray-400">Estado orden:</span>
                              <span className={`ml-1 px-1.5 py-0.5 rounded ${ESTADO_BADGE[b.orden_estado] || ''}`}>
                                {ESTADO_LABEL[b.orden_estado] || b.orden_estado}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-400">Ruta:</span>
                              <span className="ml-1 text-gray-700">{b.sucursal_origen} → {b.sucursal_destino}</span>
                            </div>
                            {b.peso_origen != null && (
                              <div>
                                <span className="text-gray-400">Peso origen:</span>
                                <span className="ml-1 text-gray-700 font-medium">{b.peso_origen} kg</span>
                              </div>
                            )}
                            {b.peso_destino != null && (
                              <div>
                                <span className="text-gray-400">Peso destino:</span>
                                <span className={`ml-1 font-medium ${
                                  b.peso_origen && Math.abs(b.peso_destino - b.peso_origen) > 0.5
                                    ? 'text-red-600' : 'text-green-600'
                                }`}>{b.peso_destino} kg</span>
                              </div>
                            )}
                            {b.tipo === 'pallet' && (
                              <>
                                <div>
                                  <span className="text-gray-400">Bultos origen:</span>
                                  <span className="ml-1 text-gray-700 font-medium">{b.cantidad_bultos_origen ?? '-'}</span>
                                </div>
                                {b.cantidad_bultos_destino != null && (
                                  <div>
                                    <span className="text-gray-400">Bultos destino:</span>
                                    <span className={`ml-1 font-medium ${
                                      b.cantidad_bultos_destino !== b.cantidad_bultos_origen ? 'text-red-600' : 'text-green-600'
                                    }`}>{b.cantidad_bultos_destino}</span>
                                  </div>
                                )}
                              </>
                            )}
                            {b.nombre && (
                              <div className="col-span-2 sm:col-span-3">
                                <span className="text-gray-400">Descripción:</span>
                                <span className="ml-1 text-gray-700">{b.nombre}</span>
                              </div>
                            )}
                            {b.preparado_at && (
                              <div>
                                <span className="text-gray-400">Preparado:</span>
                                <span className="ml-1 text-gray-700">{new Date(b.preparado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            )}
                            {b.despachado_at && (
                              <div>
                                <span className="text-gray-400">Despachado:</span>
                                <span className="ml-1 text-gray-700">{new Date(b.despachado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            )}
                            {b.recibido_at && (
                              <div>
                                <span className="text-gray-400">Recibido:</span>
                                <span className="ml-1 text-gray-700">{new Date(b.recibido_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            )}
                          </div>

                          {/* Bultos hijos (dentro de pallet) */}
                          {b.tipo === 'pallet' && bultosHijosPorPallet[b.id]?.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Bultos ({bultosHijosPorPallet[b.id].length})</h4>
                              <div className="space-y-1.5">
                                {bultosHijosPorPallet[b.id].map(hijo => (
                                  <div key={hijo.id} className="bg-white rounded-lg border border-gray-200 p-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-mono font-medium text-gray-700">{hijo.precinto}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ESTADO_BULTO_BADGE[hijo.estado] || 'bg-gray-100 text-gray-500'}`}>
                                        {ESTADO_BULTO_LABEL[hijo.estado] || hijo.estado}
                                      </span>
                                    </div>
                                    {(hijo.items || []).map((item, i) => (
                                      <div key={i} className="text-[11px] text-gray-500 mt-0.5">
                                        {item.codigo} {item.nombre} — {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} u`}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Artículos: origen vs destino */}
                          {(() => {
                            const controlDestino = Array.isArray(b.diferencias_articulos) ? b.diferencias_articulos : []
                            const tieneControl = controlDestino.length > 0

                            if (!tieneControl && items.length === 0) return null

                            if (tieneControl) {
                              return (
                                <div>
                                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                    Artículos — Origen vs Destino ({controlDestino.length})
                                  </h4>
                                  <div className="bg-white rounded-lg border border-gray-200 max-h-64 overflow-y-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                          <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Artículo</th>
                                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium w-20">Origen</th>
                                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium w-20">Destino</th>
                                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium w-20">Estado</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-50">
                                        {controlDestino.map((d, idx) => {
                                          const esPesable = (d.pesos_escaneados_destino || []).length > 0 || items.find(i => i.articulo_id === d.articulo_id)?.es_pesable
                                          const unidad = esPesable ? ' kg' : ' u'
                                          const fmt = (v) => esPesable ? Number(v).toFixed(3) : v
                                          const colorTipo = {
                                            ok: 'bg-green-100 text-green-700',
                                            diferencia: 'bg-red-100 text-red-700',
                                            faltante: 'bg-red-100 text-red-700',
                                            extra: 'bg-amber-100 text-amber-700',
                                          }
                                          const labelTipo = { ok: 'OK', diferencia: 'Dif.', faltante: 'Faltante', extra: 'Extra' }
                                          return (
                                            <tr key={idx} className={d.tipo !== 'ok' ? 'bg-red-50/30' : ''}>
                                              <td className="px-3 py-1.5">
                                                <span className="text-gray-400 mr-1">{d.codigo || ''}</span>
                                                <span className="text-gray-700">{d.nombre || 'Artículo'}</span>
                                              </td>
                                              <td className="text-right px-2 py-1.5 text-gray-600 font-medium font-mono">
                                                {d.es_extra ? '—' : fmt(d.cantidad_esperada)}{!d.es_extra && unidad}
                                              </td>
                                              <td className={`text-right px-2 py-1.5 font-medium font-mono ${
                                                d.tipo === 'ok' ? 'text-green-600' : d.tipo === 'faltante' ? 'text-red-600' : d.tipo === 'extra' ? 'text-amber-600' : 'text-red-600'
                                              }`}>
                                                {d.cantidad_recibida === 0 ? '—' : fmt(d.cantidad_recibida)}{d.cantidad_recibida !== 0 && unidad}
                                              </td>
                                              <td className="text-center px-2 py-1.5">
                                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${colorTipo[d.tipo] || ''}`}>
                                                  {labelTipo[d.tipo] || d.tipo}
                                                </span>
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  {b.control_articulos_at && (
                                    <p className="text-[10px] text-gray-400 mt-1">
                                      Controlado: {new Date(b.control_articulos_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  )}
                                </div>
                              )
                            }

                            // Sin control destino: mostrar solo items origen
                            return (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Artículos preparados ({items.length})</h4>
                                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-50 max-h-48 overflow-y-auto">
                                  {items.map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-xs">
                                      <div className="min-w-0">
                                        <span className="text-gray-400 mr-1.5">{item.codigo || ''}</span>
                                        <span className="text-gray-700">{item.nombre || item.articulo_nombre || 'Artículo'}</span>
                                      </div>
                                      <span className="text-gray-600 font-medium ml-2 flex-shrink-0">
                                        {item.cantidad_preparada ?? item.cantidad ?? '-'}
                                        {item.es_pesable ? ' kg' : ' u'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}

                          {/* Botón imprimir pallet */}
                          {b.tipo === 'pallet' && (
                            <button
                              onClick={() => imprimirPallet(
                                { numero_pallet: b.precinto || b.numero_pallet, cantidad_bultos_origen: b.cantidad_bultos_origen, items_descripcion: b.nombre },
                                { numero: b.orden_numero, sucursal_origen_nombre: b.sucursal_origen, sucursal_destino_nombre: b.sucursal_destino }
                              )}
                              className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-800 font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                              Imprimir etiqueta
                            </button>
                          )}

                          {/* Diferencias */}
                          {diferencias.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-red-500 uppercase mb-1">Diferencias ({diferencias.length})</h4>
                              <div className="bg-red-50 rounded-lg border border-red-200 divide-y divide-red-100">
                                {diferencias.map((d, idx) => (
                                  <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-xs">
                                    <span className="text-gray-700">{d.nombre || d.codigo || 'Artículo'}</span>
                                    <span className="text-red-600 font-medium">
                                      Esperado: {d.cantidad_esperada} → Real: {d.cantidad_real}
                                      {d.tipo && <span className="ml-1 text-red-400">({d.tipo})</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TraspasosHome
