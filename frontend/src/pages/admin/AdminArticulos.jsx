// Panel de administrador: gestionar artículos habilitados por sucursal
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const AdminArticulos = () => {
  const [sucursales, setSucursales] = useState([])
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState('')
  const [articulos, setArticulos] = useState([])
  const [cargando, setCargando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [urlSheets, setUrlSheets] = useState('')
  const [mensaje, setMensaje] = useState('')

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

    const cargar = async () => {
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
    cargar()
  }, [sucursalSeleccionada])

  // Habilitar/deshabilitar un artículo para la sucursal actual
  const toggleHabilitado = async (articuloId, valorActual) => {
    try {
      await api.put(`/api/articulos/${articuloId}/sucursal/${sucursalSeleccionada}`, {
        habilitado: !valorActual,
      })
      // Actualizamos el estado local
      setArticulos(prev =>
        prev.map(a => a.id === articuloId ? { ...a, habilitado: !valorActual } : a)
      )
    } catch (err) {
      alert('Error al actualizar el artículo')
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

      // Recargamos la lista si hay sucursal seleccionada
      if (sucursalSeleccionada) {
        const { data } = await api.get(`/api/articulos/sucursal/${sucursalSeleccionada}`)
        setArticulos(data)
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear artículo'
      setMensajeCrear(msg)
    } finally {
      setCreando(false)
    }
  }

  // Importar artículos desde Google Sheets
  const importarDesdeSheets = async () => {
    if (!urlSheets.trim()) {
      setMensaje('Ingresá la URL del Google Sheet')
      return
    }

    setImportando(true)
    setMensaje('')

    try {
      const match = urlSheets.match(/\/d\/([a-zA-Z0-9-_]+)/)
      if (!match) {
        setMensaje('URL inválida. Copiá la URL completa del Google Sheet.')
        return
      }
      const sheetId = match[1]
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`

      const respuesta = await fetch(csvUrl)
      const texto = await respuesta.text()

      const filas = texto.trim().split('\n')
      const headers = filas[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
      const idxCodigo = headers.indexOf('codigo')
      const idxNombre = headers.indexOf('nombre')

      if (idxCodigo === -1 || idxNombre === -1) {
        setMensaje('El Sheet debe tener columnas "codigo" y "nombre"')
        return
      }

      const articulosImportar = filas.slice(1).map(fila => {
        const cols = fila.split(',').map(c => c.trim().replace(/"/g, ''))
        return { codigo: cols[idxCodigo], nombre: cols[idxNombre] }
      }).filter(a => a.codigo && a.nombre)

      const { data } = await api.post('/api/articulos/importar', { articulos: articulosImportar })
      setMensaje(`ok:${data.articulos.length} artículos importados correctamente`)

      // Recargamos la lista
      const res = await api.get(`/api/articulos/sucursal/${sucursalSeleccionada}`)
      setArticulos(res.data)
    } catch (err) {
      console.error('Error al importar:', err)
      setMensaje('Error al importar. Verificá que el Sheet sea público.')
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Artículos" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* Sección de creación manual de artículo */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Crear artículo</h2>
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

        {/* Sección de importación desde Google Sheets */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Importar desde Google Sheets</h2>
          <p className="text-xs text-gray-500 mb-3">
            El Sheet debe ser público y tener columnas: <strong>codigo</strong> y <strong>nombre</strong>
          </p>
          <input
            type="url"
            value={urlSheets}
            onChange={(e) => setUrlSheets(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="campo-form text-sm mb-3"
          />
          <button
            onClick={importarDesdeSheets}
            disabled={importando}
            className="btn-primario"
          >
            {importando ? 'Importando...' : 'Importar artículos'}
          </button>
          {mensaje && (
            <p className={`text-sm mt-2 ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
              {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
            </p>
          )}
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
            <div className="space-y-2">
              {articulos.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No hay artículos. Importá desde Google Sheets o creá uno manualmente.
                </p>
              )}
              {articulos.map(articulo => (
                <div key={articulo.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{articulo.nombre}</p>
                    <p className="text-xs text-gray-400">{articulo.codigo}</p>
                  </div>
                  {/* Toggle switch */}
                  <button
                    onClick={() => toggleHabilitado(articulo.id, articulo.habilitado)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminArticulos
