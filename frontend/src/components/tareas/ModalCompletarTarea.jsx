// Modal para completar una tarea: seleccionar empleados, subtareas, observaciones
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const ModalCompletarTarea = ({ tarea, onClose, onCompletada }) => {
  const [empleados, setEmpleados] = useState([])
  const [empleadosSeleccionados, setEmpleadosSeleccionados] = useState([])
  const [subtareasState, setSubtareasState] = useState({})
  const [observaciones, setObservaciones] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Cargar empleados de la sucursal
    api.get('/api/empleados')
      .then(r => setEmpleados(r.data))
      .catch(() => {})

    // Inicializar subtareas todas desmarcadas
    if (tarea.subtareas) {
      const initial = {}
      tarea.subtareas.forEach(s => { initial[s.id] = false })
      setSubtareasState(initial)
    }
  }, [tarea])

  const toggleEmpleado = (id) => {
    setEmpleadosSeleccionados(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  const toggleSubtarea = (id) => {
    setSubtareasState(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSubmit = async () => {
    if (empleadosSeleccionados.length === 0) {
      setError('Seleccione al menos un empleado')
      return
    }

    setEnviando(true)
    setError('')

    try {
      const body = {
        tarea_config_id: tarea.tarea_config_id,
        empleados_ids: empleadosSeleccionados,
        subtareas_completadas: tarea.subtareas
          ? tarea.subtareas.map(s => ({
              subtarea_id: s.id,
              completada: !!subtareasState[s.id],
            }))
          : [],
        observaciones,
      }

      await api.post('/api/tareas/ejecutar', body)
      onCompletada()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al completar tarea')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">Completar tarea</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">{tarea.nombre}</p>
        </div>

        <div className="p-5 space-y-5">
          {/* Empleados */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Empleados que realizaron la tarea *
            </label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {empleados.map(emp => (
                <label key={emp.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={empleadosSeleccionados.includes(emp.id)}
                    onChange={() => toggleEmpleado(emp.id)}
                    className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span className="text-sm text-gray-700">{emp.nombre}</span>
                </label>
              ))}
              {empleados.length === 0 && (
                <p className="text-sm text-gray-400">No hay empleados cargados</p>
              )}
            </div>
          </div>

          {/* Subtareas */}
          {tarea.subtareas && tarea.subtareas.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Subtareas
              </label>
              <div className="space-y-1.5">
                {tarea.subtareas.map(sub => (
                  <label key={sub.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!subtareasState[sub.id]}
                      onChange={() => toggleSubtarea(sub.id)}
                      className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className={`text-sm ${subtareasState[sub.id] ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                      {sub.nombre}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Observaciones */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Observaciones (opcional)
            </label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              placeholder="Comentarios sobre la ejecución..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={enviando}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            {enviando ? 'Guardando...' : 'Completar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalCompletarTarea
