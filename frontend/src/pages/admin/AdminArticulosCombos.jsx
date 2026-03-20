// Panel de administración: gestionar artículos combo desde Centum ERP
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import ArticuloModal from '../../components/ArticuloModal'
import api from '../../services/api'

const POR_PAGINA = 50

const AdminArticulosCombos = () => {
  // Combos importados (locales)
  const [combosLocales, setCombosLocales] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(false)

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
  const [pagina, setPagina] = useState(1)

  // Modal
  const [articuloModal, setArticuloModal] = useState(null)

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
      // Actualizar estado de importados en la lista ERP
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

  // Filtros locales
  const combosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return combosLocales
    const q = busqueda.toLowerCase()
    return combosLocales.filter(a =>
      (a.nombre || '').toLowerCase().includes(q) ||
      (a.codigo || '').toLowerCase().includes(q)
    )
  }, [combosLocales, busqueda])

  const totalPaginas = Math.max(1, Math.ceil(combosFiltrados.length / POR_PAGINA))
  const combosPagina = combosFiltrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  useEffect(() => { setPagina(1) }, [busqueda])

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
    const hab = articulo.articulos_por_sucursal?.filter(r => r.habilitado).length || 0
    return `${hab}/${sucursales.length}`
  }

  const toggleSeleccion = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleModalUpdate = (articuloId, nuevasRelaciones) => {
    setCombosLocales(prev => prev.map(a =>
      a.id === articuloId ? { ...a, articulos_por_sucursal: nuevasRelaciones } : a
    ))
  }

  const formatPrecio = (p) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(p || 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Artículos Combo" />

      <div className="px-4 py-4 space-y-4">

        {/* Importar desde ERP */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-2">Importar combos de Centum</h2>
          <p className="text-xs text-gray-500 mb-3">
            Cargá los combos disponibles en el ERP y seleccioná cuáles querés habilitar en el POS.
          </p>
          <button onClick={cargarCombosERP} disabled={cargandoERP} className="btn-primario">
            {cargandoERP ? 'Cargando...' : mostrarERP ? 'Actualizar lista' : 'Cargar combos disponibles'}
          </button>
          {mensaje && (
            <p className={`text-sm mt-2 ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
              {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
            </p>
          )}
        </div>

        {/* Lista de combos ERP */}
        {mostrarERP && (
          <div className="tarjeta">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700">
                Combos en Centum ({combosERP.length})
              </h3>
              {seleccionados.size > 0 && (
                <button
                  onClick={importarSeleccionados}
                  disabled={importando}
                  className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {importando ? 'Importando...' : `Importar ${seleccionados.size} seleccionado(s)`}
                </button>
              )}
            </div>
            <input
              type="text"
              value={busquedaERP}
              onChange={e => setBusquedaERP(e.target.value)}
              placeholder="Buscar combo..."
              className="campo-form text-sm mb-3"
            />
            <div className="max-h-80 overflow-y-auto space-y-0">
              {combosERPFiltrados.map(combo => (
                <div
                  key={combo.id_centum}
                  className={`flex items-center gap-3 py-2 px-2 border-b border-gray-100 last:border-0 rounded ${
                    combo.importado ? 'bg-green-50' : ''
                  }`}
                >
                  {!combo.importado && (
                    <input
                      type="checkbox"
                      checked={seleccionados.has(combo.id_centum)}
                      onChange={() => toggleSeleccion(combo.id_centum)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{combo.nombre}</p>
                    <div className="flex gap-2 text-xs text-gray-400">
                      <span>{combo.codigo}</span>
                      {combo.rubro && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{combo.rubro}</span>}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{formatPrecio(combo.precio)}</span>
                  {combo.importado && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      Importado
                    </span>
                  )}
                </div>
              ))}
              {combosERPFiltrados.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No se encontraron combos</p>
              )}
            </div>
          </div>
        )}

        {/* Combos importados (locales) */}
        <div className="tarjeta">
          <h3 className="font-semibold text-gray-700 mb-3">
            Combos importados ({combosLocales.length})
          </h3>
          {combosLocales.length > 0 && (
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar..."
              className="campo-form text-sm mb-3"
            />
          )}

          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : combosPagina.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">
              {combosLocales.length === 0 ? 'No hay combos importados. Usá el botón de arriba para importar.' : 'Sin resultados'}
            </p>
          ) : (
            <>
              <div className="space-y-0">
                {combosPagina.map(articulo => (
                  <div
                    key={articulo.id}
                    className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0 gap-2 hover:bg-gray-50 -mx-1 px-1 rounded"
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setArticuloModal(articulo)}
                    >
                      <p className="text-sm font-medium text-gray-800 truncate">{articulo.nombre}</p>
                      <div className="flex gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-400">{articulo.codigo}</span>
                        {articulo.rubro && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{articulo.rubro}</span>
                        )}
                        <span className="text-xs bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">Combo</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                        articulo.articulos_por_sucursal?.some(r => r.habilitado)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {contarHabilitadas(articulo)} suc.
                      </span>
                      <button
                        onClick={() => eliminarCombo(articulo.id)}
                        className="text-xs text-red-400 hover:text-red-600 px-1"
                        title="Eliminar combo"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {totalPaginas > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={pagina === 1}
                    className="text-sm text-blue-600 disabled:text-gray-300"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-gray-500">Página {pagina} de {totalPaginas}</span>
                  <button
                    onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                    disabled={pagina === totalPaginas}
                    className="text-sm text-blue-600 disabled:text-gray-300"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {articuloModal && (
        <ArticuloModal
          articulo={articuloModal}
          sucursales={sucursales}
          onClose={() => setArticuloModal(null)}
          onUpdate={handleModalUpdate}
        />
      )}
    </div>
  )
}

export default AdminArticulosCombos
