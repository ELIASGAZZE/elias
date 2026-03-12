// Configuración de permisos por rol
// Estructura: { "pedidos": true, "cajas": ["lista", "cierre"], ... }
// true = todas las secciones, array = secciones específicas, ausente = sin acceso
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const APPS_Y_SECCIONES = [
  {
    id: 'pedidos',
    nombre: 'Pedidos Internos',
    secciones: [
      { id: 'nuevo', nombre: 'Nuevo Pedido' },
      { id: 'lista', nombre: 'Pedidos' },
    ]
  },
  {
    id: 'cajas',
    nombre: 'Control de Cajas',
    secciones: [
      { id: 'lista', nombre: 'Cierres' },
      { id: 'cierre', nombre: 'Cerrar caja' },
      { id: 'verificar', nombre: 'Verificar cierre' },
      { id: 'retiro', nombre: 'Retiros' },
      { id: 'chat', nombre: 'Chat auditoría' },
      { id: 'batch', nombre: 'Análisis batch' },
    ]
  },
  {
    id: 'pos',
    nombre: 'Punto de Venta',
    secciones: null,
  },
  {
    id: 'cajas-pos',
    nombre: 'Control Caja POS',
    secciones: [
      { id: 'lista', nombre: 'Cierres' },
      { id: 'cierre', nombre: 'Cerrar caja' },
      { id: 'verificar', nombre: 'Verificar cierre' },
      { id: 'retiro', nombre: 'Retiros' },
    ]
  },
  {
    id: 'ventas',
    nombre: 'Ventas',
    secciones: null,
  },
  {
    id: 'tareas',
    nombre: 'Tareas',
    secciones: null,
  },
  {
    id: 'auditoria',
    nombre: 'Auditoría POS',
    secciones: null,
  },
  {
    id: 'api',
    nombre: 'API',
    secciones: null,
  },
  {
    id: 'configuracion',
    nombre: 'Configuración',
    secciones: null,
  },
]

const ROLES = [
  { id: 'operario', nombre: 'Operario', color: 'bg-gray-100 text-gray-700' },
  { id: 'gestor', nombre: 'Gestor', color: 'bg-blue-50 text-blue-700' },
]

const ConfiguracionPermisos = () => {
  const navigate = useNavigate()
  const [rolSeleccionado, setRolSeleccionado] = useState('operario')
  const [permisosEditando, setPermisosEditando] = useState({})
  const [permisosCargados, setPermisosCargados] = useState({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    cargarPermisos()
  }, [])

  useEffect(() => {
    // Cuando cambia el rol seleccionado, cargar sus permisos
    setPermisosEditando(permisosCargados[rolSeleccionado] || {})
    setMensaje('')
  }, [rolSeleccionado, permisosCargados])

  const cargarPermisos = async () => {
    try {
      const { data } = await api.get('/api/auth/permisos-rol')
      const map = {}
      data.forEach(item => { map[item.rol] = item.permisos || {} })
      setPermisosCargados(map)
    } catch (err) {
      console.error('Error cargando permisos:', err)
    } finally {
      setCargando(false)
    }
  }

  // ¿La app está habilitada?
  const appHabilitada = (appId) => {
    return permisosEditando[appId] !== undefined
  }

  // ¿La sección está habilitada? (solo si la app tiene array de secciones)
  const seccionHabilitada = (appId, seccionId) => {
    const val = permisosEditando[appId]
    if (val === true) return true
    if (Array.isArray(val)) return val.includes(seccionId)
    return false
  }

  // Toggle app completa
  const toggleApp = (appId) => {
    setPermisosEditando(prev => {
      const nuevo = { ...prev }
      if (nuevo[appId] !== undefined) {
        delete nuevo[appId]
      } else {
        nuevo[appId] = true
      }
      return nuevo
    })
  }

  // Toggle sección individual
  const toggleSeccion = (appId, seccionId, todasLasSecciones) => {
    setPermisosEditando(prev => {
      const nuevo = { ...prev }
      let actual = nuevo[appId]

      // Si la app está en true (todas), convertir a array con todas menos esta
      if (actual === true) {
        const todas = todasLasSecciones.map(s => s.id)
        actual = todas.filter(id => id !== seccionId)
      } else if (Array.isArray(actual)) {
        if (actual.includes(seccionId)) {
          actual = actual.filter(id => id !== seccionId)
        } else {
          actual = [...actual, seccionId]
        }
        // Si tiene todas las secciones, convertir a true
        if (actual.length === todasLasSecciones.length) {
          actual = true
        }
      } else {
        // App no habilitada, habilitar solo esta sección
        actual = [seccionId]
      }

      // Si el array queda vacío, eliminar la app
      if (Array.isArray(actual) && actual.length === 0) {
        delete nuevo[appId]
      } else {
        nuevo[appId] = actual
      }

      return nuevo
    })
  }

  const guardarPermisos = async () => {
    setGuardando(true)
    setMensaje('')
    try {
      await api.put(`/api/auth/permisos-rol/${rolSeleccionado}`, { permisos: permisosEditando })
      setPermisosCargados(prev => ({ ...prev, [rolSeleccionado]: permisosEditando }))
      setMensaje('ok:Permisos guardados. Los usuarios deben reloguearse para ver los cambios.')
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al guardar permisos')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Permisos por Rol" sinTabs />

      <div className="px-4 pt-3">
        <button
          onClick={() => navigate('/admin/configuracion')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Volver a configuración
        </button>
      </div>

      <div className="px-4 py-4 max-w-3xl mx-auto">
        {/* Selector de rol */}
        <div className="flex gap-2 mb-4">
          {ROLES.map(rol => (
            <button
              key={rol.id}
              onClick={() => setRolSeleccionado(rol.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                rolSeleccionado === rol.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {rol.nombre}
            </button>
          ))}
        </div>

        {cargando ? (
          <div className="text-center text-gray-400 py-8">Cargando...</div>
        ) : (
          <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700">
                Permisos del rol: <span className="text-blue-600">{ROLES.find(r => r.id === rolSeleccionado)?.nombre}</span>
              </h3>
              <p className="text-xs text-gray-400 mt-1">Seleccioná las apps y secciones que este rol puede ver</p>
            </div>

            <div className="divide-y divide-gray-50">
              {APPS_Y_SECCIONES.map(app => {
                const habilitada = appHabilitada(app.id)

                return (
                  <div key={app.id} className="px-4 py-3">
                    {/* App toggle */}
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={habilitada}
                        onChange={() => toggleApp(app.id)}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className={`text-sm font-medium ${habilitada ? 'text-gray-800' : 'text-gray-400'}`}>
                        {app.nombre}
                      </span>
                    </label>

                    {/* Secciones (si la app las tiene y está habilitada) */}
                    {app.secciones && habilitada && (
                      <div className="ml-7 mt-2 space-y-1">
                        {app.secciones.map(sec => (
                          <label key={sec.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                            <input
                              type="checkbox"
                              checked={seccionHabilitada(app.id, sec.id)}
                              onChange={() => toggleSeccion(app.id, sec.id, app.secciones)}
                              className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <span className={`text-xs ${seccionHabilitada(app.id, sec.id) ? 'text-gray-700' : 'text-gray-400'}`}>
                              {sec.nombre}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="p-4 border-t border-gray-100">
              <button
                onClick={guardarPermisos}
                disabled={guardando}
                className="w-full btn-primario"
              >
                {guardando ? 'Guardando...' : 'Guardar permisos'}
              </button>
              {mensaje && (
                <p className={`text-sm mt-2 text-center ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                  {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ConfiguracionPermisos
