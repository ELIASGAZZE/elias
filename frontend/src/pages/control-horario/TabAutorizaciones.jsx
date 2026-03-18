// Tab Autorizaciones — entrada tarde / salida temprana
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TIPOS = [
  { value: 'entrada_tarde', label: 'Entrada tarde' },
  { value: 'salida_temprana', label: 'Salida temprana' },
]

const TabAutorizaciones = () => {
  const [autorizaciones, setAutorizaciones] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ empleado_id: '', fecha: '', tipo: 'entrada_tarde', hora_autorizada: '', motivo: '' })
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    try {
      const [a, e] = await Promise.all([
        api.get('/api/fichajes/autorizaciones'),
        api.get('/api/empleados'),
      ])
      setAutorizaciones(a.data)
      setEmpleados(e.data)
    } catch (err) {
      console.error('Error:', err)
    }
  }

  useEffect(() => { cargar() }, [])

  const crear = async () => {
    setCargando(true)
    try {
      await api.post('/api/fichajes/autorizaciones', form)
      setShowForm(false)
      setForm({ empleado_id: '', fecha: '', tipo: 'entrada_tarde', hora_autorizada: '', motivo: '' })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setCargando(false)
    }
  }

  const eliminar = async (id) => {
    if (!confirm('Eliminar esta autorización?')) return
    try {
      await api.delete(`/api/fichajes/autorizaciones/${id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Autorizaciones</h3>
        <button
          onClick={() => setShowForm(true)}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
        >
          + Nueva autorización
        </button>
      </div>

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
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
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
              type="time"
              value={form.hora_autorizada}
              onChange={(e) => setForm({ ...form, hora_autorizada: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Hora autorizada"
            />
            <input
              placeholder="Motivo"
              value={form.motivo}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm col-span-2"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={crear} disabled={!form.empleado_id || !form.fecha || cargando} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {cargando ? 'Guardando...' : 'Crear'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 px-4 py-1.5 rounded-lg hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {autorizaciones.length === 0 ? (
            <p className="px-4 py-6 text-gray-400 text-center text-sm">Sin autorizaciones registradas</p>
          ) : (
            autorizaciones.map(a => (
              <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-800 text-sm">{a.empleados?.nombre}</span>
                  <span className="text-sm text-gray-500 ml-2">{a.fecha}</span>
                  <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${
                    a.tipo === 'entrada_tarde' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {TIPOS.find(t => t.value === a.tipo)?.label}
                  </span>
                  {a.hora_autorizada && (
                    <span className="text-xs text-gray-400 ml-2">hasta {a.hora_autorizada}</span>
                  )}
                  {a.motivo && <p className="text-xs text-gray-400 mt-0.5">{a.motivo}</p>}
                </div>
                <button onClick={() => eliminar(a.id)} className="text-xs text-gray-300 hover:text-red-500">
                  Eliminar
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default TabAutorizaciones
