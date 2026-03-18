// Tab Feriados — CRUD + importar nacionales
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TabFeriados = () => {
  const [feriados, setFeriados] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ fecha: '', descripcion: '', tipo: 'empresa' })
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    try {
      const { data } = await api.get('/api/feriados', { params: { anio } })
      setFeriados(data)
    } catch (err) {
      console.error('Error:', err)
    }
  }

  useEffect(() => { cargar() }, [anio])

  const crear = async () => {
    setCargando(true)
    try {
      await api.post('/api/feriados', form)
      setShowForm(false)
      setForm({ fecha: '', descripcion: '', tipo: 'empresa' })
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setCargando(false)
    }
  }

  const importar = async () => {
    setCargando(true)
    try {
      const { data } = await api.post('/api/feriados/importar', { anio })
      alert(`Importados: ${data.insertados} nuevos, ${data.existentes} ya existían`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setCargando(false)
    }
  }

  const eliminar = async (id) => {
    if (!confirm('Eliminar este feriado?')) return
    try {
      await api.delete(`/api/feriados/${id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-800">Feriados {anio}</h3>
          <div className="flex gap-1">
            <button onClick={() => setAnio(a => a - 1)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">←</button>
            <button onClick={() => setAnio(a => a + 1)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">→</button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={importar}
            disabled={cargando}
            className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            Importar nacionales {anio}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
          >
            + Agregar
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <input
              placeholder="Descripción"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="empresa">Empresa</option>
              <option value="nacional">Nacional</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={crear} disabled={!form.fecha || !form.descripcion || cargando} className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Crear
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 px-4 py-1.5 rounded-lg hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="divide-y divide-gray-100">
          {feriados.length === 0 ? (
            <p className="px-4 py-6 text-gray-400 text-center text-sm">Sin feriados cargados para {anio}</p>
          ) : (
            feriados.map(f => {
              const fecha = new Date(f.fecha + 'T12:00:00')
              const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
              return (
                <div key={f.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500 w-24">
                      {diasNombre[fecha.getDay()]} {fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{f.descripcion}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      f.tipo === 'nacional' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {f.tipo}
                    </span>
                  </div>
                  <button onClick={() => eliminar(f.id)} className="text-xs text-gray-300 hover:text-red-500">
                    Eliminar
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default TabFeriados
