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
  despacho_parcial: 'bg-orange-100 text-orange-600',
  despachado: 'bg-purple-100 text-purple-600',
  recibido: 'bg-green-100 text-green-600',
  con_diferencia: 'bg-red-100 text-red-600',
  cancelado: 'bg-red-50 text-red-400',
}

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  despacho_parcial: 'Despacho parcial',
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

      <div className={`mx-auto px-4 py-6 space-y-6 ${tab === 'bultos' ? 'max-w-full' : 'max-w-5xl'}`}>
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
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'pendiente', label: 'Creadas', value: dashboard?.pendientes || 0,
                  textColor: 'text-gray-600', activeBorder: 'border-gray-400 bg-gray-50 ring-2 ring-gray-200' },
                { key: 'en_preparacion', label: 'En preparación', value: dashboard?.en_preparacion || 0,
                  textColor: 'text-amber-600', activeBorder: 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' },
                { key: 'preparado', label: 'Preparadas', value: dashboard?.preparados || 0,
                  textColor: 'text-blue-600', activeBorder: 'border-blue-400 bg-blue-50 ring-2 ring-blue-200' },
                { key: 'despacho_parcial', label: 'Despacho parcial', value: dashboard?.despacho_parcial || 0,
                  textColor: 'text-orange-600', activeBorder: 'border-orange-400 bg-orange-50 ring-2 ring-orange-200' },
                { key: 'despachado', label: 'Despachadas', value: dashboard?.despachados || 0,
                  textColor: 'text-purple-600', activeBorder: 'border-purple-400 bg-purple-50 ring-2 ring-purple-200' },
                { key: 'recibido', label: 'Recibidas hoy', value: dashboard?.recibidos_hoy || 0,
                  textColor: 'text-green-600', activeBorder: 'border-green-400 bg-green-50 ring-2 ring-green-200' },
                { key: 'con_diferencia', label: 'Con diferencia', value: dashboard?.con_diferencia || 0,
                  textColor: 'text-red-600', activeBorder: 'border-red-400 bg-red-50 ring-2 ring-red-200' },
                { key: 'cancelado', label: 'Canceladas', value: dashboard?.cancelados || 0,
                  textColor: 'text-red-400', activeBorder: 'border-red-300 bg-red-50 ring-2 ring-red-100' },
              ].map(kpi => (
                <button key={kpi.key}
                  onClick={() => setFiltroEstado(filtroEstado === kpi.key ? '' : kpi.key)}
                  className={`rounded-xl border-2 p-3 text-center transition-all cursor-pointer ${
                    filtroEstado === kpi.key
                      ? kpi.activeBorder
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`text-xl font-bold ${kpi.textColor}`}>{kpi.value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{kpi.label}</div>
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

            {cargandoBultos ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
              </div>
            ) : (() => {
              const COLUMNAS_ESTADO = [
                { key: 'en_preparacion', label: 'En preparación', color: 'border-amber-300 bg-amber-50 text-amber-800' },
                { key: 'en_origen', label: 'En origen', color: 'border-blue-300 bg-blue-50 text-blue-800' },
                { key: 'en_transito', label: 'En tránsito', color: 'border-purple-300 bg-purple-50 text-purple-800' },
                { key: 'en_destino', label: 'En destino', color: 'border-cyan-300 bg-cyan-50 text-cyan-800' },
                { key: 'con_diferencia', label: 'Con diferencia', color: 'border-red-300 bg-red-50 text-red-800' },
                { key: 'controlado', label: 'Controlado', color: 'border-green-300 bg-green-50 text-green-800' },
              ]
              const bultosPorEstado = {}
              for (const col of COLUMNAS_ESTADO) bultosPorEstado[col.key] = []
              for (const b of bultosFiltrados) {
                if (bultosPorEstado[b.estado]) bultosPorEstado[b.estado].push(b)
              }
              const bultoSeleccionado = bultoExpandido ? bultosFiltrados.find(b => b.id === bultoExpandido) : null

              return (
                <div className="flex gap-3" style={{ minHeight: '65vh' }}>
                  {/* Columnas kanban */}
                  <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
                    {COLUMNAS_ESTADO.map(col => (
                      <div key={col.key} className="flex flex-col min-w-[140px] flex-1">
                        {/* Header */}
                        <div className={`px-2 py-1.5 rounded-lg border text-center mb-2 ${col.color}`}>
                          <span className="text-[11px] font-bold uppercase">{col.label}</span>
                          {bultosPorEstado[col.key].length > 0 && (
                            <span className="ml-1 text-[10px] font-mono opacity-70">({bultosPorEstado[col.key].length})</span>
                          )}
                        </div>
                        {/* Cards */}
                        <div className="flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                          {bultosPorEstado[col.key].map(b => {
                            const tipoStyle = TIPO_BULTO_STYLE[b.tipo] || TIPO_BULTO_STYLE.bulto
                            const isSelected = bultoExpandido === b.id
                            return (
                              <button key={b.id}
                                onClick={() => setBultoExpandido(isSelected ? null : b.id)}
                                className={`w-full text-left rounded-lg border p-2 transition-all hover:shadow-sm ${
                                  isSelected ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300' : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-base leading-none">{tipoStyle.icon}</span>
                                  <span className="text-[11px] font-semibold text-gray-800 truncate">{b.precinto || b.numero_pallet || 'Sin ID'}</span>
                                </div>
                                {b.estado === 'con_diferencia' && b.control_articulos_at && (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-green-100 text-green-700 font-medium mt-1 inline-block">Controlado</span>
                                )}
                                <div className="text-[10px] text-gray-500 mt-0.5 truncate">{b.orden_numero} · {b.sucursal_origen} → {b.sucursal_destino}</div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Panel lateral derecho — detalle del bulto seleccionado */}
                  {bultoSeleccionado && (() => {
                    const b = bultoSeleccionado
                    const items = Array.isArray(b.items) ? b.items : []
                    const diferencias = Array.isArray(b.diferencias) ? b.diferencias : []
                    return (
                      <div className="w-[480px] flex-shrink-0 border border-gray-200 rounded-xl bg-white overflow-y-auto" style={{ maxHeight: '75vh' }}>
                        {/* Header panel */}
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 sticky top-0 z-10">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{(TIPO_BULTO_STYLE[b.tipo] || TIPO_BULTO_STYLE.bulto).icon}</span>
                            <span className="font-semibold text-sm text-gray-800">{b.precinto || b.numero_pallet || 'Sin ID'}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ESTADO_BULTO_BADGE[b.estado] || 'bg-gray-100 text-gray-500'}`}>
                              {b.estado === 'con_diferencia' && b.control_articulos_at ? 'Con diferencias — Controlado' : (ESTADO_BULTO_LABEL[b.estado] || b.estado)}
                            </span>
                          </div>
                          <button onClick={() => setBultoExpandido(null)} className="text-gray-400 hover:text-gray-600">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>

                        <div className="px-4 py-3 space-y-3">
                          {/* Info general */}
                          <div className="grid grid-cols-2 gap-3 text-xs">
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
                            <div className="col-span-2">
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
                              <div className="col-span-2">
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
                                  <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                          <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Artículo</th>
                                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium w-16">Origen</th>
                                          <th className="text-right px-2 py-1.5 text-gray-400 font-medium w-16">Destino</th>
                                          <th className="text-center px-2 py-1.5 text-gray-400 font-medium w-16">Estado</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-50">
                                        {controlDestino.map((d, idx) => {
                                          const itemOrigen = items.find(i => i.articulo_id === d.articulo_id)
                                          const nombre = d.nombre || itemOrigen?.nombre || itemOrigen?.articulo_nombre || 'Artículo'
                                          const codigo = d.codigo || itemOrigen?.codigo || ''
                                          const esPesable = (d.pesos_escaneados_destino || []).length > 0 || itemOrigen?.es_pesable
                                          const unidad = esPesable ? ' kg' : ' u'
                                          const fmt = (v) => esPesable ? Number(v).toFixed(3) : v
                                          const colorTipo = {
                                            ok: 'bg-green-100 text-green-700',
                                            diferencia: 'bg-red-100 text-red-700',
                                            faltante: 'bg-red-100 text-red-700',
                                            extra: 'bg-amber-100 text-amber-700',
                                          }
                                          const labelTipo = { ok: 'OK', diferencia: 'Dif.', faltante: 'Faltante', extra: 'Extra' }

                                          // Para extras, buscar en qué otros canastos de la misma orden está este artículo
                                          let filasContexto = null
                                          if (d.es_extra) {
                                            const otrosBultos = bultos.filter(otro =>
                                              otro.orden_traspaso_id === b.orden_traspaso_id && otro.id !== b.id
                                            )
                                            const encontrados = []
                                            const matchItem = (i) =>
                                              String(i.articulo_id) === String(d.articulo_id) ||
                                              (d.codigo && i.codigo && String(i.codigo) === String(d.codigo))
                                            for (const otro of otrosBultos) {
                                              let itemEnOtro = (otro.items || []).find(matchItem)
                                              if (!itemEnOtro && otro.tipo === 'pallet') {
                                                const hijos = bultos.filter(h => h.pallet_id === otro.id)
                                                for (const hijo of hijos) {
                                                  itemEnOtro = (hijo.items || []).find(matchItem)
                                                  if (itemEnOtro) {
                                                    encontrados.push({
                                                      precinto: hijo.precinto || hijo.id?.slice(0, 8),
                                                      tipo: hijo.tipo,
                                                      cantidad: itemEnOtro.cantidad_preparada ?? itemEnOtro.cantidad,
                                                      estado: hijo.estado,
                                                    })
                                                  }
                                                }
                                                continue
                                              }
                                              if (itemEnOtro) {
                                                encontrados.push({
                                                  precinto: otro.precinto || otro.numero_pallet || otro.id?.slice(0, 8),
                                                  tipo: otro.tipo,
                                                  cantidad: itemEnOtro.cantidad_preparada ?? itemEnOtro.cantidad,
                                                  estado: otro.estado,
                                                })
                                              }
                                            }
                                            const ordenOrig = ordenes.find(o => o.id === b.orden_traspaso_id)
                                            const enOrden = ordenOrig && Array.isArray(ordenOrig.items) &&
                                              ordenOrig.items.some(i =>
                                                String(i.articulo_id) === String(d.articulo_id) ||
                                                (d.codigo && i.codigo && String(i.codigo) === String(d.codigo))
                                              )

                                            const filas = []
                                            filas.push(
                                              <tr key={`ord-${idx}`}>
                                                <td colSpan={4} className={`px-6 py-1 text-[10px] italic ${enOrden ? 'text-blue-600 bg-blue-50/50' : 'text-amber-600 bg-amber-50/50'}`}>
                                                  {enOrden
                                                    ? `Sí estaba en la orden ${ordenOrig.numero || ''}`
                                                    : `No estaba en la orden original${ordenOrig ? ` (${ordenOrig.numero})` : ''}`}
                                                </td>
                                              </tr>
                                            )
                                            if (encontrados.length === 0) {
                                              filas.push(
                                                <tr key={`ctx-${idx}`}><td colSpan={4} className="px-6 py-1 text-[10px] text-amber-600 italic bg-amber-50/50">
                                                  No está en ningún otro canasto de esta orden
                                                </td></tr>
                                              )
                                            } else {
                                              for (let i = 0; i < encontrados.length; i++) {
                                                const enc = encontrados[i]
                                                filas.push(
                                                  <tr key={`ctx-${idx}-${i}`}>
                                                    <td colSpan={4} className="px-6 py-1 text-[10px] text-gray-500 bg-amber-50/30">
                                                      Preparado en <b>{enc.precinto}</b> ({enc.tipo}) — {enc.cantidad} u — estado: {enc.estado}
                                                    </td>
                                                  </tr>
                                                )
                                              }
                                            }
                                            const estadosActivos = ['en_origen', 'en_preparacion', 'en_transito', 'en_destino']
                                            const enOtrasOrdenes = []
                                            const bultosOtraOrden = bultos.filter(otro =>
                                              otro.orden_traspaso_id !== b.orden_traspaso_id &&
                                              otro.sucursal_destino === b.sucursal_destino &&
                                              estadosActivos.includes(otro.estado)
                                            )
                                            for (const otro of bultosOtraOrden) {
                                              let itemEnOtro = (otro.items || []).find(matchItem)
                                              if (!itemEnOtro && otro.tipo === 'pallet') {
                                                const hijos = bultos.filter(h => h.pallet_id === otro.id)
                                                for (const hijo of hijos) {
                                                  itemEnOtro = (hijo.items || []).find(matchItem)
                                                  if (itemEnOtro) {
                                                    enOtrasOrdenes.push({
                                                      orden: otro.orden_numero,
                                                      precinto: hijo.precinto || hijo.id?.slice(0, 8),
                                                      tipo: hijo.tipo,
                                                      cantidad: itemEnOtro.cantidad_preparada ?? itemEnOtro.cantidad,
                                                      estado: hijo.estado,
                                                    })
                                                  }
                                                }
                                                continue
                                              }
                                              if (itemEnOtro) {
                                                enOtrasOrdenes.push({
                                                  orden: otro.orden_numero,
                                                  precinto: otro.precinto || otro.numero_pallet || otro.id?.slice(0, 8),
                                                  tipo: otro.tipo,
                                                  cantidad: itemEnOtro.cantidad_preparada ?? itemEnOtro.cantidad,
                                                  estado: otro.estado,
                                                })
                                              }
                                            }
                                            if (enOtrasOrdenes.length > 0) {
                                              for (let i = 0; i < enOtrasOrdenes.length; i++) {
                                                const enc = enOtrasOrdenes[i]
                                                filas.push(
                                                  <tr key={`otr-${idx}-${i}`}>
                                                    <td colSpan={4} className="px-6 py-1 text-[10px] text-purple-600 bg-purple-50/30">
                                                      En otra orden: <b>{enc.orden}</b> → {enc.precinto} ({enc.tipo}) — {enc.cantidad} u — {ESTADO_BULTO_LABEL[enc.estado] || enc.estado}
                                                    </td>
                                                  </tr>
                                                )
                                              }
                                            }
                                            filasContexto = filas
                                          }

                                          return (
                                            <React.Fragment key={idx}>
                                            <tr className={d.tipo !== 'ok' ? 'bg-red-50/30' : ''}>
                                              <td className="px-3 py-1.5">
                                                {codigo && <span className="text-gray-400 mr-1">{codigo}</span>}
                                                <span className="text-gray-700">{nombre}</span>
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
                                              {filasContexto}
                                            </React.Fragment>
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
                      </div>
                    )
                  })()}
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}

export default TraspasosHome
