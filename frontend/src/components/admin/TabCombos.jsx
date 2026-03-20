import React, { useState, useEffect, useMemo } from 'react'
import api from '../../services/api'

const formatPrecio = (p) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(p || 0)

const TabCombos = () => {
  // Combos importados (locales)
  const [combosLocales, setCombosLocales] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)

  // Combos disponibles en Centum
  const [combosERP, setCombosERP] = useState([])
  const [cargandoERP, setCargandoERP] = useState(false)
  const [mostrarERP, setMostrarERP] = useState(false)
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [importando, setImportando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  // Filtros
  const [busqueda, setBusqueda] = useState('')
  const [busquedaERP, setBusquedaERP] = useState('')

  // Modal sucursales
  const [comboExpandido, setComboExpandido] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const [artRes, sucRes] = await Promise.all([
        api.get('/api/articulos?tipo=combo'),
        api.get('/api/sucursales'),
      ])
      setCombosLocales(artRes.data)
      setSucursales(sucRes.data)
    } catch (err) {
      console.error('Error al cargar combos:', err)
    } finally {
      setCargando(false)
    }
  }

  const cargarCombosERP = async () => {
    setCargandoERP(true)
    setMensaje('')
    try {
      const { data } = await api.get('/api/articulos/combos-erp')
      setCombosERP(data.combos || [])
      setMostrarERP(true)
      setSeleccionados(new Set())
    } catch (err) {
      setMensaje('Error al cargar combos del ERP')
    } finally {
      setCargandoERP(false)
    }
  }

  const importarSeleccionados = async () => {
    if (seleccionados.size === 0) return
    setImportando(true)
    setMensaje('')
    try {
      const { data } = await api.post('/api/articulos/combos-importar', {
        ids_centum: [...seleccionados],
      })
      setMensaje(`ok:${data.mensaje}`)
      setSeleccionados(new Set())
      await cargarDatos()
      setCombosERP(prev => prev.map(c =>
        seleccionados.has(c.id_centum) ? { ...c, importado: true } : c
      ))
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al importar combos')
    } finally {
      setImportando(false)
    }
  }

  const eliminarCombo = async (id) => {
    if (!confirm('¿Eliminar este combo? Se quitará del POS.')) return
    try {
      await api.delete(`/api/articulos/combos/${id}`)
      setCombosLocales(prev => prev.filter(c => c.id !== id))
      setCombosERP(prev => prev.map(c => {
        const local = combosLocales.find(l => l.id === id)
        if (local && c.id_centum === local.id_centum) return { ...c, importado: false }
        return c
      }))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  const toggleSucursal = async (comboId, sucursalId, habilitado) => {
    setGuardando(true)
    try {
      await api.put(`/api/articulos/${comboId}/sucursal/${sucursalId}`, { habilitado: !habilitado })
      setCombosLocales(prev => prev.map(c => {
        if (c.id !== comboId) return c
        const rels = (c.articulos_por_sucursal || []).map(r =>
          r.sucursal_id === sucursalId ? { ...r, habilitado: !habilitado } : r
        )
        // Si no existía la relación, agregarla
        if (!rels.find(r => r.sucursal_id === sucursalId)) {
          rels.push({ sucursal_id: sucursalId, habilitado: !habilitado })
        }
        return { ...c, articulos_por_sucursal: rels }
      }))
    } catch (err) {
      alert('Error al actualizar sucursal')
    } finally {
      setGuardando(false)
    }
  }

  // Filtros locales
  const combosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return combosLocales
    const q = busqueda.toLowerCase()
    return combosLocales.filter(a =>
      (a.nombre || '').toLowerCase().includes(q) ||
      (a.codigo || '').toLowerCase().includes(q)
    )
  }, [combosLocales, busqueda])

  // Filtros ERP
  const combosERPFiltrados = useMemo(() => {
    if (!busquedaERP.trim()) return combosERP
    const q = busquedaERP.toLowerCase()
    return combosERP.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.codigo || '').toLowerCase().includes(q)
    )
  }, [combosERP, busquedaERP])

  const contarHabilitadas = (articulo) => {
    return (articulo.articulos_por_sucursal || []).filter(r => r.habilitado).length
  }

  const toggleSeleccion = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      {/* Importar desde ERP */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={cargarCombosERP} disabled={cargandoERP}
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            {cargandoERP ? 'Cargando...' : mostrarERP ? 'Actualizar lista ERP' : 'Cargar combos de Centum'}
          </button>
          {seleccionados.size > 0 && (
            <button onClick={importarSeleccionados} disabled={importando}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {importando ? 'Importando...' : `Importar ${seleccionados.size} seleccionado(s)`}
            </button>
          )}
          {mensaje && (
            <span className={`text-sm ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
              {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
            </span>
          )}
        </div>
      </div>

      {/* Lista de combos ERP */}
      {mostrarERP && (
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">Combos disponibles en Centum ({combosERP.length})</h3>
          </div>
          <div className="p-3">
            <input type="text" value={busquedaERP} onChange={e => setBusquedaERP(e.target.value)}
              placeholder="Buscar combo..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-2" />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
            {combosERPFiltrados.map(combo => (
              <div key={combo.id_centum} className={`flex items-center gap-3 px-4 py-2.5 ${combo.importado ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                {!combo.importado ? (
                  <input type="checkbox" checked={seleccionados.has(combo.id_centum)}
                    onChange={() => toggleSeleccion(combo.id_centum)} className="w-4 h-4 text-violet-600 rounded" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-green-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{combo.nombre}</p>
                  <span className="text-xs text-gray-400">{combo.codigo}</span>
                </div>
                <span className="text-sm text-gray-600">{formatPrecio(combo.precio)}</span>
                {combo.importado && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Importado</span>
                )}
              </div>
            ))}
            {combosERPFiltrados.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-6">No se encontraron combos</div>
            )}
          </div>
        </div>
      )}

      {/* Combos importados */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-3">
          <h3 className="font-semibold text-gray-800 text-sm">Combos importados ({combosLocales.length})</h3>
        </div>

        {combosLocales.length > 3 && (
          <div className="px-3 pt-3">
            <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
        )}

        {cargando ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
          </div>
        ) : combosFiltrados.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">
            {combosLocales.length === 0 ? 'No hay combos importados. Usá el botón de arriba para importar desde Centum.' : 'Sin resultados'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {combosFiltrados.map(combo => {
              const hab = contarHabilitadas(combo)
              const isExpanded = comboExpandido === combo.id

              return (
                <div key={combo.id}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setComboExpandido(isExpanded ? null : combo.id)}>
                      <p className="text-sm font-medium text-gray-800 truncate">{combo.nombre}</p>
                      <div className="flex gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{combo.codigo}</span>
                        {combo.rubro && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{combo.rubro}</span>}
                        <span className="text-xs text-gray-500">{formatPrecio(combo.precio)}</span>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      hab > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {hab}/{sucursales.length} suc.
                    </span>
                    <button onClick={() => eliminarCombo(combo.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors" title="Eliminar combo">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {/* Sucursales expandibles */}
                  {isExpanded && (
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-500 mb-2">Habilitar por sucursal:</p>
                      <div className="flex flex-wrap gap-2">
                        {sucursales.map(suc => {
                          const rel = (combo.articulos_por_sucursal || []).find(r => r.sucursal_id === suc.id)
                          const habilitado = rel?.habilitado || false
                          return (
                            <button key={suc.id} onClick={() => toggleSucursal(combo.id, suc.id, habilitado)}
                              disabled={guardando}
                              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                                habilitado
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                              }`}>
                              {suc.nombre}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TabCombos
