import React, { useState, useEffect } from 'react'
import api from '../../services/api'
import { imprimirCanastos, imprimirCanasto } from '../../utils/imprimirCanasto'

const SeccionCanastos = () => {
  const [canastos, setCanastos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [cantidad, setCantidad] = useState(1)
  const [creando, setCreando] = useState(false)

  const cargar = async () => {
    try {
      const { data } = await api.get('/api/traspasos/canastos-registro')
      setCanastos(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const crearCanastos = async () => {
    if (cantidad < 1 || cantidad > 100) return
    setCreando(true)
    try {
      const { data } = await api.post('/api/traspasos/canastos-registro', { cantidad })
      await cargar()
      if (data && data.length > 0 && confirm(`Se crearon ${data.length} canastos. ¿Imprimir etiquetas?`)) {
        imprimirCanastos(data)
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear canastos')
    } finally {
      setCreando(false)
    }
  }

  const toggleEstado = async (canasto) => {
    const nuevoEstado = canasto.estado === 'activo' ? 'baja' : 'activo'
    try {
      await api.put(`/api/traspasos/canastos-registro/${canasto.id}`, { estado: nuevoEstado })
      setCanastos(prev => prev.map(c => c.id === canasto.id ? { ...c, estado: nuevoEstado } : c))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cambiar estado')
    }
  }

  const activos = canastos.filter(c => c.estado === 'activo').length

  return (
    <div className="space-y-6">
      {/* Crear canastos */}
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Cantidad a crear</label>
          <input
            type="number"
            min={1}
            max={100}
            value={cantidad}
            onChange={e => setCantidad(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
          />
        </div>
        <button
          onClick={crearCanastos}
          disabled={creando}
          className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 font-medium"
        >
          {creando ? 'Creando...' : 'Crear canastos'}
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-sm text-gray-500">
        <span>Total: <b className="text-gray-800">{canastos.length}</b></span>
        <span>Activos: <b className="text-emerald-600">{activos}</b></span>
        <span>Baja: <b className="text-red-500">{canastos.length - activos}</b></span>
      </div>

      {/* Lista */}
      {cargando ? (
        <p className="text-gray-400 text-sm">Cargando...</p>
      ) : canastos.length === 0 ? (
        <p className="text-gray-400 text-sm">No hay canastos registrados</p>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Código</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Creado</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {canastos.map(c => (
                <tr key={c.id} className={c.estado === 'baja' ? 'opacity-50' : ''}>
                  <td className="px-4 py-2 font-mono font-bold">{c.codigo}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.estado === 'activo'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-red-100 text-red-600'
                    }`}>
                      {c.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(c.created_at).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <button
                      onClick={() => imprimirCanasto(c)}
                      className="text-cyan-600 hover:text-cyan-800 text-xs font-medium"
                    >
                      Imprimir
                    </button>
                    <button
                      onClick={() => toggleEstado(c)}
                      className={`text-xs font-medium ${
                        c.estado === 'activo'
                          ? 'text-red-500 hover:text-red-700'
                          : 'text-emerald-600 hover:text-emerald-800'
                      }`}
                    >
                      {c.estado === 'activo' ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default SeccionCanastos
