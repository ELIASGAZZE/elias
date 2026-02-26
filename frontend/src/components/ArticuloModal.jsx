import React, { useState } from 'react'
import api from '../services/api'

const ArticuloModal = ({ articulo, sucursales, onClose, onUpdate }) => {
  // Mapa local del estado por sucursal — cambios se acumulan hasta guardar
  const [estadoPorSucursal, setEstadoPorSucursal] = useState(() => {
    const mapa = {}
    sucursales.forEach(s => {
      const rel = articulo.articulos_por_sucursal?.find(r => r.sucursal_id === s.id)
      mapa[s.id] = {
        habilitado: rel?.habilitado || false,
        stock_ideal: rel?.stock_ideal || 0,
      }
    })
    return mapa
  })
  const [guardando, setGuardando] = useState(false)

  const toggleHabilitado = (sucursalId) => {
    setEstadoPorSucursal(prev => ({
      ...prev,
      [sucursalId]: { ...prev[sucursalId], habilitado: !prev[sucursalId].habilitado },
    }))
  }

  const cambiarStock = (sucursalId, valor) => {
    const stock_ideal = Math.max(0, parseInt(valor) || 0)
    setEstadoPorSucursal(prev => ({
      ...prev,
      [sucursalId]: { ...prev[sucursalId], stock_ideal },
    }))
  }

  const guardar = async () => {
    setGuardando(true)
    try {
      const promesas = sucursales.map(s =>
        api.put(`/api/articulos/${articulo.id}/sucursal/${s.id}`, {
          habilitado: estadoPorSucursal[s.id].habilitado,
          stock_ideal: estadoPorSucursal[s.id].stock_ideal,
        })
      )
      await Promise.all(promesas)
      onUpdate()
      onClose()
    } catch (err) {
      console.error('Error al guardar:', err)
      alert('Error al guardar los cambios')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-100">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-800 truncate">{articulo.nombre}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Código: {articulo.codigo}</p>
            {(articulo.rubro || articulo.marca) && (
              <div className="flex gap-2 mt-1 flex-wrap">
                {articulo.rubro && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{articulo.rubro}</span>
                )}
                {articulo.marca && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{articulo.marca}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lista de sucursales */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sucursales</h3>
          {sucursales.map(s => {
            const estado = estadoPorSucursal[s.id]
            return (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 gap-2">
                <span className="text-sm text-gray-700 min-w-0 truncate">{s.nombre}</span>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Stock ideal (solo si habilitado) */}
                  {estado.habilitado && (
                    <input
                      type="number"
                      min="0"
                      value={estado.stock_ideal}
                      onChange={e => cambiarStock(s.id, e.target.value)}
                      className="w-14 text-center text-sm border border-gray-300 rounded py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      title="Stock ideal"
                    />
                  )}

                  {/* Toggle */}
                  <button
                    onClick={() => toggleHabilitado(s.id)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                      estado.habilitado ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        estado.habilitado ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Botones */}
        <div className="flex gap-3 p-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ArticuloModal
