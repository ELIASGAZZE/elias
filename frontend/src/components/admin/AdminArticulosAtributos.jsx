import React, { useState, useEffect, useMemo } from 'react'
import api from '../../services/api'

const TABS = [
  { id: 'articulos', label: 'Artículos' },
  { id: 'atributos', label: 'Atributos' },
]

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

const AdminArticulosAtributos = () => {
  const [tab, setTab] = useState('articulos')
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroAtributo, setFiltroAtributo] = useState('') // "id|id_valor"
  const [filtroRubro, setFiltroRubro] = useState('')

  useEffect(() => {
    cargarArticulos()
  }, [])

  async function cargarArticulos() {
    setCargando(true)
    try {
      const { data } = await api.get('/api/pos/articulos')
      setArticulos(data.articulos || [])
    } catch (err) {
      console.error('Error cargando artículos:', err)
    } finally {
      setCargando(false)
    }
  }

  // Extraer atributos únicos de los artículos
  const atributosMap = useMemo(() => {
    const map = {} // { attrId: { id, nombre, valores: { id_valor: { valor, count } } } }
    for (const art of articulos) {
      for (const attr of (art.atributos || [])) {
        if (!attr.id || !attr.id_valor) continue
        if (!map[attr.id]) map[attr.id] = { id: attr.id, nombre: attr.nombre, valores: {} }
        if (!map[attr.id].valores[attr.id_valor]) {
          map[attr.id].valores[attr.id_valor] = { valor: attr.valor, id_valor: attr.id_valor, count: 0 }
        }
        map[attr.id].valores[attr.id_valor].count++
      }
    }
    return map
  }, [articulos])

  const atributosLista = useMemo(() => {
    return Object.values(atributosMap)
      .map(a => ({
        ...a,
        valores: Object.values(a.valores).sort((x, y) => x.valor.localeCompare(y.valor)),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [atributosMap])

  // Rubros únicos
  const rubros = useMemo(() => {
    const set = new Map()
    for (const a of articulos) {
      if (a.rubro?.nombre && !set.has(a.rubro.nombre)) set.set(a.rubro.nombre, a.rubro)
    }
    return [...set.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [articulos])

  // Filtrar artículos
  const articulosFiltrados = useMemo(() => {
    let items = articulos

    if (busqueda.trim()) {
      const terminos = busqueda.toLowerCase().trim().split(/\s+/)
      items = items.filter(a => {
        const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
        return terminos.every(t => texto.includes(t))
      })
    }

    if (filtroRubro) {
      items = items.filter(a => a.rubro?.nombre === filtroRubro)
    }

    if (filtroAtributo) {
      const idValor = parseInt(filtroAtributo.split('|')[1])
      items = items.filter(a => (a.atributos || []).some(at => at.id_valor === idValor))
    }

    return items
  }, [articulos, busqueda, filtroRubro, filtroAtributo])

  // Artículos por atributo (para tab atributos)
  const articulosPorAtributoValor = useMemo(() => {
    if (tab !== 'atributos') return {}
    const map = {} // { "id|id_valor": [articulo, ...] }
    for (const art of articulos) {
      for (const attr of (art.atributos || [])) {
        const key = `${attr.id}|${attr.id_valor}`
        if (!map[key]) map[key] = []
        map[key].push(art)
      }
    }
    return map
  }, [articulos, tab])

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setBusqueda(''); setFiltroAtributo(''); setFiltroRubro('') }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="flex items-center px-3 text-xs text-gray-400">
          {articulos.length} artículos
        </span>
      </div>

      {/* ===== TAB ARTÍCULOS ===== */}
      {tab === 'articulos' && (
        <div>
          {/* Filtros */}
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, código..."
              className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <select
              value={filtroRubro}
              onChange={e => setFiltroRubro(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">Todos los rubros</option>
              {rubros.map(r => (
                <option key={r.nombre} value={r.nombre}>{r.nombre}</option>
              ))}
            </select>
            <select
              value={filtroAtributo}
              onChange={e => setFiltroAtributo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">Todos los atributos</option>
              {atributosLista.map(attr => (
                <optgroup key={attr.id} label={attr.nombre}>
                  {attr.valores.map(v => (
                    <option key={v.id_valor} value={`${attr.id}|${v.id_valor}`}>
                      {v.valor} ({v.count})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {(busqueda || filtroRubro || filtroAtributo) && (
              <button
                onClick={() => { setBusqueda(''); setFiltroRubro(''); setFiltroAtributo('') }}
                className="text-xs text-gray-500 hover:text-gray-700 px-2"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <div className="text-xs text-gray-400 mb-2">
            {articulosFiltrados.length} artículos
            {(busqueda || filtroRubro || filtroAtributo) ? ' (filtrados)' : ''}
          </div>

          {/* Tabla */}
          <div className="border rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Código</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Nombre</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Rubro</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Precio</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Atributos</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {articulosFiltrados.slice(0, 200).map(art => (
                  <tr key={art.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{art.codigo}</td>
                    <td className="px-3 py-2 text-gray-800">{art.nombre}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{art.rubro?.nombre || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{formatPrecio(art.precio)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(art.atributos || []).map((attr, i) => (
                          <span
                            key={i}
                            className="inline-block bg-violet-50 text-violet-700 text-xs px-1.5 py-0.5 rounded"
                            title={attr.nombre}
                          >
                            {attr.valor}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400 text-xs whitespace-nowrap">
                      {art.updatedAt ? new Date(art.updatedAt).toLocaleDateString('es-AR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {articulosFiltrados.length > 200 && (
              <div className="text-center text-xs text-gray-400 py-2 bg-gray-50">
                Mostrando 200 de {articulosFiltrados.length} — usá los filtros para acotar
              </div>
            )}
            {articulosFiltrados.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-8">
                No se encontraron artículos
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB ATRIBUTOS ===== */}
      {tab === 'atributos' && (
        <div>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar atributo o valor..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
          />

          <div className="space-y-3">
            {atributosLista
              .filter(attr => {
                if (!busqueda.trim()) return true
                const q = busqueda.toLowerCase()
                return attr.nombre.toLowerCase().includes(q) ||
                  attr.valores.some(v => v.valor.toLowerCase().includes(q))
              })
              .map(attr => (
                <AtributoCard
                  key={attr.id}
                  attr={attr}
                  articulosPorValor={articulosPorAtributoValor}
                  busqueda={busqueda}
                />
              ))}
          </div>

          {atributosLista.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-8">
              No hay atributos sincronizados. Ejecutá la sincronización de artículos primero.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Componente para cada atributo con sus valores expandibles
const AtributoCard = ({ attr, articulosPorValor, busqueda }) => {
  const [expandido, setExpandido] = useState(null) // id_valor expandido

  const valoresFiltrados = busqueda.trim()
    ? attr.valores.filter(v =>
        v.valor.toLowerCase().includes(busqueda.toLowerCase()) ||
        attr.nombre.toLowerCase().includes(busqueda.toLowerCase())
      )
    : attr.valores

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800 text-sm">{attr.nombre}</h3>
          <span className="text-xs text-gray-400">{attr.valores.length} valores</span>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {valoresFiltrados.map(val => {
          const key = `${attr.id}|${val.id_valor}`
          const isOpen = expandido === val.id_valor
          const arts = articulosPorValor[key] || []

          return (
            <div key={val.id_valor}>
              <button
                onClick={() => setExpandido(isOpen ? null : val.id_valor)}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block bg-violet-100 text-violet-700 text-xs font-medium px-2 py-0.5 rounded">
                    {val.valor}
                  </span>
                  <span className="text-xs text-gray-400">{val.count} artículos</span>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {isOpen && (
                <div className="bg-white border-t border-gray-100 max-h-[300px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-1.5 font-medium text-gray-500">Código</th>
                        <th className="text-left px-4 py-1.5 font-medium text-gray-500">Nombre</th>
                        <th className="text-left px-4 py-1.5 font-medium text-gray-500">Rubro</th>
                        <th className="text-right px-4 py-1.5 font-medium text-gray-500">Precio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {arts.map(a => (
                        <tr key={a.id} className="hover:bg-violet-50/30">
                          <td className="px-4 py-1.5 text-gray-500 font-mono">{a.codigo}</td>
                          <td className="px-4 py-1.5 text-gray-700">{a.nombre}</td>
                          <td className="px-4 py-1.5 text-gray-400">{a.rubro?.nombre || '—'}</td>
                          <td className="px-4 py-1.5 text-right text-gray-600">{formatPrecio(a.precio)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AdminArticulosAtributos
