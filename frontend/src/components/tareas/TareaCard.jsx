// Card de tarea pendiente con badge a tiempo/atrasada
import React from 'react'

const TareaCard = ({ tarea, onCompletar, grande }) => {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${grande ? 'p-6' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`font-semibold text-gray-800 truncate ${grande ? 'text-lg' : ''}`}>{tarea.nombre}</h3>
            {tarea.atrasada ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">
                Atrasada ({tarea.dias_atraso}d)
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
                A tiempo
              </span>
            )}
          </div>
          {tarea.descripcion && (
            <p className="text-sm text-gray-500 mb-2">{tarea.descripcion}</p>
          )}
          <div className={`flex items-center gap-3 text-gray-400 ${grande ? 'text-sm mt-3' : 'text-xs'}`}>
            {tarea.repetitiva ? (
              <>
                <span>{tarea.subtareas.length} subtarea{tarea.subtareas.length > 1 ? 's' : ''}</span>
                {tarea.ejecuciones_hoy > 0 && (
                  <span className="text-orange-600 font-medium">
                    Completada {tarea.ejecuciones_hoy}x hoy
                  </span>
                )}
              </>
            ) : (
              <>
                <span>Programada: {formatFecha(tarea.fecha_programada)}</span>
                {tarea.tipo === 'dia_fijo' ? (
                  <span>
                    {(tarea.dias_semana || []).map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}
                    {' · '}
                    {tarea.frecuencia_dias === 7 ? 'Semanal' : tarea.frecuencia_dias === 14 ? 'Cada 2 sem' : tarea.frecuencia_dias === 21 ? 'Cada 3 sem' : 'Mensual'}
                  </span>
                ) : (
                  <span>Cada {tarea.frecuencia_dias} días</span>
                )}
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => onCompletar(tarea)}
          className={`bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 transition-colors whitespace-nowrap ${grande ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm'}`}
        >
          Completar
        </button>
      </div>
      {tarea.enlace_manual && (
        <a
          href={tarea.enlace_manual}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v7.5A2.25 2.25 0 005.25 18h7.5A2.25 2.25 0 0015 15.75V13.5m-6-3l9-9m0 0h-6m6 0v6" />
          </svg>
          Ver manual
        </a>
      )}
    </div>
  )
}

function formatFecha(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

export default TareaCard
