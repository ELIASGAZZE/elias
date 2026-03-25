// Modal de artículos necesarios para cumplir pedidos pendientes
import React, { useState, useEffect, useMemo } from 'react'
import api from '../../services/api'

const hoyISO = () => new Date().toISOString().split('T')[0]

const RANGOS = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'manana', label: 'Mañana' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Resto del mes' },
  { value: 'custom', label: 'Personalizado' },
]

function calcularRango(rango) {
  const hoy = new Date()
  const desde = hoyISO()
  let hasta = desde

  switch (rango) {
    case 'hoy':
      break
    case 'manana': {
      const m = new Date(hoy)
      m.setDate(m.getDate() + 1)
      const mISO = m.toISOString().split('T')[0]
      return { desde: mISO, hasta: mISO }
    }
    case 'semana': {
      const fin = new Date(hoy)
      const diaActual = fin.getDay()
      const diasHastaFin = diaActual === 0 ? 0 : 7 - diaActual
      fin.setDate(fin.getDate() + diasHastaFin)
      hasta = fin.toISOString().split('T')[0]
      break
    }
    case 'mes': {
      const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
      hasta = finMes.toISOString().split('T')[0]
      break
    }
    default:
      break
  }
  return { desde, hasta }
}

export default function ModalArticulosPedidos({ onCerrar, terminalConfig, sucursales }) {
  const [rango, setRango] = useState('semana')
  const [fechaDesde, setFechaDesde] = useState(hoyISO())
  const [fechaHasta, setFechaHasta] = useState(hoyISO())
  const [sucursalId, setSucursalId] = useState('')
  const [datos, setDatos] = useState([])
  const [cargando, setCargando] = useState(true)

  const fechasRango = useMemo(() => {
    if (rango === 'custom') return { desde: fechaDesde, hasta: fechaHasta }
    return calcularRango(rango)
  }, [rango, fechaDesde, fechaHasta])

  useEffect(() => {
    setCargando(true)
    const params = { sucursal_id: sucursalId || undefined, fecha_desde: fechasRango.desde, fecha_hasta: fechasRango.hasta }
    api.get('/api/pos/pedidos/articulos-por-dia', { params })
      .then(({ data }) => { setDatos(data.dias || []) })
      .catch(err => console.error('Error cargando artículos:', err))
      .finally(() => setCargando(false))
  }, [sucursalId, fechasRango.desde, fechasRango.hasta])

  // Lista plana de artículos consolidados (sumados de todos los días)
  const articulos = useMemo(() => {
    const map = {}
    for (const dia of datos) {
      for (const art of dia.articulos) {
        const key = art.articulo_id || art.nombre
        if (!map[key]) map[key] = { ...art, cantidad: 0 }
        map[key].cantidad += art.cantidad
      }
    }
    return Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [datos])

  const totalUnidades = articulos.reduce((s, a) => s + a.cantidad, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCerrar}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-violet-600 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold text-base">Artículos a preparar</h2>
            <p className="text-violet-200 text-xs mt-0.5">Consolidado de pedidos pendientes</p>
          </div>
          <button onClick={onCerrar} className="text-violet-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b space-y-2 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {RANGOS.map(r => (
              <button
                key={r.value}
                onClick={() => setRango(r.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  rango === r.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sucursalId}
              onChange={e => setSucursalId(e.target.value)}
              className="text-sm border rounded-lg px-2.5 py-1.5 bg-white min-w-[150px]"
            >
              <option value="">Todas las sucursales</option>
              {(sucursales || []).map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
            {rango === 'custom' && (
              <>
                <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5" />
                <span className="text-gray-400 text-xs">a</span>
                <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="text-sm border rounded-lg px-2 py-1.5" />
              </>
            )}
          </div>
        </div>

        {/* Lista de artículos */}
        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Cargando...
            </div>
          ) : articulos.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              No hay pedidos pendientes en este rango
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-xs text-gray-400 border-b">
                  <th className="text-left font-medium px-5 py-2.5">Artículo</th>
                  <th className="text-left font-medium px-2 py-2.5 w-24">Código</th>
                  <th className="text-right font-medium px-5 py-2.5 w-24">Cantidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {articulos.map((art, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-700">{art.nombre}</td>
                    <td className="px-2 py-2.5 text-gray-400 text-xs">{art.codigo || '—'}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-violet-700">{art.cantidad}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {articulos.length > 0 && (
          <div className="border-t bg-gray-50 px-5 py-3 flex-shrink-0">
            <span className="text-sm text-gray-500">
              <span className="font-semibold text-gray-800">{articulos.length}</span> productos, <span className="font-semibold text-gray-800">{totalUnidades}</span> unidades
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
