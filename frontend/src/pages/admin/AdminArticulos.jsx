// Panel de administrador: gestionar artículos habilitados por sucursal
// Sincronización ERP Centum + artículos manuales + stock ideal
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const AdminArticulos = () => {
  const [sucursales, setSucursales] = useState([])
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState('')
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensajeSync, setMensajeSync] = useState('')

  // Estado para creación manual de artículo
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [mensajeCrear, setMensajeCrear] = useState('')

  // Cargamos las sucursales al iniciar
  useEffect(() => {
    api.get('/api/sucursales').then(res => {
      setSucursales(res.data)
      if (res.data.length > 0) {
        setSucursalSeleccionada(res.data[0].id)
      }
    })
  }, [])

  // Cuando cambia la sucursal seleccionada, cargamos sus artículos
  useEffect(() => {
    if (!sucursalSeleccionada) return
    cargarArticulos()
  }, [sucursalSeleccionada])

  const cargarArticulos = async () => {
    if (!sucursalSeleccionada) return
    setCargando(true)
    try {
      const { data } = await api.get(`/api/articulos/sucursal/${sucursalSeleccionada}`)
      setArticulos(data)
    } catch (err) {
      console.error('Error al cargar artículos:', err)
    } finally {
      setCargando(false)
    }
  }

  // Separar artículos en manuales y automáticos (ERP)
  const articulosManuales = useMemo(() => articulos.filter(a => a.tipo === 'manual'), [articulos])
  const articulosERP = useMemo(() => articulos.filter(a => a.tipo === 'automatico'), [articulos])

  // Habilitar/deshabilitar un artículo para la sucursal actual
  const toggleHabilitado = async (articuloId, valorActual) => {
    try {
      await api.put(`/api/articulos/${articuloId}/sucursal/${sucursalSeleccionada}`, {
        habilitado: !valorActual,
      })
      setArticulos(prev =>
        prev.map(a => a.id === articuloId ? { ...a, habilitado: !valorActual } : a)
      )
    } catch (err) {
      alert('Error al actualizar el artículo')
    }
  }

  // Actualizar stock ideal
  const actualizarStockIdeal = async (articuloId, stock_ideal) => {
    try {
      await api.put(`/api/articulos/${articuloId}/sucursal/${sucursalSeleccionada}`, {
        stock_ideal,
      })
      setArticulos(prev =>
        prev.map(a => a.id === articuloId ? { ...a, stock_ideal } : a)
      )
    } catch (err) {
      console.error('Error al actualizar stock ideal:', err)
    }
  }

  // Crear artículo manual
  const crearArticulo = async (e) => {
    e.preventDefault()
    if (!nuevoCodigo.trim() || !nuevoNombre.trim()) {
      setMensajeCrear('Completá código y nombre')
      return
    }

    setCreando(true)
    setMensajeCrear('')

    try {
      await api.post('/api/articulos', {
        codigo: nuevoCodigo.trim(),
        nombre: nuevoNombre.trim(),
      })
      setMensajeCrear('ok:Artículo creado correctamente')
      setNuevoCodigo('')
      setNuevoNombre('')
      await cargarArticulos()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear artículo'
      setMensajeCrear(msg)
    } finally {
      setCreando(false)
    }
  }

  // Sincronizar con ERP Centum
  const sincronizarERP = async () => {
    setSincronizando(true)
    setMensajeSync('')

    try {
      const { data } = await api.post('/api/articulos/sincronizar-erp')
      setMensajeSync(`ok:${data.mensaje}`)
      await cargarArticulos()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al sincronizar con el ERP'
      setMensajeSync(msg)
    } finally {
      setSincronizando(false)
    }
  }

  // Renderizar fila de artículo
  const FilaArticulo = ({ articulo }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 gap-2">
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

      {/* Stock ideal (solo si habilitado) */}
      {articulo.habilitado && (
        <input
          type="number"
          min="0"
          value={articulo.stock_ideal || 0}
          onChange={(e) => {
            const val = Math.max(0, parseInt(e.target.value) || 0)
            actualizarStockIdeal(articulo.id, val)
          }}
          className="w-16 text-center text-sm border border-gray-300 rounded py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          title="Stock ideal"
        />
      )}

      {/* Toggle switch */}
      <button
        onClick={() => toggleHabilitado(articulo.id, articulo.habilitado)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          articulo.habilitado ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            articulo.habilitado ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Artículos" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* Sección de sincronización ERP */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Sincronizar con ERP Centum</h2>
          <p className="text-xs text-gray-500 mb-3">
            Importa artículos habilitados desde el sistema ERP. Los artículos existentes se actualizan automáticamente.
          </p>
          <button
            onClick={sincronizarERP}
            disabled={sincronizando}
            className="btn-primario"
          >
            {sincronizando ? 'Sincronizando...' : 'Sincronizar artículos del ERP'}
          </button>
          {mensajeSync && (
            <p className={`text-sm mt-2 ${mensajeSync.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
              {mensajeSync.startsWith('ok:') ? mensajeSync.slice(3) : mensajeSync}
            </p>
          )}
        </div>

        {/* Sección de creación manual de artículo */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Crear artículo manual</h2>
          <form onSubmit={crearArticulo} className="space-y-3">
            <input
              type="text"
              value={nuevoCodigo}
              onChange={(e) => setNuevoCodigo(e.target.value)}
              placeholder="Código"
              className="campo-form text-sm"
            />
            <input
              type="text"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre del artículo"
              className="campo-form text-sm"
            />
            <button
              type="submit"
              disabled={creando}
              className="btn-primario"
            >
              {creando ? 'Creando...' : 'Crear artículo'}
            </button>
            {mensajeCrear && (
              <p className={`text-sm ${mensajeCrear.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensajeCrear.startsWith('ok:') ? mensajeCrear.slice(3) : mensajeCrear}
              </p>
            )}
          </form>
        </div>

        {/* Selector de sucursal */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Artículos habilitados por sucursal</h2>
          <select
            value={sucursalSeleccionada}
            onChange={(e) => setSucursalSeleccionada(e.target.value)}
            className="campo-form mb-4"
          >
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>

          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <>
              {articulos.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No hay artículos. Sincronizá desde el ERP o creá uno manualmente.
                </p>
              )}

              {/* Artículos del ERP */}
              {articulosERP.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Artículos del ERP ({articulosERP.length})
                  </h3>
                  <div className="space-y-0">
                    {articulosERP.map(articulo => (
                      <FilaArticulo key={articulo.id} articulo={articulo} />
                    ))}
                  </div>
                </div>
              )}

              {/* Artículos Manuales */}
              {articulosManuales.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Artículos manuales ({articulosManuales.length})
                  </h3>
                  <div className="space-y-0">
                    {articulosManuales.map(articulo => (
                      <FilaArticulo key={articulo.id} articulo={articulo} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminArticulos
