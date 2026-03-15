// Config admin: CRUD tareas + subtareas + config por sucursal
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

const TareasAdmin = () => {
  const navigate = useNavigate()
  const [tareas, setTareas] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)

  // Estado para tarea seleccionada/editando
  const [tareaActiva, setTareaActiva] = useState(null)
  const [configs, setConfigs] = useState([])
  const [cargandoConfigs, setCargandoConfigs] = useState(false)

  // Modales
  const [mostrarFormTarea, setMostrarFormTarea] = useState(false)
  const [mostrarFormConfig, setMostrarFormConfig] = useState(false)
  const [editandoTarea, setEditandoTarea] = useState(null)
  const [editandoConfig, setEditandoConfig] = useState(null)

  // Form tarea
  const [formNombre, setFormNombre] = useState('')
  const [formDescripcion, setFormDescripcion] = useState('')
  const [formEnlace, setFormEnlace] = useState('')
  const [formSubtareas, setFormSubtareas] = useState([])
  const [formChecklist, setFormChecklist] = useState('')

  // Form config
  const [cfgSucursalId, setCfgSucursalId] = useState('')
  const [cfgTipo, setCfgTipo] = useState('frecuencia') // 'dia_fijo' o 'frecuencia'
  const [cfgFrecuencia, setCfgFrecuencia] = useState(7)
  const [cfgDiasSemana, setCfgDiasSemana] = useState([]) // para dia_fijo: ['martes','jueves']
  const [cfgReprogramar, setCfgReprogramar] = useState(true)
  const [cfgFechaInicio, setCfgFechaInicio] = useState(new Date().toISOString().split('T')[0])

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    cargarDatos()
  }, [])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const [tareasRes, sucRes] = await Promise.all([
        api.get('/api/tareas'),
        api.get('/api/sucursales'),
      ])
      setTareas(tareasRes.data)
      setSucursales(sucRes.data)
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setCargando(false)
    }
  }

  const seleccionarTarea = async (tarea) => {
    setTareaActiva(tarea)
    setCargandoConfigs(true)
    try {
      const { data } = await api.get(`/api/tareas/${tarea.id}/config`)
      setConfigs(data)
    } catch (err) {
      console.error('Error cargando configs:', err)
    } finally {
      setCargandoConfigs(false)
    }
  }

  // ── Tarea CRUD ──────────────────────────────────────────────────────────────

  const abrirFormTarea = (tarea = null) => {
    setEditandoTarea(tarea)
    setFormNombre(tarea?.nombre || '')
    setFormDescripcion(tarea?.descripcion || '')
    setFormEnlace(tarea?.enlace_manual || '')
    setFormChecklist(tarea?.checklist_imprimible || '')
    setFormSubtareas(tarea?.subtareas?.filter(s => s.activo).map(s => s.nombre) || [''])
    setMostrarFormTarea(true)
    setError('')
  }

  const guardarTarea = async () => {
    if (!formNombre.trim()) { setError('Nombre requerido'); return }
    setGuardando(true)
    setError('')
    try {
      if (editandoTarea) {
        await api.put(`/api/tareas/${editandoTarea.id}`, {
          nombre: formNombre,
          descripcion: formDescripcion,
          enlace_manual: formEnlace,
          checklist_imprimible: formChecklist,
        })
        // Actualizar subtareas: borrar las que ya no están, crear las nuevas
        const existentes = editandoTarea.subtareas || []
        const nuevas = formSubtareas.filter(n => n.trim())

        // Eliminar subtareas que se quitaron
        for (const sub of existentes) {
          if (!nuevas.includes(sub.nombre)) {
            await api.delete(`/api/tareas/subtareas/${sub.id}`)
          }
        }
        // Crear subtareas nuevas
        const existentesNombres = existentes.map(s => s.nombre)
        for (let i = 0; i < nuevas.length; i++) {
          if (!existentesNombres.includes(nuevas[i])) {
            await api.post(`/api/tareas/${editandoTarea.id}/subtareas`, {
              nombre: nuevas[i],
              orden: i,
            })
          }
        }
      } else {
        await api.post('/api/tareas', {
          nombre: formNombre,
          descripcion: formDescripcion,
          enlace_manual: formEnlace,
          checklist_imprimible: formChecklist,
          subtareas: formSubtareas.filter(n => n.trim()).map((n, i) => ({ nombre: n, orden: i })),
        })
      }
      setMostrarFormTarea(false)
      cargarDatos()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const eliminarTarea = async (id) => {
    if (!confirm('Eliminar esta tarea y toda su configuración?')) return
    try {
      await api.delete(`/api/tareas/${id}`)
      if (tareaActiva?.id === id) { setTareaActiva(null); setConfigs([]) }
      cargarDatos()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  const toggleActivoTarea = async (tarea) => {
    try {
      await api.put(`/api/tareas/${tarea.id}`, { activo: !tarea.activo })
      cargarDatos()
    } catch (err) {
      alert('Error al cambiar estado')
    }
  }

  // ── Config CRUD ─────────────────────────────────────────────────────────────

  const abrirFormConfig = (config = null) => {
    setEditandoConfig(config)
    setCfgSucursalId(config?.sucursal?.id || config?.sucursal_id || '')
    setCfgTipo(config?.tipo || 'frecuencia')
    setCfgFrecuencia(config?.frecuencia_dias || 7)
    setCfgDiasSemana(config?.dias_semana || [])
    setCfgReprogramar(config?.reprogramar_siguiente !== false)
    setCfgFechaInicio(config?.fecha_inicio || new Date().toISOString().split('T')[0])
    setMostrarFormConfig(true)
    setError('')
  }

  const toggleDiaSemana = (dia) => {
    setCfgDiasSemana(prev =>
      prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia]
    )
  }

  const guardarConfig = async () => {
    if (!cfgSucursalId) { setError('Seleccione sucursal'); return }
    if (cfgTipo === 'dia_fijo' && cfgDiasSemana.length === 0) {
      setError('Seleccione al menos un día de la semana'); return
    }
    setGuardando(true)
    setError('')
    try {
      const body = {
        sucursal_id: cfgSucursalId,
        tipo: cfgTipo,
        frecuencia_dias: cfgFrecuencia,
        dias_semana: cfgTipo === 'dia_fijo' ? cfgDiasSemana : null,
        reprogramar_siguiente: cfgReprogramar,
        fecha_inicio: cfgFechaInicio,
      }
      if (editandoConfig) {
        await api.put(`/api/tareas/config/${editandoConfig.id}`, body)
      } else {
        await api.post(`/api/tareas/${tareaActiva.id}/config`, body)
      }
      setMostrarFormConfig(false)
      seleccionarTarea(tareaActiva)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const eliminarConfig = async (id) => {
    if (!confirm('Eliminar esta configuración de sucursal?')) return
    try {
      await api.delete(`/api/tareas/config/${id}`)
      seleccionarTarea(tareaActiva)
    } catch (err) {
      alert('Error al eliminar')
    }
  }

  // ── Imprimir checklist para comandera 80mm ─────────────────────────────────

  const imprimirChecklist = (tarea) => {
    const items = (tarea.checklist_imprimible || '').split('\n').filter(l => l.trim())
    if (items.length === 0) return alert('Esta tarea no tiene checklist cargado')

    const fecha = new Date().toLocaleDateString('es-AR')
    const win = window.open('', '_blank', 'width=320,height=600')
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; padding: 4mm; }
  h1 { font-size: 14px; text-align: center; border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 6px; }
  .fecha { text-align: center; font-size: 10px; margin-bottom: 8px; }
  .item { display: flex; align-items: flex-start; gap: 4px; margin-bottom: 6px; line-height: 1.3; }
  .check { flex-shrink: 0; width: 14px; height: 14px; border: 1.5px solid #000; margin-top: 1px; }
  .texto { flex: 1; }
  .firma { margin-top: 16px; border-top: 1px dashed #000; padding-top: 8px; }
  .linea { border-bottom: 1px solid #000; height: 20px; margin-top: 12px; }
  .label { font-size: 10px; margin-top: 2px; }
  @media print { body { width: 72mm; } }
</style></head><body>
  <h1>${tarea.nombre}</h1>
  <div class="fecha">${fecha}</div>
  ${items.map(item => `<div class="item"><div class="check"></div><div class="texto">${item.replace(/^\d+[\).\-]\s*/, '')}</div></div>`).join('')}
  <div class="firma">
    <div class="linea"></div>
    <div class="label">Responsable</div>
    <div class="linea"></div>
    <div class="label">Observaciones</div>
  </div>
  <script>window.onload=()=>{window.print()}<\/script>
</body></html>`)
    win.document.close()
  }

  // ── Asignar tarea a TODAS las sucursales ──────────────────────────────────

  const asignarTodasSucursales = async () => {
    if (!tareaActiva) return
    if (!confirm(`Asignar "${tareaActiva.nombre}" a TODAS las sucursales?`)) return

    setGuardando(true)
    try {
      const sucursalesNoConfiguradas = sucursales.filter(
        s => !configs.some(c => (c.sucursal?.id || c.sucursal_id) === s.id)
      )
      if (sucursalesNoConfiguradas.length === 0) {
        alert('Ya está asignada a todas las sucursales')
        return
      }
      for (const suc of sucursalesNoConfiguradas) {
        await api.post(`/api/tareas/${tareaActiva.id}/config`, {
          sucursal_id: suc.id,
          tipo: cfgTipo,
          frecuencia_dias: cfgFrecuencia || 7,
          dias_semana: cfgTipo === 'dia_fijo' ? cfgDiasSemana : null,
          reprogramar_siguiente: cfgReprogramar,
          fecha_inicio: cfgFechaInicio,
        })
      }
      seleccionarTarea(tareaActiva)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al asignar')
    } finally {
      setGuardando(false)
    }
  }

  // ── Subtareas form helpers ──────────────────────────────────────────────────

  const addSubtarea = () => setFormSubtareas(prev => [...prev, ''])
  const removeSubtarea = (i) => setFormSubtareas(prev => prev.filter((_, idx) => idx !== i))
  const updateSubtarea = (i, val) => setFormSubtareas(prev => prev.map((s, idx) => idx === i ? val : s))

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas - Configuración" sinTabs volverA="/tareas" />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-800">Tareas globales</h2>
          <button
            onClick={() => abrirFormTarea()}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
          >
            + Nueva tarea
          </button>
        </div>

        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Lista de tareas */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Tareas</h3>
              <div className="space-y-2">
                {tareas.map(tarea => (
                  <div
                    key={tarea.id}
                    className={`bg-white rounded-lg border p-3 cursor-pointer transition-all ${
                      tareaActiva?.id === tarea.id ? 'border-orange-400 ring-2 ring-orange-100' : 'border-gray-200 hover:border-gray-300'
                    } ${!tarea.activo ? 'opacity-50' : ''}`}
                    onClick={() => seleccionarTarea(tarea)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{tarea.nombre}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {tarea.subtareas && tarea.subtareas.filter(s => s.activo).length > 0 && (
                            <span className="text-xs text-gray-400">
                              {tarea.subtareas.filter(s => s.activo).length} subtareas
                            </span>
                          )}
                          {tarea.checklist_imprimible && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">checklist</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => toggleActivoTarea(tarea)}
                          className={`text-xs px-2 py-1 rounded ${tarea.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          {tarea.activo ? 'Activa' : 'Inactiva'}
                        </button>
                        <button onClick={() => abrirFormTarea(tarea)} className="p-1 text-gray-400 hover:text-gray-600">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                        </button>
                        <button onClick={() => eliminarTarea(tarea.id)} className="p-1 text-gray-400 hover:text-red-600">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {tareas.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No hay tareas creadas</p>
                )}
              </div>
            </div>

            {/* Detalle: config por sucursal */}
            <div>
              {tareaActiva ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                      Config: {tareaActiva.nombre}
                    </h3>
                    <div className="flex gap-1">
                      {tareaActiva.checklist_imprimible && (
                        <button
                          onClick={() => imprimirChecklist(tareaActiva)}
                          className="text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium"
                          title="Imprimir checklist para comandera 80mm"
                        >
                          Imprimir
                        </button>
                      )}
                      <button
                        onClick={asignarTodasSucursales}
                        disabled={guardando}
                        className="text-sm px-3 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium disabled:opacity-50"
                      >
                        + Todas
                      </button>
                      <button
                        onClick={() => abrirFormConfig()}
                        className="text-sm px-3 py-1 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors font-medium"
                      >
                        + Sucursal
                      </button>
                    </div>
                  </div>

                  {cargandoConfigs ? (
                    <p className="text-sm text-gray-400 py-4">Cargando...</p>
                  ) : configs.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Sin sucursales configuradas</p>
                  ) : (
                    <div className="space-y-2">
                      {configs.map(cfg => (
                        <div key={cfg.id} className="bg-white rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-800">{cfg.sucursal?.nombre}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {cfg.tipo === 'dia_fijo' ? (
                                  <>
                                    {(cfg.dias_semana || []).map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}
                                    {' · '}
                                    {cfg.frecuencia_dias === 7 ? 'Semanal' : cfg.frecuencia_dias === 14 ? 'Cada 2 sem' : cfg.frecuencia_dias === 21 ? 'Cada 3 sem' : 'Mensual'}
                                  </>
                                ) : (
                                  <>Cada {cfg.frecuencia_dias} días</>
                                )}
                                {cfg.reprogramar_siguiente ? ' · reprograma' : ' · no reprograma'}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => abrirFormConfig(cfg)} className="p-1 text-gray-400 hover:text-gray-600">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                                </svg>
                              </button>
                              <button onClick={() => eliminarConfig(cfg.id)} className="p-1 text-gray-400 hover:text-red-600">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Subtareas de la tarea activa */}
                  {tareaActiva.subtareas && tareaActiva.subtareas.filter(s => s.activo).length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Subtareas</h4>
                      <div className="space-y-1">
                        {tareaActiva.subtareas.filter(s => s.activo).sort((a, b) => a.orden - b.orden).map(sub => (
                          <div key={sub.id} className="text-sm text-gray-600 bg-white rounded px-3 py-1.5 border border-gray-100">
                            {sub.orden + 1}. {sub.nombre}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-400 text-center py-12">Seleccione una tarea para ver su configuración</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal crear/editar tarea */}
      {mostrarFormTarea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">
                {editandoTarea ? 'Editar tarea' : 'Nueva tarea'}
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                <input
                  value={formNombre}
                  onChange={e => setFormNombre(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  placeholder="Ej: Limpieza general"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                <textarea
                  value={formDescripcion}
                  onChange={e => setFormDescripcion(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Enlace a manual</label>
                <input
                  value={formEnlace}
                  onChange={e => setFormEnlace(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Checklist imprimible (comandera 80mm)</label>
                <textarea
                  value={formChecklist}
                  onChange={e => setFormChecklist(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 font-mono"
                  placeholder={"Ej:\n1) Limpiar piso\n2) Limpiar vidrios\n3) Desinfectar mesadas"}
                />
                <p className="text-xs text-gray-400 mt-1">Un item por linea. Se imprime como checklist con casillas.</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Subtareas</label>
                  <button onClick={addSubtarea} className="text-xs text-orange-600 hover:text-orange-800 font-medium">
                    + Agregar
                  </button>
                </div>
                <div className="space-y-2">
                  {formSubtareas.map((sub, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={sub}
                        onChange={e => updateSubtarea(i, e.target.value)}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        placeholder={`Subtarea ${i + 1}`}
                      />
                      <button onClick={() => removeSubtarea(i)} className="text-gray-400 hover:text-red-500">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3">
              <button onClick={() => setMostrarFormTarea(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={guardarTarea} disabled={guardando} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear/editar config */}
      {mostrarFormConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">
                {editandoConfig ? 'Editar configuración' : 'Asignar a sucursal'}
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal *</label>
                <select
                  value={cfgSucursalId}
                  onChange={e => setCfgSucursalId(e.target.value)}
                  disabled={!!editandoConfig}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="">Seleccionar...</option>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Tipo de tarea */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de programación *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setCfgTipo('dia_fijo'); setCfgFrecuencia(7) }}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      cfgTipo === 'dia_fijo'
                        ? 'border-orange-400 bg-orange-50 text-orange-700 ring-2 ring-orange-100'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Día fijo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCfgTipo('frecuencia'); setCfgFrecuencia(7); setCfgDiasSemana([]) }}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      cfgTipo === 'frecuencia'
                        ? 'border-orange-400 bg-orange-50 text-orange-700 ring-2 ring-orange-100'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Frecuencia fija
                  </button>
                </div>
              </div>

              {cfgTipo === 'dia_fijo' ? (
                <>
                  {/* Días de la semana */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Días de la semana *</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DIAS.map(d => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDiaSemana(d)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            cfgDiasSemana.includes(d)
                              ? 'bg-orange-500 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {d.charAt(0).toUpperCase() + d.slice(1, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Período */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Frecuencia</label>
                    <select
                      value={cfgFrecuencia}
                      onChange={e => setCfgFrecuencia(parseInt(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value={7}>Cada 1 semana</option>
                      <option value={14}>Cada 2 semanas</option>
                      <option value={21}>Cada 3 semanas</option>
                      <option value={30}>1 vez al mes</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {/* Frecuencia en días */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cada cuántos días</label>
                    <input
                      type="number"
                      min={1}
                      value={cfgFrecuencia}
                      onChange={e => setCfgFrecuencia(parseInt(e.target.value) || 1)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    />
                  </div>
                </>
              )}

              {/* Fecha de inicio (siempre visible) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {cfgTipo === 'frecuencia' ? 'Día de inicio (primera aparición)' : 'Fecha de inicio'}
                </label>
                <input
                  type="date"
                  value={cfgFechaInicio}
                  onChange={e => setCfgFechaInicio(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfgReprogramar}
                  onChange={e => setCfgReprogramar(e.target.checked)}
                  className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                <span className="text-sm text-gray-700">Reprogramar si no se confirma</span>
              </label>
              <p className="text-xs text-gray-400 -mt-2 ml-6">
                {cfgReprogramar
                  ? 'Si no se completa, aparece al día siguiente hasta que se confirme'
                  : 'Si no se completa, se marca como incumplida y no reaparece'}
              </p>

              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3">
              <button onClick={() => setMostrarFormConfig(false)} className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={guardarConfig} disabled={guardando} className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TareasAdmin
