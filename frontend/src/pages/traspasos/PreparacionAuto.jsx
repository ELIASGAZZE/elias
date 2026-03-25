// Módulo Preparación — lista órdenes pendientes, el usuario elige cuál preparar
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADO_BADGE = {
  borrador: 'bg-gray-100 text-gray-600',
  en_preparacion: 'bg-amber-100 text-amber-600',
}

const PreparacionAuto = () => {
  const navigate = useNavigate()
  const [ordenes, setOrdenes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [iniciando, setIniciando] = useState(null) // id de la orden que se está iniciando

  const cargar = async () => {
    setCargando(true)
    try {
      const [borradores, enPrep] = await Promise.all([
        api.get('/api/traspasos/ordenes?estado=borrador'),
        api.get('/api/traspasos/ordenes?estado=en_preparacion'),
      ])
      setOrdenes([...(enPrep.data || []), ...(borradores.data || [])])
    } catch (err) {
      console.error('Error cargando órdenes:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const seleccionar = async (orden) => {
    if (orden.estado === 'en_preparacion') {
      navigate(`/traspasos/ordenes/${orden.id}/preparar`)
      return
    }

    // Borrador → iniciar preparación primero
    setIniciando(orden.id)
    try {
      await api.put(`/api/traspasos/ordenes/${orden.id}/iniciar-preparacion`)
      navigate(`/traspasos/ordenes/${orden.id}/preparar`)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al iniciar preparación')
      setIniciando(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Preparación" sinTabs volverA="/apps" />

      <div className="px-3 py-4 space-y-3">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600" />
          </div>
        ) : ordenes.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <div className="bg-emerald-100 text-emerald-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800">No hay órdenes pendientes</h2>
            <p className="text-sm text-gray-500">Todas las órdenes ya están preparadas.</p>
            <button onClick={cargar}
              className="mt-2 bg-sky-600 active:bg-sky-700 text-white px-8 py-3 rounded-xl text-base font-medium">
              Actualizar
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              {ordenes.length} orden{ordenes.length !== 1 ? 'es' : ''} por preparar
            </h2>
            <div className="space-y-2">
              {ordenes.map(o => {
                const itemCount = Array.isArray(o.items) ? o.items.length : 0
                return (
                  <button
                    key={o.id}
                    onClick={() => seleccionar(o)}
                    disabled={iniciando === o.id}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 active:bg-sky-50 active:border-sky-300 transition-all disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800">{o.numero}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[o.estado]}`}>
                            {o.estado === 'en_preparacion' ? 'En preparación' : 'Borrador'}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          {o.sucursal_origen_nombre} → {o.sucursal_destino_nombre}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {new Date(o.created_at).toLocaleDateString('es-AR')} · {itemCount} artículo{itemCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-3">
                        {iniciando === o.id ? (
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sky-600" />
                        ) : (
                          <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default PreparacionAuto
