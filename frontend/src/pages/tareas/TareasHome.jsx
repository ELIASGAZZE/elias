// Vista operario: tareas pendientes hoy
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import TareasNav from '../../components/tareas/TareasNav'
import TareaCard from '../../components/tareas/TareaCard'
import ModalCompletarTarea from '../../components/tareas/ModalCompletarTarea'
import api from '../../services/api'

const TareasHome = () => {
  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [tareaActiva, setTareaActiva] = useState(null)

  const cargar = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/tareas/pendientes')
      setPendientes(data)
    } catch (err) {
      console.error('Error cargando pendientes:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const handleCompletada = () => {
    setTareaActiva(null)
    cargar()
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas" sinTabs />
      <TareasNav />

      <div className="px-6 py-6" style={{ height: 'calc(100vh - 110px)' }}>
        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : pendientes.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500">No hay tareas pendientes</p>
            <p className="text-sm text-gray-400 mt-1">Todas las tareas al dia</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', height: '100%' }}>
            {/* Tareas únicas */}
            <div className="flex flex-col h-full">
              <h2 className="text-lg font-bold text-gray-800 mb-3">
                Tareas unicas
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({pendientes.filter(t => !t.repetitiva).length})
                </span>
              </h2>
              <div className="flex-1 space-y-3 overflow-y-auto">
                {pendientes.filter(t => !t.repetitiva).length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">Sin tareas unicas pendientes</p>
                ) : (
                  pendientes.filter(t => !t.repetitiva).map(tarea => (
                    <TareaCard
                      key={tarea.tarea_config_id}
                      tarea={tarea}
                      onCompletar={setTareaActiva}
                      grande
                    />
                  ))
                )}
              </div>
            </div>

            {/* Tareas repetitivas */}
            <div className="flex flex-col h-full">
              <h2 className="text-lg font-bold text-gray-800 mb-3">
                Tareas repetitivas
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({pendientes.filter(t => t.repetitiva).length})
                </span>
              </h2>
              <div className="flex-1 space-y-3 overflow-y-auto">
                {pendientes.filter(t => t.repetitiva).length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">Sin tareas repetitivas</p>
                ) : (
                  pendientes.filter(t => t.repetitiva).map(tarea => (
                    <TareaCard
                      key={tarea.tarea_config_id}
                      tarea={tarea}
                      onCompletar={setTareaActiva}
                      grande
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {tareaActiva && (
        <ModalCompletarTarea
          tarea={tareaActiva}
          onClose={() => setTareaActiva(null)}
          onCompletada={handleCompletada}
        />
      )}
    </div>
  )
}

export default TareasHome
