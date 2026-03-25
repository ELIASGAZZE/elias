import React, { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../services/api'

const SeccionGruposDescuento = () => {
  const [grupos, setGrupos] = useState([])
  const [cargando, setCargando] = useState(true)

  // Modal crear/editar
  const [modal, setModal] = useState(null) // null | 'crear' | 'editar'
  const [form, setForm] = useState({ nombre: '', porcentaje: '' })
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState('')

  // Grupo expandido (ver/agregar clientes)
  const [expandido, setExpandido] = useState(null)
  const [tabActivo, setTabActivo] = useState('clientes') // 'clientes' | 'rubros'
  const [clientesGrupo, setClientesGrupo] = useState([])
  const [cargandoClientes, setCargandoClientes] = useState(false)

  // Buscador de clientes
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const timeoutRef = useRef(null)

  // Rubros
  const [rubrosDisponibles, setRubrosDisponibles] = useState([])
  const [rubrosGrupo, setRubrosGrupo] = useState({}) // { rubroNombre: porcentaje }
  const [guardandoRubros, setGuardandoRubros] = useState(false)
  const [rubrosModificados, setRubrosModificados] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/grupos-descuento')
      setGrupos(data.grupos || [])
    } catch (err) {
      console.error('Error cargando grupos:', err)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Cargar rubros disponibles (una sola vez)
  useEffect(() => {
    api.get('/api/pos/rubros').then(({ data }) => {
      setRubrosDisponibles((data.rubros || []).sort((a, b) => a.nombre.localeCompare(b.nombre)))
    }).catch(() => {})
  }, [])

  const abrirCrear = () => {
    setForm({ nombre: '', porcentaje: '' })
    setErrorForm('')
    setModal('crear')
  }

  const abrirEditar = (grupo) => {
    setForm({ id: grupo.id, nombre: grupo.nombre, porcentaje: grupo.porcentaje })
    setErrorForm('')
    setModal('editar')
  }

  const cerrarModal = () => {
    setModal(null)
    setForm({ nombre: '', porcentaje: '' })
    setErrorForm('')
  }

  const guardar = async () => {
    if (!form.nombre?.trim()) {
      setErrorForm('El nombre es requerido')
      return
    }
    const pct = parseFloat(form.porcentaje)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setErrorForm('El porcentaje debe estar entre 0 y 100')
      return
    }
    setGuardando(true)
    setErrorForm('')
    try {
      if (modal === 'crear') {
        await api.post('/api/grupos-descuento', { nombre: form.nombre.trim(), porcentaje: pct })
      } else {
        await api.put(`/api/grupos-descuento/${form.id}`, { nombre: form.nombre.trim(), porcentaje: pct })
      }
      cerrarModal()
      cargar()
    } catch (err) {
      setErrorForm(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  const eliminar = async (grupo) => {
    if (!confirm(`¿Eliminar grupo "${grupo.nombre}"?`)) return
    try {
      await api.delete(`/api/grupos-descuento/${grupo.id}`)
      if (expandido === grupo.id) setExpandido(null)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  // Expandir grupo y cargar clientes + rubros
  const toggleExpandir = async (grupoId) => {
    if (expandido === grupoId) {
      setExpandido(null)
      return
    }
    setExpandido(grupoId)
    setTabActivo('clientes')
    setBusqueda('')
    setResultados([])
    setRubrosModificados(false)
    setCargandoClientes(true)
    try {
      const { data } = await api.get(`/api/grupos-descuento/${grupoId}/clientes`)
      setClientesGrupo(data.clientes || [])
    } catch (err) {
      console.error('Error cargando clientes:', err)
    } finally {
      setCargandoClientes(false)
    }
    // Cargar rubros del grupo
    const grupo = grupos.find(g => g.id === grupoId)
    const map = {}
    for (const r of (grupo?.rubros || [])) {
      map[r.rubro] = r.porcentaje
    }
    setRubrosGrupo(map)
  }

  // Buscar clientes con debounce
  const handleBusqueda = (valor) => {
    setBusqueda(valor)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (valor.trim().length < 2) {
      setResultados([])
      return
    }
    timeoutRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const { data } = await api.get(`/api/grupos-descuento/buscar-clientes/search?q=${encodeURIComponent(valor.trim())}`)
        setResultados(data.clientes || [])
      } catch (err) {
        console.error('Error buscando:', err)
      } finally {
        setBuscando(false)
      }
    }, 300)
  }

  const agregarCliente = async (clienteId) => {
    try {
      const { data } = await api.post(`/api/grupos-descuento/${expandido}/clientes`, { cliente_id: clienteId })
      setClientesGrupo(prev => [...prev, data].sort((a, b) => (a.razon_social || '').localeCompare(b.razon_social || '')))
      setResultados(prev => prev.filter(c => c.id !== clienteId))
      setGrupos(prev => prev.map(g => g.id === expandido ? { ...g, cantidad_clientes: g.cantidad_clientes + 1 } : g))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al agregar cliente')
    }
  }

  const quitarCliente = async (clienteId) => {
    try {
      await api.delete(`/api/grupos-descuento/${expandido}/clientes/${clienteId}`)
      setClientesGrupo(prev => prev.filter(c => c.id !== clienteId))
      setGrupos(prev => prev.map(g => g.id === expandido ? { ...g, cantidad_clientes: Math.max(0, g.cantidad_clientes - 1) } : g))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al quitar cliente')
    }
  }

  // Rubros: cambiar porcentaje
  const setRubroPct = (rubroNombre, valor) => {
    setRubrosGrupo(prev => {
      const next = { ...prev }
      if (valor === '' || valor === null) {
        delete next[rubroNombre]
      } else {
        next[rubroNombre] = valor
      }
      return next
    })
    setRubrosModificados(true)
  }

  const guardarRubros = async () => {
    setGuardandoRubros(true)
    try {
      const rubrosArray = Object.entries(rubrosGrupo).map(([rubro, porcentaje]) => {
        const rubroInfo = rubrosDisponibles.find(r => r.nombre === rubro)
        return { rubro, rubro_id_centum: rubroInfo?.rubro_id_centum || null, porcentaje: parseFloat(porcentaje) || 0 }
      })
      const { data } = await api.post(`/api/grupos-descuento/${expandido}/rubros`, { rubros: rubrosArray })
      // Actualizar grupo en state
      setGrupos(prev => prev.map(g => g.id === expandido ? { ...g, rubros: data.rubros || [] } : g))
      setRubrosModificados(false)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar rubros')
    } finally {
      setGuardandoRubros(false)
    }
  }

  const grupoExpandido = grupos.find(g => g.id === expandido)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          Descuentos porcentuales por rubro, aplicados automáticamente al seleccionar un cliente del grupo en el POS.
        </p>
        <button
          onClick={abrirCrear}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0"
        >
          <span className="text-lg leading-none">+</span> Nuevo grupo
        </button>
      </div>

      <div className="space-y-2">
        {cargando ? (
          <div className="text-center py-8 text-gray-400">Cargando...</div>
        ) : grupos.length === 0 ? (
          <div className="text-center py-8 text-gray-400">No hay grupos de descuento</div>
        ) : grupos.map(g => (
          <div key={g.id} className="border border-gray-200 rounded-xl overflow-hidden">
            {/* Fila del grupo */}
            <div className="flex items-center px-4 py-3 hover:bg-gray-50">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpandir(g.id)}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-gray-800">{g.nombre}</span>
                  <span className="bg-violet-50 text-violet-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    General: {g.porcentaje}%
                  </span>
                  {(g.rubros || []).length > 0 && (
                    <span className="bg-indigo-50 text-indigo-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      {g.rubros.length} rubro{g.rubros.length !== 1 ? 's' : ''} personalizado{g.rubros.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-sm text-gray-500">
                    {g.cantidad_clientes} cliente{g.cantidad_clientes !== 1 ? 's' : ''}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    g.activo ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                  }`}>
                    {g.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => abrirEditar(g)} className="text-gray-400 hover:text-emerald-600 transition-colors" title="Editar">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button onClick={() => eliminar(g)} className="text-gray-400 hover:text-red-500 transition-colors" title="Eliminar">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
                <svg className={`w-4 h-4 text-gray-400 transition-transform cursor-pointer ${expandido === g.id ? 'rotate-90' : ''}`}
                  onClick={() => toggleExpandir(g.id)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>

            {/* Panel expandido */}
            {expandido === g.id && (
              <div className="border-t border-gray-100 bg-gray-50">
                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                  <button
                    onClick={() => setTabActivo('clientes')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      tabActivo === 'clientes'
                        ? 'text-emerald-700 border-b-2 border-emerald-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Clientes ({g.cantidad_clientes})
                  </button>
                  <button
                    onClick={() => setTabActivo('rubros')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      tabActivo === 'rubros'
                        ? 'text-violet-700 border-b-2 border-violet-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Descuentos por rubro
                    {rubrosModificados && <span className="ml-1 text-amber-500">*</span>}
                  </button>
                </div>

                {/* Tab: Clientes */}
                {tabActivo === 'clientes' && (
                  <div className="p-4">
                    {/* Buscador para agregar */}
                    <div className="mb-3">
                      <div className="relative">
                        <input
                          type="text"
                          value={busqueda}
                          onChange={e => handleBusqueda(e.target.value)}
                          placeholder="Buscar cliente por nombre o CUIT para agregar..."
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {buscando && (
                          <div className="absolute right-3 top-2.5">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
                          </div>
                        )}
                      </div>

                      {/* Resultados de búsqueda */}
                      {resultados.length > 0 && (
                        <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm max-h-48 overflow-y-auto divide-y divide-gray-100">
                          {resultados.map(cli => {
                            const yaEnGrupo = cli.grupo_descuento_id === g.id
                            const enOtroGrupo = cli.grupo_descuento_id && cli.grupo_descuento_id !== g.id
                            return (
                              <div key={cli.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                                <div>
                                  <span className="text-sm text-gray-800">{cli.razon_social}</span>
                                  <span className="text-xs text-gray-400 ml-2">{cli.cuit}</span>
                                  {enOtroGrupo && <span className="text-xs text-amber-600 ml-2">(en otro grupo)</span>}
                                </div>
                                {yaEnGrupo ? (
                                  <span className="text-xs text-green-600">Ya en este grupo</span>
                                ) : (
                                  <button
                                    onClick={() => agregarCliente(cli.id)}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded-lg transition-colors"
                                  >
                                    {enOtroGrupo ? 'Mover aquí' : 'Agregar'}
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Lista de clientes asignados */}
                    {cargandoClientes ? (
                      <div className="text-center py-4 text-sm text-gray-400">Cargando clientes...</div>
                    ) : clientesGrupo.length === 0 ? (
                      <div className="text-center py-4 text-sm text-gray-400">No hay clientes en este grupo</div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-gray-500 mb-2">Clientes en el grupo ({clientesGrupo.length}):</p>
                        <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
                          {clientesGrupo.map(cli => (
                            <div key={cli.id} className="flex items-center justify-between px-3 py-2">
                              <div>
                                <span className="text-sm text-gray-800">{cli.razon_social}</span>
                                <span className="text-xs text-gray-400 ml-2">{cli.cuit}</span>
                              </div>
                              <button
                                onClick={() => quitarCliente(cli.id)}
                                className="text-gray-300 hover:text-red-500 transition-colors" title="Quitar del grupo"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab: Rubros */}
                {tabActivo === 'rubros' && (
                  <div className="p-4">
                    <p className="text-xs text-gray-500 mb-3">
                      Asignar un porcentaje distinto por rubro. Los rubros sin porcentaje usan el general ({grupoExpandido?.porcentaje}%).
                    </p>
                    {rubrosDisponibles.length === 0 ? (
                      <div className="text-center py-4 text-sm text-gray-400">Cargando rubros...</div>
                    ) : (
                      <>
                        <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                          {rubrosDisponibles.map(r => {
                            const tieneCustom = rubrosGrupo[r.nombre] !== undefined
                            const valor = tieneCustom ? rubrosGrupo[r.nombre] : ''
                            return (
                              <div key={r.nombre} className="flex items-center justify-between px-3 py-2">
                                <span className={`text-sm ${tieneCustom ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                                  {r.nombre}
                                </span>
                                <div className="flex items-center gap-2">
                                  <div className="relative w-20">
                                    <input
                                      type="number"
                                      value={valor}
                                      onChange={e => setRubroPct(r.nombre, e.target.value === '' ? '' : e.target.value)}
                                      onBlur={e => {
                                        if (e.target.value === '') {
                                          setRubroPct(r.nombre, null)
                                        }
                                      }}
                                      className={`w-full px-2 py-1 border rounded text-sm text-right pr-6 focus:outline-none focus:ring-1 focus:ring-violet-500 ${
                                        tieneCustom ? 'border-violet-300 bg-violet-50' : 'border-gray-200'
                                      }`}
                                      placeholder={String(grupoExpandido?.porcentaje || 0)}
                                      min="0"
                                      max="100"
                                      step="0.1"
                                    />
                                    <span className="absolute right-2 top-1.5 text-gray-400 text-xs">%</span>
                                  </div>
                                  {tieneCustom && (
                                    <button
                                      onClick={() => setRubroPct(r.nombre, null)}
                                      className="text-gray-300 hover:text-red-500 transition-colors"
                                      title="Quitar (usar general)"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-gray-400">
                            {Object.keys(rubrosGrupo).length} rubro{Object.keys(rubrosGrupo).length !== 1 ? 's' : ''} con descuento personalizado
                          </span>
                          <button
                            onClick={guardarRubros}
                            disabled={guardandoRubros || !rubrosModificados}
                            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              rubrosModificados
                                ? 'bg-violet-600 hover:bg-violet-700 text-white'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {guardandoRubros ? 'Guardando...' : 'Guardar rubros'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal Crear/Editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrarModal}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                {modal === 'crear' ? 'Nuevo grupo de descuento' : 'Editar grupo'}
              </h3>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Nombre *</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ej: Mayorista"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Porcentaje general (fallback) *</label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.porcentaje}
                    onChange={e => setForm(f => ({ ...f, porcentaje: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-8"
                    placeholder="Ej: 20"
                    min="0"
                    max="100"
                    step="0.1"
                  />
                  <span className="absolute right-3 top-2.5 text-gray-400 text-sm">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Se usa para rubros que no tengan un porcentaje personalizado.</p>
              </div>

              {errorForm && (
                <p className="text-sm text-red-600">{errorForm}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
              <button
                onClick={cerrarModal}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SeccionGruposDescuento
