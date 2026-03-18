// Panel principal de Control de Horario — /control-horario
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import TabDashboard from './TabDashboard'
import TabCalendario from './TabCalendario'
import TabTurnos from './TabTurnos'
import TabLicencias from './TabLicencias'
import TabFeriados from './TabFeriados'
import TabAutorizaciones from './TabAutorizaciones'
import TabReportes from './TabReportes'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendario', label: 'Calendario' },
  { id: 'turnos', label: 'Turnos' },
  { id: 'licencias', label: 'Licencias' },
  { id: 'feriados', label: 'Feriados' },
  { id: 'autorizaciones', label: 'Autorizaciones' },
  { id: 'reportes', label: 'Reportes' },
]

const ControlHorarioHome = () => {
  const [tab, setTab] = useState('dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/apps" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-bold text-gray-800 text-lg">Control de Horario</h1>
        </div>
        <Link
          to="/fichaje"
          target="_blank"
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Abrir Fichaje
        </Link>
      </nav>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-4 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-4">
        {tab === 'dashboard' && <TabDashboard />}
        {tab === 'calendario' && <TabCalendario />}
        {tab === 'turnos' && <TabTurnos />}
        {tab === 'licencias' && <TabLicencias />}
        {tab === 'feriados' && <TabFeriados />}
        {tab === 'autorizaciones' && <TabAutorizaciones />}
        {tab === 'reportes' && <TabReportes />}
      </div>
    </div>
  )
}

export default ControlHorarioHome
