// Panel de administrador: gestionar artículos manuales — lista plana con búsqueda, filtro, paginación y modal
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import ArticuloModal from '../../components/ArticuloModal'
import api from '../../services/api'

const POR_PAGINA = 100

const AdminArticulosManuales = () => {
  const [articulos, setArticulos] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(false)

  // Rubros
  const [rubros, setRubros] = useState([])

  // Creación manual
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoRubro, setNuevoRubro] = useState('')
  const [creando, setCreando] = useState(false)
  const [mensajeCrear, setMensajeCrear] = useState('')

  // Búsqueda, filtro y paginación
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [pagina, setPagina] = useState(1)

  // Modal
  const [articuloModal, setArticuloModal] = useState(null)

  useEffect(() => {
    cargarDatos()
  }, [])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const [artRes, sucRes, rubRes] = await Promise.all([
        api.get('/api/articulos?tipo=manual'),
        api.get('/api/sucursales'),
        api.get('/api/rubros'),
      ])
      setArticulos(artRes.data)
      setSucursales(sucRes.data)
      setRubros(rubRes.data)
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setCargando(false)
    }
  }

  // Filtrado client-side
  const articulosFiltrados = useMemo(() => {
    let lista = articulos

    // Búsqueda tolerante con ceros a la izquierda
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

  useEffect(() => { setPagina(1) }, [busqueda, filtro])

  const contarHabilitadas = (articulo) => {
    const hab = articulo.articulos_por_sucursal?.filter(r => r.habilitado).length || 0
    const total = sucursales.length
    return `${hab}/${total}`
  }

  // Crear artículo manual
  const crearArticulo = async (e) => {
    e.preventDefault()
    if (!nuevoNombre.trim()) {
      setMensajeCrear('Ingresá el nombre del artículo')
      return
    }
    if (!nuevoRubro) {
      setMensajeCrear('Seleccioná un rubro')
      return
    }

    setCreando(true)
    setMensajeCrear('')

    try {
      await api.post('/api/articulos', {
        nombre: nuevoNombre.trim(),
        rubro: nuevoRubro,
      })
      setMensajeCrear('ok:Artículo creado correctamente')
      setNuevoNombre('')
      setNuevoRubro('')
      await cargarDatos()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear artículo'
      setMensajeCrear(msg)
    } finally {
      setCreando(false)
    }
  }

  // Callback cuando el modal guarda — update local inmediato
  const handleModalUpdate = (articuloId, nuevasRelaciones, articuloActualizado) => {
    setArticulos(prev => prev.map(a => {
      if (a.id !== articuloId) return a
      const updated = { ...a, articulos_por_sucursal: nuevasRelaciones }
      if (articuloActualizado) {
        updated.nombre = articuloActualizado.nombre
        updated.rubro = articuloActualizado.rubro
      }
      return updated
    }))
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Art. Manuales" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* Crear artículo manual */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Crear artículo manual</h2>
          <form onSubmit={crearArticulo} className="space-y-3">
            <input
              type="text"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre del artículo"
              className="campo-form text-sm"
            />
            <select
              value={nuevoRubro}
              onChange={(e) => setNuevoRubro(e.target.value)}
              className="campo-form text-sm"
            >
              <option value="">Seleccioná un rubro</option>
              {rubros.map(r => (
                <option key={r.id} value={r.nombre}>{r.nombre}</option>
              ))}
            </select>
            <button type="submit" disabled={creando} className="btn-primario">
              {creando ? 'Creando...' : 'Crear artículo'}
            </button>
            {mensajeCrear && (
              <p className={`text-sm ${mensajeCrear.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensajeCrear.startsWith('ok:') ? mensajeCrear.slice(3) : mensajeCrear}
              </p>
            )}
          </form>
        </div>

        {/* Búsqueda + Filtro + Lista */}
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
                <p className="text-gray-400 text-sm text-center py-4">
                  No se encontraron artículos. Creá uno con el formulario de arriba.
                </p>
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
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{articulo.codigo}</span>
                          {articulo.rubro && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                              {articulo.rubro}
                            </span>
                          )}
                        </div>
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
          rubros={rubros}
          onClose={() => setArticuloModal(null)}
          onUpdate={handleModalUpdate}
        />
      )}
    </div>
  )
}

export default AdminArticulosManuales
