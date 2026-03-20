// Pedidos extraordinarios
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const PedidosExtra = () => {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [form, setForm] = useState({ articulo_nombre: '', cantidad: '', cliente_nombre: '', fecha_necesaria: '', notas: '' })
  const [guardando, setGuardando] = useState(false)

  const cargar = () => {
    setCargando(true)
    api.get('/api/compras/pedidos-extraordinarios')
      .then(r => setPedidos(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [])

  const guardar = async () => {
    if (!form.articulo_nombre || !form.cantidad) return
    setGuardando(true)
    try {
      await api.post('/api/compras/pedidos-extraordinarios', {
        articulo_nombre: form.articulo_nombre,
        cantidad: Number(form.cantidad),
        cliente_nombre: form.cliente_nombre,
        fecha_necesaria: form.fecha_necesaria || null,
        notas: form.notas,
      })
      setForm({ articulo_nombre: '', cantidad: '', cliente_nombre: '', fecha_necesaria: '', notas: '' })
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  const marcarEntregado = async (id) => {
    try {
      await api.put(`/api/compras/pedidos-extraordinarios/${id}`, { estado: 'entregado' })
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Pedidos Especiales" sinTabs volverA="/compras" />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Nuevo pedido extraordinario</h3>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Artículo o producto *" value={form.articulo_nombre} onChange={e => setForm({...form, articulo_nombre: e.target.value})}
              className="col-span-2 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-400" />
            <input type="number" placeholder="Cantidad *" value={form.cantidad} onChange={e => setForm({...form, cantidad: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" step="0.1" />
            <input placeholder="Cliente" value={form.cliente_nombre} onChange={e => setForm({...form, cliente_nombre: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <input type="date" placeholder="Fecha necesaria" value={form.fecha_necesaria} onChange={e => setForm({...form, fecha_necesaria: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <input placeholder="Notas" value={form.notas} onChange={e => setForm({...form, notas: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <button onClick={guardar} disabled={guardando || !form.articulo_nombre || !form.cantidad}
            className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {guardando ? 'Creando...' : 'Crear pedido'}
          </button>
        </div>

        {/* Lista */}
        {cargando ? (
          <div className="text-center py-10 text-gray-400">Cargando...</div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay pedidos extraordinarios</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {pedidos.map(p => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {p.articulo_nombre || p.articulo_id}
                    <span className="ml-2 text-gray-500">×{p.cantidad}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {p.cliente_nombre && <span className="mr-2">{p.cliente_nombre}</span>}
                    {p.fecha_necesaria && <span>Para: {p.fecha_necesaria}</span>}
                  </div>
                  {p.notas && <div className="text-xs text-gray-500 mt-0.5">{p.notas}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.estado === 'pendiente' ? 'bg-yellow-100 text-yellow-600' :
                    p.estado === 'incluido_en_oc' ? 'bg-blue-100 text-blue-600' :
                    'bg-green-100 text-green-600'
                  }`}>{p.estado}</span>
                  {p.estado === 'pendiente' && (
                    <button onClick={() => marcarEntregado(p.id)}
                      className="text-xs text-green-600 hover:text-green-700 px-2 py-1 border border-green-200 rounded">
                      Entregado
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default PedidosExtra
