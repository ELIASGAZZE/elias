import React, { useState, useEffect } from 'react'
import api from '../services/api'

// Extraer nombre de provincia si viene como JSON
function parseProvincia(val) {
  if (!val) return ''
  if (typeof val === 'object') return val.Nombre || ''
  if (typeof val === 'string' && val.startsWith('{')) {
    try { return JSON.parse(val).Nombre || '' } catch { return '' }
  }
  return val
}

const EditarClienteModal = ({ cliente, onClose, onGuardado }) => {
  const [form, setForm] = useState({
    razon_social: cliente?.razon_social || '',
    cuit: cliente?.cuit || '',
    condicion_iva: cliente?.condicion_iva || 'CF',
    direccion: '',
    localidad: '',
    codigo_postal: '',
    provincia: '',
    celular: cliente?.celular || '',
    email: cliente?.email || '',
  })
  const [direcciones, setDirecciones] = useState([])
  const [direccionesOriginales, setDireccionesOriginales] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [clienteId, setClienteId] = useState(null)
  const [consultandoAfip, setConsultandoAfip] = useState(false)
  const [datosAfip, setDatosAfip] = useState(null)

  // Cargar datos completos + direcciones
  useEffect(() => {
    if (!cliente?.id_centum) { setCargando(false); return }

    Promise.all([
      api.get('/api/clientes', { params: { buscar: cliente.cuit || cliente.razon_social, limit: 1 } }),
      api.get(`/api/clientes/por-centum/${cliente.id_centum}/direcciones`),
    ])
      .then(([clienteRes, dirsRes]) => {
        const cli = (clienteRes.data.clientes || []).find(c => c.id_centum === cliente.id_centum)
        if (cli) {
          setClienteId(cli.id)
          setForm({
            razon_social: cli.razon_social || '',
            cuit: cli.cuit || '',
            condicion_iva: cli.condicion_iva || 'CF',
            direccion: cli.direccion || '',
            localidad: cli.localidad || '',
            codigo_postal: cli.codigo_postal || '',
            provincia: parseProvincia(cli.provincia),
            celular: cli.celular || cli.telefono || '',
            email: cli.email || '',
          })
        }
        const dirs = dirsRes.data || []
        setDirecciones(dirs.map(d => ({ ...d })))
        setDireccionesOriginales(dirs.map(d => ({ ...d })))
      })
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [cliente])

  const buscarAfip = async () => {
    const cuitLimpio = form.cuit.replace(/\D/g, '')
    if (cuitLimpio.length < 7) return

    setConsultandoAfip(true)
    setDatosAfip(null)
    try {
      const { data } = await api.get('/api/clientes/buscar-afip', { params: { cuit: cuitLimpio } })
      if (data.encontrado && data.datos) {
        const d = data.datos
        setDatosAfip(d)
        // Aplicar automáticamente los datos encontrados
        const esCuit = cuitLimpio.length === 11
        setForm(prev => ({
          ...prev,
          razon_social: d.razon_social || prev.razon_social,
          // Solo precargar CUIT y condición IVA si ingresó un CUIT (11 dígitos)
          // Si ingresó un DNI, dejar los valores actuales
          ...(esCuit ? {
            cuit: d.cuit || prev.cuit,
            condicion_iva: d.condicion_iva || prev.condicion_iva,
          } : {}),
          ...(d.domicilio ? { direccion: d.domicilio } : {}),
          ...(d.localidad ? { localidad: d.localidad } : {}),
        }))
      } else {
        setDatosAfip('no_encontrado')
      }
    } catch {
      setDatosAfip('error')
    } finally {
      setConsultandoAfip(false)
    }
  }

  const actualizar = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
  }

  const actualizarDireccion = (idx, campo, valor) => {
    setDirecciones(prev => prev.map((d, i) => i === idx ? { ...d, [campo]: valor } : d))
  }

  const agregarDireccion = () => {
    setDirecciones(prev => [{ direccion: '', localidad: '', referencia: '', _nuevo: true }, ...prev])
  }

  const quitarDireccion = (idx) => {
    setDirecciones(prev => prev.filter((_, i) => i !== idx))
  }

  const guardar = async () => {
    if (!form.razon_social.trim()) {
      setError('La razón social es requerida')
      return
    }

    // Validación: RI/MT requieren CUIT (11 dígitos)
    const cuitLimpio = form.cuit.replace(/\D/g, '')
    if ((form.condicion_iva === 'RI' || form.condicion_iva === 'MT') && cuitLimpio.length !== 11) {
      setError('Para Responsable Inscripto o Monotributista, el CUIT debe tener 11 dígitos')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      // 1. Guardar datos del cliente (auto-sync a Centum incluido)
      await api.put(`/api/clientes/${clienteId || cliente.id}`, form)

      // 2. Sincronizar direcciones de entrega
      if (clienteId) {
        const idsOriginales = new Set(direccionesOriginales.map(d => d.id))
        const idsActuales = new Set(direcciones.filter(d => d.id).map(d => d.id))

        // Eliminar las que se quitaron
        for (const orig of direccionesOriginales) {
          if (!idsActuales.has(orig.id)) {
            await api.delete(`/api/clientes/${clienteId}/direcciones/${orig.id}`).catch(() => {})
          }
        }

        // Crear nuevas y actualizar existentes
        for (const dir of direcciones) {
          if (!dir.direccion?.trim()) continue
          if (dir._nuevo || !dir.id) {
            await api.post(`/api/clientes/${clienteId}/direcciones`, {
              direccion: dir.direccion,
              localidad: dir.localidad,
              referencia: dir.referencia,
            }).catch(() => {})
          } else if (idsOriginales.has(dir.id)) {
            const orig = direccionesOriginales.find(o => o.id === dir.id)
            if (orig.direccion !== dir.direccion || orig.localidad !== dir.localidad || orig.referencia !== dir.referencia) {
              await api.put(`/api/clientes/${clienteId}/direcciones/${dir.id}`, {
                direccion: dir.direccion,
                localidad: dir.localidad,
                referencia: dir.referencia,
              }).catch(() => {})
            }
          }
        }
      }

      onGuardado?.({
        ...cliente,
        razon_social: form.razon_social,
        cuit: form.cuit,
        condicion_iva: form.condicion_iva,
        email: form.email,
        celular: form.celular,
      })
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const inputClass = "w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
  const selectAll = e => e.target.select()
  const esCuitRequerido = form.condicion_iva === 'RI' || form.condicion_iva === 'MT'
  const cuitValido = form.cuit.replace(/\D/g, '').length === 11
  const cuitInputClass = `w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400 ${esCuitRequerido && !cuitValido ? 'border-red-300 bg-red-50' : 'border-gray-300'}`

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Editar cliente</h2>
              {cliente?.codigo && (
                <span className="text-xs text-gray-400 font-mono">{cliente.codigo}</span>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {cargando ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
            </div>
          ) : (
            <>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {datosAfip && datosAfip !== 'no_encontrado' && datosAfip !== 'error' && !consultandoAfip && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  Datos prellenados desde ARCA
                  {datosAfip.estado && <span> - Estado: {datosAfip.estado}</span>}
                </div>
              )}

              {datosAfip === 'no_encontrado' && !consultandoAfip && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  No se encontraron datos en ARCA para este CUIT/DNI
                </div>
              )}

              {datosAfip === 'error' && !consultandoAfip && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No se pudo consultar ARCA
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Razón Social *</label>
                <input type="text" value={form.razon_social} onChange={e => actualizar('razon_social', e.target.value)} onFocus={selectAll} className={inputClass} />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  CUIT / DNI {esCuitRequerido && <span className="text-red-500">* (CUIT 11 díg.)</span>}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.cuit}
                    onChange={e => { actualizar('cuit', e.target.value.replace(/\D/g, '').slice(0, 11)); setDatosAfip(null) }}
                    onFocus={selectAll}
                    inputMode="numeric"
                    className={cuitInputClass}
                  />
                  <button
                    type="button"
                    onClick={buscarAfip}
                    disabled={consultandoAfip || form.cuit.replace(/\D/g, '').length < 7}
                    className="flex-shrink-0 text-xs font-medium px-3 py-2 rounded-lg border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {consultandoAfip ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                    ) : 'Buscar ARCA'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Condición IVA</label>
                <select value={form.condicion_iva} onChange={e => actualizar('condicion_iva', e.target.value)} className={inputClass}>
                  <option value="CF">Consumidor Final</option>
                  <option value="RI">Responsable Inscripto</option>
                  <option value="MT">Monotributista</option>
                  <option value="EX">IVA Exento</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Dirección fiscal</label>
                <input type="text" value={form.direccion} onChange={e => actualizar('direccion', e.target.value)} onFocus={selectAll} placeholder="Calle y número" className={inputClass} />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Localidad</label>
                  <input type="text" value={form.localidad} onChange={e => actualizar('localidad', e.target.value)} onFocus={selectAll} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">C.P.</label>
                  <input type="text" value={form.codigo_postal} onChange={e => actualizar('codigo_postal', e.target.value)} onFocus={selectAll} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Provincia</label>
                  <input type="text" value={form.provincia} onChange={e => actualizar('provincia', e.target.value)} onFocus={selectAll} className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Celular</label>
                  <input type="tel" value={form.celular} onChange={e => actualizar('celular', e.target.value)} onFocus={selectAll} placeholder="341-1234567" className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
                  <input type="email" value={form.email} onChange={e => actualizar('email', e.target.value)} onFocus={selectAll} placeholder="correo@ejemplo.com" className={inputClass} />
                </div>
              </div>

              {/* Direcciones de entrega */}
              <div>
                <div className="flex items-center justify-between mb-2 mt-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Direcciones de entrega</label>
                  <button type="button" onClick={agregarDireccion} className="text-xs text-violet-600 hover:text-violet-700 font-medium">
                    + Agregar
                  </button>
                </div>
                {direcciones.length === 0 && (
                  <p className="text-xs text-gray-400 py-2">Sin direcciones de entrega</p>
                )}
                <div className="space-y-2">
                  {direcciones.map((dir, idx) => (
                    <div key={dir.id || `new-${idx}`} className={`rounded-lg p-3 space-y-2 relative ${dir._nuevo ? 'bg-violet-50 border border-violet-200' : 'bg-gray-50'}`}>
                      <button
                        type="button"
                        onClick={() => quitarDireccion(idx)}
                        className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <input
                        type="text"
                        value={dir.direccion || ''}
                        onChange={e => actualizarDireccion(idx, 'direccion', e.target.value)}
                        onFocus={selectAll}
                        placeholder="Dirección *"
                        className={inputClass}
                        autoFocus={dir._nuevo}
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={dir.localidad || ''}
                          onChange={e => actualizarDireccion(idx, 'localidad', e.target.value)}
                          onFocus={selectAll}
                          placeholder="Localidad"
                          className={`flex-1 ${inputClass}`}
                        />
                        <input
                          type="text"
                          value={dir.referencia || ''}
                          onChange={e => actualizarDireccion(idx, 'referencia', e.target.value)}
                          onFocus={selectAll}
                          placeholder="Referencia"
                          className={`flex-1 ${inputClass}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!cargando && (
          <div className="flex gap-3 p-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditarClienteModal
