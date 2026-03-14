import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

const AdminDescuentosEmpleados = () => {
  const [rubros, setRubros] = useState([])
  const [descuentos, setDescuentos] = useState({}) // { rubroNombre: porcentaje }
  const [empleados, setEmpleados] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [tab, setTab] = useState('descuentos') // 'descuentos' | 'topes'

  useEffect(() => {
    cargarDatos()
  }, [])

  async function cargarDatos() {
    setCargando(true)
    try {
      const [rubrosRes, descRes, empRes] = await Promise.all([
        api.get('/api/rubros'),
        api.get('/api/cuenta-empleados/descuentos'),
        api.get('/api/cuenta-empleados/topes'),
      ])

      const rubrosData = rubrosRes.data || []
      setRubros(rubrosData)

      // Mapear descuentos existentes
      const descMap = {}
      ;(descRes.data || []).forEach(d => {
        descMap[d.rubro] = d.porcentaje
      })
      setDescuentos(descMap)

      setEmpleados(empRes.data || [])
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setCargando(false)
    }
  }

  const guardarDescuentos = async () => {
    setGuardando(true)
    setMensaje('')
    try {
      const payload = rubros
        .filter(r => descuentos[r.nombre] != null && descuentos[r.nombre] !== '')
        .map(r => ({
          rubro: r.nombre,
          rubro_id_centum: r.id_centum || null,
          porcentaje: parseFloat(descuentos[r.nombre]) || 0,
        }))

      await api.post('/api/cuenta-empleados/descuentos', { descuentos: payload })
      setMensaje('Descuentos guardados')
      setTimeout(() => setMensaje(''), 3000)
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const guardarTope = async (empId, tope) => {
    try {
      await api.put(`/api/cuenta-empleados/topes/${empId}`, {
        tope_mensual: tope === '' ? null : parseFloat(tope),
      })
      setEmpleados(prev => prev.map(e =>
        e.id === empId ? { ...e, tope_mensual: tope === '' ? null : parseFloat(tope) } : e
      ))
    } catch (err) {
      console.error('Error guardando tope:', err)
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  return (
    <div className="pt-4">
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('descuentos')}
          className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === 'descuentos' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Descuentos por rubro
        </button>
        <button
          onClick={() => setTab('topes')}
          className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
            tab === 'topes' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Topes mensuales
        </button>
      </div>

      {/* Tab: Descuentos por rubro */}
      {tab === 'descuentos' && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            Configurá el porcentaje de descuento que se aplica a los empleados por cada rubro de artículos.
          </p>

          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {rubros.map(rubro => (
              <div key={rubro.id || rubro.nombre} className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-700 flex-1 truncate">{rubro.nombre}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={descuentos[rubro.nombre] ?? ''}
                    onChange={e => setDescuentos(prev => ({ ...prev, [rubro.nombre]: e.target.value }))}
                    placeholder="0"
                    className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
              </div>
            ))}
          </div>

          {rubros.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">No hay rubros cargados</p>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={guardarDescuentos}
              disabled={guardando}
              className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {guardando ? 'Guardando...' : 'Guardar descuentos'}
            </button>
            {mensaje && (
              <span className={`text-sm ${mensaje.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {mensaje}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tab: Topes mensuales */}
      {tab === 'topes' && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            Configurá el importe máximo que cada empleado puede retirar por mes. Dejá vacío para sin tope.
          </p>

          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {empleados.map(emp => (
              <div key={emp.id} className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-700 font-medium">{emp.nombre}</span>
                  <span className="text-xs text-gray-400 ml-2">({emp.codigo})</span>
                  {emp.sucursales && <span className="text-xs text-gray-400 ml-2">· {emp.sucursales.nombre}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={emp.tope_mensual ?? ''}
                    onChange={e => setEmpleados(prev =>
                      prev.map(em => em.id === emp.id ? { ...em, tope_mensual: e.target.value === '' ? null : e.target.value } : em)
                    )}
                    onBlur={e => guardarTope(emp.id, e.target.value)}
                    placeholder="Sin tope"
                    className="w-28 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none"
                  />
                </div>
              </div>
            ))}
          </div>

          {empleados.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">No hay empleados activos</p>
          )}
        </div>
      )}
    </div>
  )
}

export default AdminDescuentosEmpleados
