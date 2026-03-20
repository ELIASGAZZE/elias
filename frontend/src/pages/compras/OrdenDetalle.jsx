// Detalle de orden de compra
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const OrdenDetalle = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [items, setItems] = useState([])
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    api.get(`/api/compras/ordenes/${id}`)
      .then(r => {
        setOrden(r.data)
        setItems(r.data.items || [])
        setNotas(r.data.notas || '')
      })
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }, [id])

  const guardar = async () => {
    setGuardando(true)
    try {
      const { data } = await api.put(`/api/compras/ordenes/${id}`, { items, notas })
      setOrden(data)
      setEditando(false)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  const enviar = async () => {
    if (!confirm('Marcar como enviada?')) return
    try {
      const { data } = await api.put(`/api/compras/ordenes/${id}/enviar`)
      setOrden(data)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const cancelar = async () => {
    if (!confirm('Cancelar esta orden?')) return
    try {
      await api.delete(`/api/compras/ordenes/${id}`)
      navigate('/compras/ordenes')
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const actualizarItem = (idx, campo, valor) => {
    setItems(prev => {
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], [campo]: valor }
      if (campo === 'cantidad_final' || campo === 'precio_unitario') {
        const cant = campo === 'cantidad_final' ? Number(valor) : Number(nuevo[idx].cantidad_final || 0)
        const precio = campo === 'precio_unitario' ? Number(valor) : Number(nuevo[idx].precio_unitario || 0)
        nuevo[idx].subtotal = cant * precio
      }
      return nuevo
    })
  }

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Orden" sinTabs volverA="/compras/ordenes" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
      </div>
    </div>
  )

  if (!orden) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Orden" sinTabs volverA="/compras/ordenes" />
      <div className="text-center py-20 text-gray-400">Orden no encontrada</div>
    </div>
  )

  const esBorrador = orden.estado === 'borrador'
  const total = items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={`${orden.numero}`} sinTabs volverA="/compras/ordenes" />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-medium text-gray-800">{orden.numero}</div>
              <div className="text-sm text-gray-500 mt-0.5">
                {orden.proveedores?.nombre || 'Proveedor'}
                <span className="mx-2">—</span>
                {new Date(orden.created_at).toLocaleDateString('es-AR')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-3 py-1 rounded-full ${
                orden.estado === 'borrador' ? 'bg-gray-100 text-gray-600' :
                orden.estado === 'enviada' ? 'bg-blue-100 text-blue-600' :
                orden.estado === 'recibida' ? 'bg-green-100 text-green-600' :
                'bg-red-100 text-red-600'
              }`}>{orden.estado}</span>
            </div>
          </div>

          {esBorrador && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => setEditando(!editando)}
                className="text-sm text-gray-600 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
                {editando ? 'Cancelar edición' : 'Editar'}
              </button>
              <button onClick={enviar}
                className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg">
                Marcar enviada
              </button>
              <button onClick={cancelar}
                className="text-sm text-red-600 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50">
                Cancelar orden
              </button>
            </div>
          )}
        </div>

        {/* Items */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs">
                <th className="text-left px-3 py-2">Artículo</th>
                <th className="text-right px-3 py-2">Sugerido IA</th>
                <th className="text-right px-3 py-2">Cantidad</th>
                <th className="text-center px-3 py-2">Unidad</th>
                <th className="text-right px-3 py-2">Precio</th>
                <th className="text-right px-3 py-2">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{item.nombre || item.codigo}</div>
                    {item.codigo && <div className="text-xs text-gray-400">{item.codigo}</div>}
                  </td>
                  <td className="text-right px-3 py-2 text-gray-400">{item.cantidad_sugerida_ia || '-'}</td>
                  <td className="text-right px-3 py-2">
                    {editando ? (
                      <input type="number" value={item.cantidad_final || ''} onChange={e => actualizarItem(idx, 'cantidad_final', e.target.value)}
                        className="w-20 text-sm text-right border border-gray-200 rounded px-2 py-1" />
                    ) : (
                      <span className="font-medium text-gray-800">{item.cantidad_final || 0}</span>
                    )}
                  </td>
                  <td className="text-center px-3 py-2 text-gray-500">{item.unidad_compra || 'ud'}</td>
                  <td className="text-right px-3 py-2">
                    {editando ? (
                      <input type="number" value={item.precio_unitario || ''} onChange={e => actualizarItem(idx, 'precio_unitario', e.target.value)}
                        className="w-24 text-sm text-right border border-gray-200 rounded px-2 py-1" />
                    ) : (
                      <span className="text-gray-600">${Number(item.precio_unitario || 0).toLocaleString('es-AR')}</span>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 font-medium text-gray-700">${Number(item.subtotal || 0).toLocaleString('es-AR')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td colSpan={5} className="text-right px-3 py-2 text-gray-600">Total</td>
                <td className="text-right px-3 py-2 text-amber-700">${total.toLocaleString('es-AR')}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Notas */}
        {(editando || orden.notas) && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="text-xs text-gray-500">Notas</label>
            {editando ? (
              <textarea value={notas} onChange={e => setNotas(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1" rows={3} />
            ) : (
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{orden.notas}</p>
            )}
          </div>
        )}

        {editando && (
          <div className="flex justify-end">
            <button onClick={guardar} disabled={guardando}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default OrdenDetalle
