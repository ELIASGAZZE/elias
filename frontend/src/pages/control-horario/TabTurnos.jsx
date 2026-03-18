// Tab Turnos — CRUD de turnos + grilla de asignaciones
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const TabTurnos = () => {
  const [turnos, setTurnos] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ nombre: '', hora_entrada: '08:00', hora_salida: '16:00', tolerancia_entrada_min: 10, tolerancia_salida_min: 10 })
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    try {
      const [t, a, e] = await Promise.all([
        api.get('/api/turnos'),
        api.get('/api/turnos/asignaciones'),
        api.get('/api/empleados'),
      ])
      setTurnos(t.data)
      setAsignaciones(a.data)
      setEmpleados(e.data)
    } catch (err) {
      console.error('Error:', err)
    }
  }

  useEffect(() => { cargar() }, [])

  const guardarTurno = async () => {
    setCargando(true)
    try {
      if (editando) {
        await api.put(`/api/turnos/${editando}`, form)
      } else {
        await api.post('/api/turnos', form)
      }
      setShowForm(false)
      setEditando(null)
      setForm({ nombre: '', hora_entrada: '08:00', hora_salida: '16:00', tolerancia_entrada_min: 10, tolerancia_salida_min: 10 })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setCargando(false)
    }
  }

  const eliminarTurno = async (id) => {
    if (!confirm('Eliminar este turno?')) return
    try {
      await api.delete(`/api/turnos/${id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  const asignar = async (empleado_id, dia_semana, turno_id) => {
    // Buscar asignación existente
    const existente = asignaciones.find(a => a.empleado_id === empleado_id && a.dia_semana === dia_semana)

    try {
      if (existente && !turno_id) {
        // Eliminar asignación
        await api.delete(`/api/turnos/asignaciones/${existente.id}`)
      } else if (existente) {
        // Actualizar
        await api.put(`/api/turnos/asignaciones/${existente.id}`, { turno_id })
      } else if (turno_id) {
        // Crear nueva
        await api.post('/api/turnos/asignaciones', { empleado_id, turno_id, dia_semana })
      }
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al asignar')
    }
  }

  const getAsignacion = (empleado_id, dia) => {
    return asignaciones.find(a => a.empleado_id === empleado_id && a.dia_semana === dia)
  }

  return (
    <div>
      {/* Sección turnos */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Turnos</h3>
        <button
          onClick={() => { setShowForm(true); setEditando(null); setForm({ nombre: '', hora_entrada: '08:00', hora_salida: '16:00', tolerancia_entrada_min: 10, tolerancia_salida_min: 10 }) }}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
        >
          + Nuevo turno
        </button>
      </div>

      {/* Form turno */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <input
              placeholder="Nombre"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="time"
              value={form.hora_entrada}
              onChange={(e) => setForm({ ...form, hora_entrada: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="time"
              value={form.hora_salida}
              onChange={(e) => setForm({ ...form, hora_salida: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Tolerancia entrada (min)"
              value={form.tolerancia_entrada_min}
              onChange={(e) => setForm({ ...form, tolerancia_entrada_min: parseInt(e.target.value) || 0 })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Tolerancia salida (min)"
              value={form.tolerancia_salida_min}
              onChange={(e) => setForm({ ...form, tolerancia_salida_min: parseInt(e.target.value) || 0 })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={guardarTurno} disabled={!form.nombre || cargando} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {cargando ? 'Guardando...' : editando ? 'Guardar' : 'Crear'}
            </button>
            <button onClick={() => { setShowForm(false); setEditando(null) }} className="text-sm text-gray-500 px-4 py-1.5 rounded-lg hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista turnos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {turnos.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-800">{t.nombre}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => { setEditando(t.id); setForm(t); setShowForm(true) }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Editar
                </button>
                <button onClick={() => eliminarTurno(t.id)} className="text-xs text-red-500 hover:underline">
                  Eliminar
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-500">{t.hora_entrada} — {t.hora_salida}</p>
            <p className="text-xs text-gray-400 mt-1">Tolerancia: ±{t.tolerancia_entrada_min}min entrada, ±{t.tolerancia_salida_min}min salida</p>
          </div>
        ))}
      </div>

      {/* Grilla de asignaciones */}
      <h3 className="font-semibold text-gray-800 mb-3">Asignaciones por día</h3>
      {turnos.length === 0 ? (
        <p className="text-gray-400 text-sm">Creá al menos un turno para empezar a asignar</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Empleado</th>
                {DIAS.map((d, i) => (
                  <th key={i} className="text-center px-2 py-2 text-gray-500 font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empleados.map(emp => (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{emp.nombre}</td>
                  {DIAS.map((_, dia) => {
                    const asig = getAsignacion(emp.id, dia)
                    return (
                      <td key={dia} className="px-1 py-1 text-center">
                        <select
                          value={asig?.turno_id || ''}
                          onChange={(e) => asignar(emp.id, dia, e.target.value || null)}
                          className={`w-full text-xs rounded px-1 py-1 border ${
                            asig ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'
                          }`}
                        >
                          <option value="">—</option>
                          {turnos.map(t => (
                            <option key={t.id} value={t.id}>{t.nombre}</option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default TabTurnos
