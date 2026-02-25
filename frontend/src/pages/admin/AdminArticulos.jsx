// Panel de administrador: gestionar artículos ERP — lista plana con búsqueda, filtro, paginación y modal
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import ArticuloModal from '../../components/ArticuloModal'
import api from '../../services/api'

const POR_PAGINA = 100

const AdminArticulos = () => {
  const [articulos, setArticulos] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensajeSync, setMensajeSync] = useState('')

  // Búsqueda, filtro y paginación
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | habilitados | deshabilitados
  const [pagina, setPagina] = useState(1)

  // Modal
  const [articuloModal, setArticuloModal] = useState(null)

  useEffect(() => {
    cargarDatos()
  }, [])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const [artRes, sucRes] = await Promise.all([
        api.get('/api/articulos?tipo=automatico'),
        api.get('/api/sucursales'),
      ])
      setArticulos(artRes.data)
      setSucursales(sucRes.data)
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setCargando(false)
    }
  }

  // Filtrado client-side
  const articulosFiltrados = useMemo(() => {
    let lista = articulos

    // Búsqueda por nombre o código
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter(a =>
        a.nombre?.toLowerCase().includes(q) || a.codigo?.toLowerCase().includes(q)
      )
    }

    // Filtro habilitados/deshabilitados
    if (filtro === 'habilitados') {
      lista = lista.filter(a =>
        a.articulos_por_sucursal?.some(r => r.habilitado)
      )
    } else if (filtro === 'deshabilitados') {
      lista = lista.filter(a =>
        !a.articulos_por_sucursal?.some(r => r.habilitado)
      )
    }

    return lista
  }, [articulos, busqueda, filtro])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(articulosFiltrados.length / POR_PAGINA))
  const articulosPagina = articulosFiltrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  // Resetear página al cambiar búsqueda o filtro
  useEffect(() => { setPagina(1) }, [busqueda, filtro])

  // Indicador de sucursales habilitadas
  const contarHabilitadas = (articulo) => {
    const hab = articulo.articulos_por_sucursal?.filter(r => r.habilitado).length || 0
    const total = sucursales.length
    return `${hab}/${total}`
  }

  // Sincronizar ERP
  const sincronizarERP = async () => {
    setSincronizando(true)
    setMensajeSync('')
    try {
      const { data } = await api.post('/api/articulos/sincronizar-erp')
      setMensajeSync(`ok:${data.mensaje}`)
      await cargarDatos()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al sincronizar con el ERP'
      setMensajeSync(msg)
    } finally {
      setSincronizando(false)
    }
  }

  // Callback cuando el modal actualiza un artículo — recargamos datos
  const handleModalUpdate = async () => {
    try {
      const { data } = await api.get('/api/articulos?tipo=automatico')
      setArticulos(data)
      // Actualizar el artículo abierto en el modal
      if (articuloModal) {
        const actualizado = data.find(a => a.id === articuloModal.id)
        if (actualizado) setArticuloModal(actualizado)
      }
    } catch (err) {
      console.error('Error al recargar:', err)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Artículos ERP" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* Sincronización ERP */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Sincronizar con ERP Centum</h2>
          <p className="text-xs text-gray-500 mb-3">
            Importa artículos habilitados desde el sistema ERP. Los artículos existentes se actualizan automáticamente.
          </p>
          <button onClick={sincronizarERP} disabled={sincronizando} className="btn-primario">
            {sincronizando ? 'Sincronizando...' : 'Sincronizar artículos del ERP'}
          </button>
          {mensajeSync && (
            <p className={`text-sm mt-2 ${mensajeSync.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
              {mensajeSync.startsWith('ok:') ? mensajeSync.slice(3) : mensajeSync}
            </p>
          )}
        </div>

        {/* Búsqueda + Filtro */}
        <div className="tarjeta">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="campo-form text-sm flex-1"
            />
            <select
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              className="campo-form text-sm sm:w-44"
            >
              <option value="todos">Todos</option>
              <option value="habilitados">Habilitados</option>
              <option value="deshabilitados">Deshabilitados</option>
            </select>
          </div>

          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {articulosFiltrados.length} artículo{articulosFiltrados.length !== 1 ? 's' : ''}
              </h3>

              {articulosPagina.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No se encontraron artículos.</p>
              ) : (
                <div className="space-y-0">
                  {articulosPagina.map(articulo => (
                    <div
                      key={articulo.id}
                      onClick={() => setArticuloModal(articulo)}
                      className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0 gap-2 cursor-pointer hover:bg-gray-50 -mx-1 px-1 rounded"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{articulo.nombre}</p>
                        <p className="text-xs text-gray-400">{articulo.codigo}</p>
                        {(articulo.rubro || articulo.marca) && (
                          <div className="flex gap-2 mt-0.5 flex-wrap">
                            {articulo.rubro && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{articulo.rubro}</span>
                            )}
                            {articulo.marca && (
                              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{articulo.marca}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                        articulo.articulos_por_sucursal?.some(r => r.habilitado)
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {contarHabilitadas(articulo)} suc.
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Paginación */}
              {totalPaginas > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={pagina === 1}
                    className="text-sm text-blue-600 disabled:text-gray-300"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-gray-500">
                    Página {pagina} de {totalPaginas}
                  </span>
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

      {/* Modal */}
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

export default AdminArticulos
