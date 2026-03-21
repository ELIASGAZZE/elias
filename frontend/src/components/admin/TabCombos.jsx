import React, { useState, useEffect, useMemo } from 'react'
import api from '../../services/api'

const formatPrecio = (p) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(p || 0)

const TabCombos = () => {
  const [combos, setCombos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [toggling, setToggling] = useState(null) // id del combo que se está toggling

  useEffect(() => { cargarCombos() }, [])

  const cargarCombos = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/articulos/combos-erp')
      setCombos(data.combos || [])
    } catch (err) {
      console.error('Error al cargar combos:', err)
    } finally {
      setCargando(false)
    }
  }

  const toggleCombo = async (combo) => {
    setToggling(combo.id)
    try {
      await api.post('/api/articulos/combos-toggle', {
        id: combo.id,
        habilitado: !combo.habilitado,
      })
      setCombos(prev => prev.map(c =>
        c.id === combo.id ? { ...c, habilitado: !c.habilitado } : c
      ))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al actualizar combo')
    } finally {
      setToggling(null)
    }
  }

  const combosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return combos
    const q = busqueda.toLowerCase()
    return combos.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.codigo || '').toLowerCase().includes(q)
    )
  }, [combos, busqueda])

  const habilitados = combos.filter(c => c.habilitado).length

  if (cargando) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-gray-500">
          {habilitados} habilitado{habilitados !== 1 ? 's' : ''} de {combos.length} combos
        </span>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {combos.length > 5 && (
          <div className="p-3 border-b border-gray-100">
            <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar combo..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
        )}

        {combos.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">
            No hay combos sincronizados. Se cargarán automáticamente en la próxima sincronización de artículos.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
            {combosFiltrados.map(combo => (
              <div key={combo.id} className={`flex items-center gap-3 px-4 py-3 ${combo.habilitado ? 'bg-green-50/50' : 'hover:bg-gray-50'}`}>
                <button
                  onClick={() => toggleCombo(combo)}
                  disabled={toggling === combo.id}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    combo.habilitado ? 'bg-green-500' : 'bg-gray-300'
                  } ${toggling === combo.id ? 'opacity-50' : ''}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    combo.habilitado ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{combo.nombre}</p>
                  <div className="flex gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{combo.codigo}</span>
                    {combo.rubro && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{combo.rubro}</span>}
                  </div>
                </div>
                <span className="text-sm text-gray-600">{formatPrecio(combo.precio)}</span>
              </div>
            ))}
            {combosFiltrados.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-6">Sin resultados</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TabCombos
