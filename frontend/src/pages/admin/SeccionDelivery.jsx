import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const SeccionDelivery = () => {
  const [articulosDelivery, setArticulosDelivery] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [precioInput, setPrecioInput] = useState('')
  const [articuloSel, setArticuloSel] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const [editandoPrecio, setEditandoPrecio] = useState('')

  const cargar = async () => {
    try {
      const { data } = await api.get('/api/pos/articulos-delivery')
      setArticulosDelivery(data || [])
    } catch (err) {
      console.error('Error cargando artículos delivery:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // Buscar artículos con debounce
  useEffect(() => {
    if (!busqueda.trim() || busqueda.trim().length < 2) {
      setResultados([])
      return
    }
    const timeout = setTimeout(async () => {
      setBuscando(true)
      try {
        const { data } = await api.get('/api/pos/articulos', { params: { buscar: busqueda.trim() } })
        setResultados((data.articulos || []).slice(0, 15))
      } catch { setResultados([]) }
      finally { setBuscando(false) }
    }, 500)
    return () => clearTimeout(timeout)
  }, [busqueda])

  const seleccionarArticulo = (art) => {
    setArticuloSel(art)
    setBusqueda('')
    setResultados([])
    // Pre-fill con precio existente si ya está configurado
    const existente = articulosDelivery.find(d => d.articulo_id_centum === art.id)
    setPrecioInput(existente ? String(existente.precio_delivery) : '')
  }

  const guardar = async () => {
    if (!articuloSel || !precioInput) return
    const precio = parseFloat(precioInput)
    if (!precio || precio <= 0) return
    setGuardando(true)
    setMensaje(null)
    try {
      await api.post('/api/pos/articulos-delivery', {
        articulo_id_centum: articuloSel.id,
        nombre: articuloSel.nombre,
        precio_delivery: precio,
      })
      setArticuloSel(null)
      setPrecioInput('')
      setMensaje({ tipo: 'ok', texto: 'Artículo delivery guardado' })
      await cargar()
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al guardar' })
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este artículo de delivery?')) return
    try {
      await api.delete(`/api/pos/articulos-delivery/${id}`)
      await cargar()
    } catch (err) {
      alert('Error al eliminar: ' + (err.response?.data?.error || err.message))
    }
  }

  const toggleActivo = async (item) => {
    try {
      await api.post('/api/pos/articulos-delivery', {
        articulo_id_centum: item.articulo_id_centum,
        nombre: item.nombre,
        precio_delivery: item.precio_delivery,
        activo: !item.activo,
      })
      await cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const guardarEdicionPrecio = async (item) => {
    const precio = parseFloat(editandoPrecio)
    if (!precio || precio <= 0) { setEditandoId(null); return }
    try {
      await api.post('/api/pos/articulos-delivery', {
        articulo_id_centum: item.articulo_id_centum,
        nombre: item.nombre,
        precio_delivery: precio,
        activo: item.activo,
      })
      setEditandoId(null)
      setEditandoPrecio('')
      await cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Configurar artículos con precio especial para ventas en plataformas de delivery (PedidosYa / Rappi).
      </p>

      {/* Buscador de artículos */}
      <div className="relative">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Agregar artículo</label>
        <input
          type="text"
          value={articuloSel ? `${articuloSel.codigo} — ${articuloSel.nombre}` : busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setArticuloSel(null) }}
          onFocus={() => { if (articuloSel) { setBusqueda(''); setArticuloSel(null) } }}
          placeholder="Buscar por nombre o código..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:border-orange-400"
        />
        {buscando && <div className="absolute right-3 top-8 text-xs text-gray-400">Buscando...</div>}
        {resultados.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {resultados.map(art => {
              const yaConfigurado = articulosDelivery.some(d => d.articulo_id_centum === art.id)
              return (
                <button
                  key={art.id}
                  onClick={() => seleccionarArticulo(art)}
                  className="w-full text-left px-3 py-2 hover:bg-orange-50 flex justify-between items-center border-b border-gray-50 last:border-0"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-800">{art.nombre}</span>
                    <span className="text-xs text-gray-400 ml-2">#{art.codigo}</span>
                    {yaConfigurado && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded ml-2">ya configurado</span>}
                  </div>
                  <span className="text-sm text-gray-500">{formatPrecio(art.precio)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Input precio delivery */}
      {articuloSel && (
        <div className="flex items-end gap-3 p-3 bg-orange-50 rounded-lg border border-orange-200">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800">{articuloSel.nombre}</div>
            <div className="text-xs text-gray-500">Precio normal: {formatPrecio(articuloSel.precio)}</div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Precio delivery</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={precioInput}
              onChange={(e) => setPrecioInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && guardar()}
              placeholder="0.00"
              autoFocus
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <button
            onClick={guardar}
            disabled={guardando || !precioInput}
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={() => { setArticuloSel(null); setPrecioInput('') }}
            className="text-gray-400 hover:text-gray-600 px-2 py-2 text-sm"
          >
            Cancelar
          </button>
        </div>
      )}

      {mensaje && (
        <p className={`text-sm ${mensaje.tipo === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
          {mensaje.texto}
        </p>
      )}

      {/* Lista de artículos delivery configurados */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Artículos configurados ({articulosDelivery.length})
        </h3>
        {cargando ? (
          <div className="text-sm text-gray-400">Cargando...</div>
        ) : articulosDelivery.length === 0 ? (
          <div className="text-sm text-gray-400">No hay artículos delivery configurados</div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Artículo</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Precio Delivery</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Estado</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {articulosDelivery.map(item => (
                  <tr key={item.id} className={!item.activo ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-800">{item.nombre}</span>
                      <span className="text-xs text-gray-400 ml-1">#{item.articulo_id_centum}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editandoId === item.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editandoPrecio}
                          onChange={(e) => setEditandoPrecio(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') guardarEdicionPrecio(item)
                            if (e.key === 'Escape') { setEditandoId(null); setEditandoPrecio('') }
                          }}
                          onBlur={() => guardarEdicionPrecio(item)}
                          autoFocus
                          className="w-24 border border-orange-300 rounded px-2 py-1 text-sm text-right focus:ring-1 focus:ring-orange-400"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditandoId(item.id); setEditandoPrecio(String(item.precio_delivery)) }}
                          className="text-orange-600 font-semibold hover:underline"
                          title="Click para editar"
                        >
                          {formatPrecio(item.precio_delivery)}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleActivo(item)}
                        className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                          item.activo
                            ? 'bg-green-50 text-green-600 hover:bg-green-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                      >
                        {item.activo ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => eliminar(item.id)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar"
                      >
                        <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeccionDelivery
