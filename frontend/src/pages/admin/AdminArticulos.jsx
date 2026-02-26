// Panel de administrador: gestionar artículos ERP — lista plana con búsqueda, filtro, paginación y modal
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import ArticuloModal from '../../components/ArticuloModal'
import api from '../../services/api'

const POR_PAGINA = 100

const AdminArticulos = () => {
  const [articulos, setArticulos] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensajeSync, setMensajeSync] = useState('')

  // Búsqueda, filtros y paginación
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | habilitados | deshabilitados
  const [filtroMarca, setFiltroMarca] = useState('')
  const [filtroSucursal, setFiltroSucursal] = useState('')
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

  // Marcas únicas para el filtro
  const marcas = useMemo(() => {
    const set = new Set()
    articulos.forEach(a => { if (a.marca) set.add(a.marca) })
    return [...set].sort()
  }, [articulos])

  // Filtrado client-side
  const articulosFiltrados = useMemo(() => {
    let lista = articulos

    // Búsqueda por nombre o código (tolerante con ceros a la izquierda)
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      const qSinCeros = q.replace(/^0+/, '')
      lista = lista.filter(a => {
        const nombre = a.nombre?.toLowerCase() || ''
        const codigo = a.codigo?.toLowerCase() || ''
        const codigoSinCeros = codigo.replace(/^0+/, '')
        return nombre.includes(q) || codigo.includes(q) || codigoSinCeros.includes(qSinCeros) || qSinCeros && codigo.includes(qSinCeros)
      })
    }

    // Filtro por marca
    if (filtroMarca) {
      lista = lista.filter(a => a.marca === filtroMarca)
    }

    // Filtro habilitados/deshabilitados (general o por sucursal)
    if (filtro === 'habilitados') {
      lista = lista.filter(a =>
        a.articulos_por_sucursal?.some(r => r.habilitado && (!filtroSucursal || r.sucursal_id === filtroSucursal))
      )
    } else if (filtro === 'deshabilitados') {
      if (filtroSucursal) {
        lista = lista.filter(a =>
          !a.articulos_por_sucursal?.some(r => r.habilitado && r.sucursal_id === filtroSucursal)
        )
      } else {
        lista = lista.filter(a =>
          !a.articulos_por_sucursal?.some(r => r.habilitado)
        )
      }
    } else if (filtroSucursal) {
      // "Todos" pero filtrado por sucursal: solo mostrar los que tienen relación con esa sucursal
      lista = lista.filter(a =>
        a.articulos_por_sucursal?.some(r => r.sucursal_id === filtroSucursal)
      )
    }

    return lista
  }, [articulos, busqueda, filtro, filtroMarca, filtroSucursal])

  // Paginación
  const totalPaginas = Math.max(1, Math.ceil(articulosFiltrados.length / POR_PAGINA))
  const articulosPagina = articulosFiltrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)

  // Resetear página al cambiar búsqueda o filtros
  useEffect(() => { setPagina(1) }, [busqueda, filtro, filtroMarca, filtroSucursal])

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

  // Callback cuando el modal guarda — update local inmediato
  const handleModalUpdate = (articuloId, nuevasRelaciones) => {
    setArticulos(prev => prev.map(a => {
      if (a.id !== articuloId) return a
      return { ...a, articulos_por_sucursal: nuevasRelaciones }
    }))
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Artículos ERP" />

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
          <div className="flex flex-col gap-3 mb-4">
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código..."
              className="campo-form text-sm"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                className="campo-form text-sm flex-1"
              >
                <option value="todos">Todos</option>
                <option value="habilitados">Habilitados</option>
                <option value="deshabilitados">Deshabilitados</option>
              </select>
              <select
                value={filtroSucursal}
                onChange={e => setFiltroSucursal(e.target.value)}
                className="campo-form text-sm flex-1"
              >
                <option value="">Todas las sucursales</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <select
                value={filtroMarca}
                onChange={e => setFiltroMarca(e.target.value)}
                className="campo-form text-sm flex-1"
              >
                <option value="">Todas las marcas</option>
                {marcas.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
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
