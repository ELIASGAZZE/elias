// Vista de preparación / picking de una orden de traspaso
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const Preparacion = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [nuevoCanastoPrecinto, setNuevoCanastoPrecinto] = useState('')
  const [creandoCanasto, setCreandoCanasto] = useState(false)
  const [canastoSeleccionado, setCanastoSeleccionado] = useState(null)

  // Items a agregar al canasto
  const [itemBusqueda, setItemBusqueda] = useState('')
  const [itemCantidad, setItemCantidad] = useState(1)
  const [pesoCanasto, setPesoCanasto] = useState('')

  const cargar = () => {
    api.get(`/api/traspasos/ordenes/${id}`)
      .then(r => {
        setOrden(r.data)
        if (r.data.estado !== 'en_preparacion') {
          alert('Esta orden no está en preparación')
          navigate(`/traspasos/ordenes/${id}`)
        }
      })
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [id])

  const crearCanasto = async () => {
    if (!nuevoCanastoPrecinto.trim()) return
    setCreandoCanasto(true)
    try {
      await api.post(`/api/traspasos/ordenes/${id}/canastos`, { precinto: nuevoCanastoPrecinto.trim() })
      setNuevoCanastoPrecinto('')
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear canasto')
    }
    setCreandoCanasto(false)
  }

  const agregarItemACanasto = async (canastoId, item) => {
    const canasto = orden.canastos.find(c => c.id === canastoId)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const itemsActuales = canasto.items || []
    const yaExiste = itemsActuales.find(i => i.articulo_id === item.articulo_id)

    let nuevosItems
    if (yaExiste) {
      nuevosItems = itemsActuales.map(i =>
        i.articulo_id === item.articulo_id
          ? { ...i, cantidad: i.cantidad + itemCantidad }
          : i
      )
    } else {
      nuevosItems = [...itemsActuales, {
        articulo_id: item.articulo_id,
        codigo: item.codigo,
        nombre: item.nombre,
        cantidad: itemCantidad,
        es_pesable: item.es_pesable,
      }]
    }

    try {
      await api.put(`/api/traspasos/canastos/${canastoId}`, { items: nuevosItems })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al actualizar canasto')
    }
  }

  const quitarItemDeCanasto = async (canastoId, articuloId) => {
    const canasto = orden.canastos.find(c => c.id === canastoId)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const nuevosItems = (canasto.items || []).filter(i => i.articulo_id !== articuloId)
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}`, { items: nuevosItems })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  const guardarPeso = async (canastoId) => {
    if (!pesoCanasto || parseFloat(pesoCanasto) <= 0) return alert('Ingresá un peso válido')
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}`, { peso_origen: parseFloat(pesoCanasto) })
      setPesoCanasto('')
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar peso')
    }
  }

  const cerrarCanasto = async (canastoId) => {
    if (!window.confirm('¿Cerrar este canasto? No podrás editarlo después.')) return
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}/cerrar`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cerrar canasto')
    }
  }

  const eliminarCanasto = async (canastoId) => {
    if (!window.confirm('¿Eliminar este canasto?')) return
    try {
      await api.delete(`/api/traspasos/canastos/${canastoId}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  const marcarPreparado = async () => {
    if (!window.confirm('¿Marcar orden como preparada? Todos los canastos deben estar cerrados.')) return
    try {
      await api.put(`/api/traspasos/ordenes/${id}/preparado`)
      navigate(`/traspasos/ordenes/${id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Preparación" sinTabs volverA={`/traspasos/ordenes/${id}`} />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return null

  const items = Array.isArray(orden.items) ? orden.items : []
  const canastos = orden.canastos || []
  const todosCerrados = canastos.length > 0 && canastos.every(c => c.estado === 'cerrado')

  // Items filtrados por búsqueda
  const itemsFiltrados = itemBusqueda
    ? items.filter(i => i.nombre.toLowerCase().includes(itemBusqueda.toLowerCase()) || i.codigo?.includes(itemBusqueda))
    : items

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={`Preparación ${orden.numero}`} sinTabs volverA={`/traspasos/ordenes/${id}`} />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Info */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-700">
          {orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre} — {items.length} artículos solicitados
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Checklist de artículos */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Artículos solicitados</h3>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm border-b border-gray-50 py-1.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-800">{item.nombre}</span>
                    <span className="text-gray-400 text-xs ml-1">{item.codigo}</span>
                  </div>
                  <span className="text-gray-500 text-xs whitespace-nowrap">
                    {item.cantidad_solicitada} {item.es_pesable ? 'kg' : 'uds'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Canastos */}
          <div className="space-y-4">
            {/* Crear canasto */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Nuevo Canasto</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nuevoCanastoPrecinto}
                  onChange={e => setNuevoCanastoPrecinto(e.target.value)}
                  placeholder="Código de precinto..."
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  onKeyDown={e => e.key === 'Enter' && crearCanasto()}
                />
                <button onClick={crearCanasto} disabled={creandoCanasto}
                  className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  Crear
                </button>
              </div>
            </div>

            {/* Lista de canastos */}
            {canastos.map(canasto => (
              <div key={canasto.id} className={`bg-white rounded-xl border p-4 ${canastoSeleccionado === canasto.id ? 'border-sky-400 ring-1 ring-sky-200' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">Precinto: {canasto.precinto}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${canasto.estado === 'en_preparacion' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                      {canasto.estado === 'en_preparacion' ? 'Abierto' : 'Cerrado'}
                    </span>
                  </div>
                  {canasto.estado === 'en_preparacion' && (
                    <div className="flex gap-1">
                      <button onClick={() => setCanastoSeleccionado(canastoSeleccionado === canasto.id ? null : canasto.id)}
                        className="text-sky-500 hover:text-sky-700 text-xs px-2 py-1 rounded">
                        {canastoSeleccionado === canasto.id ? 'Cerrar editor' : 'Agregar items'}
                      </button>
                      <button onClick={() => eliminarCanasto(canasto.id)}
                        className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded">
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>

                {/* Items del canasto */}
                {canasto.items && canasto.items.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {canasto.items.map((i, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1">
                        <span className="text-gray-700">{i.nombre}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">{i.cantidad} {i.es_pesable ? 'kg' : 'uds'}</span>
                          {canasto.estado === 'en_preparacion' && (
                            <button onClick={() => quitarItemDeCanasto(canasto.id, i.articulo_id)}
                              className="text-red-400 hover:text-red-600">×</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Agregar items al canasto seleccionado */}
                {canastoSeleccionado === canasto.id && canasto.estado === 'en_preparacion' && (
                  <div className="border-t border-gray-100 pt-2 mt-2 space-y-2">
                    <input
                      type="text"
                      value={itemBusqueda}
                      onChange={e => setItemBusqueda(e.target.value)}
                      placeholder="Filtrar artículos..."
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                    />
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-gray-500">Cant:</label>
                      <input
                        type="number"
                        min="0.001"
                        step="1"
                        value={itemCantidad}
                        onChange={e => setItemCantidad(parseFloat(e.target.value) || 1)}
                        className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-center"
                      />
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {itemsFiltrados.map((item, idx) => (
                        <button key={idx} onClick={() => agregarItemACanasto(canasto.id, item)}
                          className="w-full text-left text-xs px-2 py-1 rounded hover:bg-sky-50 text-gray-700">
                          + {item.nombre} <span className="text-gray-400">({item.codigo})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Peso y cerrar */}
                {canasto.estado === 'en_preparacion' && (
                  <div className="border-t border-gray-100 pt-2 mt-2 flex gap-2 items-center">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="Peso (kg)"
                      value={canasto.id === canastoSeleccionado ? pesoCanasto : (canasto.peso_origen || '')}
                      onChange={e => { setCanastoSeleccionado(canasto.id); setPesoCanasto(e.target.value) }}
                      className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
                    />
                    <button onClick={() => guardarPeso(canasto.id)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-medium transition-colors">
                      Guardar peso
                    </button>
                    <button onClick={() => cerrarCanasto(canasto.id)}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">
                      Cerrar
                    </button>
                  </div>
                )}

                {canasto.estado === 'cerrado' && canasto.peso_origen && (
                  <div className="text-xs text-gray-400 mt-1">Peso: {canasto.peso_origen} kg</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Marcar preparado */}
        {todosCerrados && (
          <button onClick={marcarPreparado}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors">
            Marcar Orden como Preparada
          </button>
        )}
      </div>
    </div>
  )
}

export default Preparacion
