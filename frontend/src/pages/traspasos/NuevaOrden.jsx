// Crear nueva orden de traspaso
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const NuevaOrden = () => {
  const navigate = useNavigate()
  const [sucursales, setSucursales] = useState([])
  const [sucursalOrigenId, setSucursalOrigenId] = useState('')
  const [sucursalDestinoId, setSucursalDestinoId] = useState('')
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    api.get('/api/sucursales').then(r => setSucursales(r.data || [])).catch(() => {})
  }, [])

  const buscarArticulos = async (q) => {
    setBusqueda(q)
    if (q.length < 2) { setResultados([]); return }
    setBuscando(true)
    try {
      const r = await api.get(`/api/articulos?busqueda=${encodeURIComponent(q)}&limite=10`)
      setResultados(r.data?.articulos || r.data || [])
    } catch { setResultados([]) }
    setBuscando(false)
  }

  const agregarItem = (articulo) => {
    const yaExiste = items.find(i => i.articulo_id === (articulo.id || articulo.articulo_id))
    if (yaExiste) return
    setItems([...items, {
      articulo_id: articulo.id || articulo.articulo_id,
      codigo: articulo.codigo,
      nombre: articulo.nombre,
      cantidad_solicitada: 1,
      cantidad_preparada: 0,
      es_pesable: articulo.es_pesable || false,
    }])
    setBusqueda('')
    setResultados([])
  }

  const actualizarCantidad = (idx, cant) => {
    const nuevos = [...items]
    nuevos[idx].cantidad_solicitada = parseFloat(cant) || 0
    setItems(nuevos)
  }

  const quitarItem = (idx) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const guardar = async () => {
    if (!sucursalOrigenId || !sucursalDestinoId) return alert('Seleccioná origen y destino')
    if (sucursalOrigenId === sucursalDestinoId) return alert('Origen y destino deben ser diferentes')
    if (items.length === 0) return alert('Agregá al menos un artículo')

    setGuardando(true)
    try {
      const r = await api.post('/api/traspasos/ordenes', {
        sucursal_origen_id: sucursalOrigenId,
        sucursal_destino_id: sucursalDestinoId,
        items,
        notas,
      })
      navigate(`/traspasos/ordenes/${r.data.id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear orden')
    }
    setGuardando(false)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Nueva Orden de Traspaso" sinTabs volverA="/traspasos/ordenes" />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Sucursales */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Sucursales</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Origen (depósito)</label>
              <select value={sucursalOrigenId} onChange={e => setSucursalOrigenId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Seleccionar...</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Destino (sucursal)</label>
              <select value={sucursalDestinoId} onChange={e => setSucursalDestinoId(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Seleccionar...</option>
                {sucursales.filter(s => s.id !== sucursalOrigenId).map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Artículos */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Artículos</h3>

          {/* Buscador */}
          <div className="relative">
            <input
              type="text"
              value={busqueda}
              onChange={e => buscarArticulos(e.target.value)}
              placeholder="Buscar artículo por nombre o código..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            {buscando && <div className="absolute right-3 top-2.5 text-xs text-gray-400">Buscando...</div>}

            {resultados.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {resultados.map(a => (
                  <button key={a.id} onClick={() => agregarItem(a)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                    <span className="font-medium text-gray-800">{a.nombre}</span>
                    <span className="text-gray-400 ml-2 text-xs">{a.codigo}</span>
                    {a.es_pesable && <span className="text-amber-500 ml-1 text-xs">(pesable)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lista de items */}
          {items.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-4">Buscá y agregá artículos</div>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 border border-gray-100 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{item.nombre}</div>
                    <div className="text-xs text-gray-400">{item.codigo}{item.es_pesable ? ' (pesable)' : ''}</div>
                  </div>
                  <input
                    type="number"
                    min="0.001"
                    step={item.es_pesable ? '0.001' : '1'}
                    value={item.cantidad_solicitada}
                    onChange={e => actualizarCantidad(idx, e.target.value)}
                    className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center"
                  />
                  <span className="text-xs text-gray-400">{item.es_pesable ? 'kg' : 'uds'}</span>
                  <button onClick={() => quitarItem(idx)} className="text-red-400 hover:text-red-600 p-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notas */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
          <textarea
            value={notas}
            onChange={e => setNotas(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            rows={2}
            placeholder="Observaciones..."
          />
        </div>

        {/* Guardar */}
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-gray-300 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {guardando ? 'Creando...' : `Crear Orden (${items.length} artículos)`}
        </button>
      </div>
    </div>
  )
}

export default NuevaOrden
