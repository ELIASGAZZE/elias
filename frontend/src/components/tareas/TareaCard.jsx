// Card de tarea pendiente con badge a tiempo/atrasada
import React from 'react'

const TareaCard = ({ tarea, onCompletar }) => {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-800 truncate">{tarea.nombre}</h3>
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
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>Programada: {formatFecha(tarea.fecha_programada)}</span>
            <span>Cada {tarea.frecuencia_dias} días</span>
            {tarea.dia_preferencia && <span>({tarea.dia_preferencia})</span>}
          </div>
          {tarea.subtareas && tarea.subtareas.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {tarea.subtareas.length} subtarea{tarea.subtareas.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => onCompletar(tarea)}
          className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors whitespace-nowrap"
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
