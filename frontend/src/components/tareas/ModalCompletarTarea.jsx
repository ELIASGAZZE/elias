// Modal para completar una tarea: seleccionar empleados, subtareas, observaciones
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

function diasDesde(fecha) {
  if (!fecha) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const f = new Date(fecha)
  f.setHours(0, 0, 0, 0)
  return Math.floor((hoy - f) / (1000 * 60 * 60 * 24))
}

const ModalCompletarTarea = ({ tarea, onClose, onCompletada }) => {
  const [empleados, setEmpleados] = useState([])
  const [empleadosSeleccionados, setEmpleadosSeleccionados] = useState([])
  const [subtareasState, setSubtareasState] = useState({})
  const [observaciones, setObservaciones] = useState('')
  const [calificacion, setCalificacion] = useState(0)
  const [hoverStar, setHoverStar] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Cargar empleados con recomendación (días desde última ejecución de esta tarea)
    api.get(`/api/tareas/recomendacion/${tarea.tarea_config_id}`)
      .then(r => setEmpleados(r.data))
      .catch(() => {
        // Fallback: cargar empleados sin recomendación
        api.get('/api/empleados?empresa=zaatar')
          .then(r => setEmpleados(r.data))
          .catch(() => {})
      })

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
    if (calificacion === 0) {
      setError('Seleccione un puntaje para la tarea')
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
        calificacion,
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(prev => !prev)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <span className={empleadosSeleccionados.length > 0 ? 'text-gray-700' : 'text-gray-400'}>
                  {empleadosSeleccionados.length > 0
                    ? `${empleadosSeleccionados.length} empleado${empleadosSeleccionados.length > 1 ? 's' : ''} seleccionado${empleadosSeleccionados.length > 1 ? 's' : ''}`
                    : 'Seleccionar empleados...'}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {empleados.length > 0 && empleados[0].dias_desde !== undefined && (
                    <div className="px-3 py-1.5 bg-orange-50 border-b border-orange-100">
                      <p className="text-xs text-orange-600 font-medium flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        Recomendado: quien hace más tiempo no la realiza
                      </p>
                    </div>
                  )}
                  {empleados.map((emp, idx) => {
                    const esRecomendado = idx === 0 && emp.dias_desde !== undefined
                    return (
                      <label
                        key={emp.id}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
                          esRecomendado ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-orange-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={empleadosSeleccionados.includes(emp.id)}
                          onChange={() => toggleEmpleado(emp.id)}
                          className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        />
                        <span className={`text-sm flex-1 ${esRecomendado ? 'text-orange-700 font-medium' : 'text-gray-700'}`}>
                          {emp.nombre}
                          {esRecomendado && ' ★'}
                        </span>
                        {emp.dias_desde !== undefined && (
                          <span className={`text-xs whitespace-nowrap ${
                            emp.dias_desde === null ? 'text-red-500 font-medium' :
                            emp.dias_desde === 0 ? 'text-green-500' :
                            emp.dias_desde >= 7 ? 'text-red-500 font-medium' :
                            'text-gray-400'
                          }`}>
                            {emp.dias_desde === null ? 'Nunca' :
                             emp.dias_desde === 0 ? 'Hoy' :
                             emp.dias_desde === 1 ? 'Hace 1 día' :
                             `Hace ${emp.dias_desde} días`}
                          </span>
                        )}
                      </label>
                    )
                  })}
                  {empleados.length === 0 && (
                    <p className="text-sm text-gray-400 px-3 py-2">No hay empleados cargados</p>
                  )}
                </div>
              )}
            </div>
            {empleadosSeleccionados.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {empleadosSeleccionados.map(id => {
                  const emp = empleados.find(e => e.id === id)
                  return emp ? (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                      {emp.nombre}
                      <button type="button" onClick={() => toggleEmpleado(id)} className="hover:text-orange-900">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ) : null
                })}
              </div>
            )}
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
                    <span className={`text-sm flex-1 ${subtareasState[sub.id] ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                      {sub.nombre}
                    </span>
                    {(() => {
                      const dias = diasDesde(sub.ultima_ejecucion)
                      const umbral = sub.frecuencia_promedio || tarea.frecuencia_dias || 7
                      const urgente = dias !== null && dias >= umbral
                      if (dias === null) return (
                        <span className="text-xs text-red-500 font-medium whitespace-nowrap">
                          🔥 Nunca realizada
                        </span>
                      )
                      if (dias === 0) return (
                        <span className="text-xs text-green-500 whitespace-nowrap">Hoy</span>
                      )
                      return (
                        <span className={`text-xs font-medium whitespace-nowrap ${urgente ? 'text-red-500' : 'text-gray-400'}`}>
                          {urgente && '🔥 '}{dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`}
                        </span>
                      )
                    })()}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Calificación */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ¿Qué puntaje le das al resultado de la tarea realizada? *
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setCalificacion(star)}
                  onMouseEnter={() => setHoverStar(star)}
                  onMouseLeave={() => setHoverStar(0)}
                  className="p-0.5 transition-transform hover:scale-110"
                >
                  <svg
                    className={`w-8 h-8 ${
                      star <= (hoverStar || calificacion)
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-gray-300 fill-gray-300'
                    } transition-colors`}
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>
              ))}
              {calificacion > 0 && (
                <span className="ml-2 text-sm text-gray-500">
                  {calificacion === 1 ? 'Muy mal' : calificacion === 2 ? 'Mal' : calificacion === 3 ? 'Regular' : calificacion === 4 ? 'Bien' : 'Excelente'}
                </span>
              )}
            </div>
          </div>

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
