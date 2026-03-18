// Tab Licencias — CRUD de licencias y ausencias
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TIPOS = [
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'enfermedad', label: 'Enfermedad' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'estudio', label: 'Estudio' },
  { value: 'mudanza', label: 'Mudanza' },
  { value: 'matrimonio', label: 'Matrimonio' },
  { value: 'otro', label: 'Otro' },
]

const ESTADOS = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' }
const COLORES_ESTADO = {
  pendiente: 'bg-yellow-100 text-yellow-700',
  aprobada: 'bg-green-100 text-green-700',
  rechazada: 'bg-red-100 text-red-700',
}

const TabLicencias = () => {
  const [licencias, setLicencias] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ empleado_id: '', tipo: 'vacaciones', fecha_desde: '', fecha_hasta: '', observaciones: '' })
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    try {
      const [l, e] = await Promise.all([
        api.get('/api/licencias'),
        api.get('/api/empleados'),
      ])
      setLicencias(l.data)
      setEmpleados(e.data)
    } catch (err) {
      console.error('Error:', err)
    }
  }

  useEffect(() => { cargar() }, [])

  const crear = async () => {
    setCargando(true)
    try {
      await api.post('/api/licencias', form)
      setShowForm(false)
      setForm({ empleado_id: '', tipo: 'vacaciones', fecha_desde: '', fecha_hasta: '', observaciones: '' })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setCargando(false)
    }
  }

  const cambiarEstado = async (id, estado) => {
    try {
      await api.put(`/api/licencias/${id}`, { estado })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  const eliminar = async (id) => {
    if (!confirm('Eliminar esta licencia?')) return
    try {
      await api.delete(`/api/licencias/${id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  // Separar pendientes y resueltas
  const pendientes = licencias.filter(l => l.estado === 'pendiente')
  const resueltas = licencias.filter(l => l.estado !== 'pendiente')

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Licencias y ausencias</h3>
        <button
          onClick={() => setShowForm(true)}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
        >
          + Nueva licencia
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <select
              value={form.empleado_id}
              onChange={(e) => setForm({ ...form, empleado_id: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Empleado</option>
              {empleados.map(e => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
            <select
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              {TIPOS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              type="date"
              value={form.fecha_desde}
              onChange={(e) => setForm({ ...form, fecha_desde: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Desde"
            />
            <input
              type="date"
              value={form.fecha_hasta}
              onChange={(e) => setForm({ ...form, fecha_hasta: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Hasta"
            />
            <input
              placeholder="Observaciones"
              value={form.observaciones}
              onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm col-span-2"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={crear} disabled={!form.empleado_id || !form.fecha_desde || !form.fecha_hasta || cargando} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {cargando ? 'Guardando...' : 'Crear'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 px-4 py-1.5 rounded-lg hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Pendientes */}
      {pendientes.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-yellow-700 mb-2">Pendientes de aprobación ({pendientes.length})</h4>
          <div className="space-y-2">
            {pendientes.map(l => (
              <div key={l.id} className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-800">{l.empleados?.nombre}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {TIPOS.find(t => t.value === l.tipo)?.label} — {l.fecha_desde} a {l.fecha_hasta}
                  </span>
                  {l.observaciones && <p className="text-xs text-gray-400 mt-0.5">{l.observaciones}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => cambiarEstado(l.id, 'aprobada')} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">
                    Aprobar
                  </button>
                  <button onClick={() => cambiarEstado(l.id, 'rechazada')} className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600">
                    Rechazar
                  </button>
                  <button onClick={() => eliminar(l.id)} className="text-xs text-gray-400 hover:text-red-500">
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historial */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100">
          <h4 className="font-medium text-gray-700 text-sm">Historial</h4>
        </div>
        <div className="divide-y divide-gray-100">
          {resueltas.length === 0 ? (
            <p className="px-4 py-6 text-gray-400 text-center text-sm">Sin licencias registradas</p>
          ) : (
            resueltas.map(l => (
              <div key={l.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-800 text-sm">{l.empleados?.nombre}</span>
                  <span className="text-sm text-gray-500 ml-2">
                    {TIPOS.find(t => t.value === l.tipo)?.label} — {l.fecha_desde} a {l.fecha_hasta}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COLORES_ESTADO[l.estado]}`}>
                    {ESTADOS[l.estado]}
                  </span>
                  <button onClick={() => eliminar(l.id)} className="text-xs text-gray-300 hover:text-red-500">
                    x
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default TabLicencias
