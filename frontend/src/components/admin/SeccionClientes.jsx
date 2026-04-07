import React, { useState, useEffect, useCallback } from 'react'
import api from '../../services/api'
import ModalAuditoriaCliente from './ModalAuditoriaCliente'

const CONDICIONES_IVA = [
  { value: '', label: 'Todas' },
  { value: 'CF', label: 'Cons. Final' },
  { value: 'RI', label: 'Resp. Inscripto' },
  { value: 'MT', label: 'Monotributo' },
  { value: 'EX', label: 'Exento' },
]

const CONDICIONES_IVA_CREAR = CONDICIONES_IVA.filter(c => c.value)

const LIMIT = 20

const SeccionClientes = () => {
  const [clientes, setClientes] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [buscar, setBuscar] = useState('')
  const [filtroIva, setFiltroIva] = useState('')
  const [cargando, setCargando] = useState(false)

  // Duplicados
  const [duplicados, setDuplicados] = useState(null)
  const [dupExpandido, setDupExpandido] = useState(false)
  const [modalResolver, setModalResolver] = useState(null) // grupo de clientes a resolver
  const [resolviendo, setResolviendo] = useState(false)
  const [winnerSeleccionado, setWinnerSeleccionado] = useState(null)

  // Grupos descuento
  const [gruposDescuento, setGruposDescuento] = useState([])

  // Auditoría
  const [clienteAuditoria, setClienteAuditoria] = useState(null)

  // Modal
  const [modal, setModal] = useState(null) // null | 'crear' | 'editar'
  const [form, setForm] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [errorForm, setErrorForm] = useState('')

  const totalPaginas = Math.ceil(total / LIMIT)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page, limit: LIMIT })
      if (buscar.trim()) params.set('buscar', buscar.trim())
      const { data } = await api.get(`/api/clientes?${params}`)
      let lista = data.clientes || []
      // Filtro IVA local (el backend no lo soporta como query param)
      if (filtroIva) {
        lista = lista.filter(c => c.condicion_iva === filtroIva)
      }
      setClientes(lista)
      setTotal(filtroIva ? lista.length : (data.total || 0))
    } catch (err) {
      console.error('Error cargando clientes:', err)
    } finally {
      setCargando(false)
    }
  }, [page, buscar, filtroIva])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Cargar grupos de descuento
  useEffect(() => {
    api.get('/api/grupos-descuento')
      .then(({ data }) => setGruposDescuento((data.grupos || []).filter(g => g.activo)))
      .catch(err => console.error('Error loading discount groups:', err.message))
  }, [])

  // Verificar duplicados
  const cargarDuplicados = useCallback(() => {
    api.get('/api/clientes/duplicados')
      .then(({ data }) => {
        if (data.total_id_centum > 0 || data.total_cuit > 0) {
          setDuplicados(data)
        } else {
          setDuplicados(null)
        }
      })
      .catch(err => console.error('Error checking duplicates:', err.message))
  }, [])

  useEffect(() => {
    cargarDuplicados()
  }, [cargarDuplicados])

  const abrirResolver = (grupo) => {
    setModalResolver(grupo)
    setWinnerSeleccionado(null)
  }

  const confirmarResolver = async () => {
    if (!winnerSeleccionado || !modalResolver) return
    setResolviendo(true)
    try {
      const loser_ids = modalResolver.filter(c => c.id !== winnerSeleccionado.id).map(c => c.id)
      const { data } = await api.post('/api/clientes/duplicados/resolver', {
        winner_id: winnerSeleccionado.id,
        loser_ids,
      })
      alert(`Resuelto: ${data.losers_desactivados.length} cliente(s) desactivado(s), ${data.ventas_reasignadas} ventas y ${data.pedidos_reasignados} pedidos reasignados.`)
      setModalResolver(null)
      setWinnerSeleccionado(null)
      cargarDuplicados()
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setResolviendo(false)
    }
  }

  // Debounce búsqueda
  const [inputBuscar, setInputBuscar] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setBuscar(inputBuscar)
    }, 400)
    return () => clearTimeout(timer)
  }, [inputBuscar])

  const abrirCrear = () => {
    setForm({ razon_social: '', cuit: '', condicion_iva: 'CF', direccion: '', email: '', celular: '', telefono: '', grupo_descuento_id: '' })
    setErrorForm('')
    setModal('crear')
  }

  const abrirEditar = (cliente) => {
    setForm({
      id: cliente.id,
      id_centum: cliente.id_centum,
      razon_social: cliente.razon_social || '',
      cuit: cliente.cuit || '',
      condicion_iva: cliente.condicion_iva || 'CF',
      direccion: cliente.direccion || '',
      email: cliente.email || '',
      celular: cliente.celular || '',
      telefono: cliente.telefono || '',
      grupo_descuento_id: cliente.grupo_descuento_id || '',
    })
    setErrorForm('')
    setModal('editar')
  }

  const cerrarModal = () => {
    setModal(null)
    setForm({})
    setErrorForm('')
  }

  const guardar = async () => {
    if (!form.razon_social?.trim()) {
      setErrorForm('La razón social es requerida')
      return
    }
    setGuardando(true)
    setErrorForm('')
    try {
      if (modal === 'crear') {
        await api.post('/api/clientes', form)
      } else {
        await api.put(`/api/clientes/${form.id}`, form)
      }
      cerrarModal()
      cargar()
    } catch (err) {
      setErrorForm(err.response?.data?.error || err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      {/* Banner de duplicados */}
      {duplicados && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-red-700">
              Duplicados detectados: {duplicados.total_id_centum} por ID Centum, {duplicados.total_cuit} por CUIT
            </span>
            <button
              onClick={() => setDupExpandido(!dupExpandido)}
              className="text-xs text-red-600 hover:text-red-800 underline"
            >
              {dupExpandido ? 'Ocultar' : 'Ver detalle'}
            </button>
          </div>
          {dupExpandido && (
            <div className="mt-2 text-xs text-red-600 space-y-1.5 max-h-60 overflow-y-auto">
              {duplicados.duplicados_id_centum.map((grupo, i) => (
                <div key={`id-${i}`} className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="font-medium">ID Centum {grupo[0].id_centum}:</span>{' '}
                    {grupo.map(c => `${c.codigo} (${c.razon_social}) [${c.total_ventas || 0}v/${c.total_pedidos || 0}p]`).join(' / ')}
                  </div>
                  <button
                    onClick={() => abrirResolver(grupo)}
                    className="shrink-0 px-2 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
                  >
                    Resolver
                  </button>
                </div>
              ))}
              {duplicados.duplicados_cuit.map((grupo, i) => (
                <div key={`cuit-${i}`} className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="font-medium">CUIT {grupo[0].cuit}:</span>{' '}
                    {grupo.map(c => `${c.codigo} (${c.razon_social}) [${c.total_ventas || 0}v/${c.total_pedidos || 0}p]`).join(' / ')}
                  </div>
                  <button
                    onClick={() => abrirResolver(grupo)}
                    className="shrink-0 px-2 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
                  >
                    Resolver
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Barra de búsqueda y filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Buscar nombre, CUIT, código..."
            value={inputBuscar}
            onChange={e => setInputBuscar(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>
        <select
          value={filtroIva}
          onChange={e => { setFiltroIva(e.target.value); setPage(1) }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {CONDICIONES_IVA.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button
          onClick={abrirCrear}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
        >
          <span className="text-lg leading-none">+</span> Nuevo
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-500">Código</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Razón Social</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">CUIT</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">IVA</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Grupo Desc.</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Cód. Centum</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Origen</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Actualizado</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">Cargando...</td></tr>
            ) : clientes.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">No se encontraron clientes</td></tr>
            ) : clientes.map(c => (
              <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 font-mono text-xs text-gray-600">{c.codigo}</td>
                <td className="py-2 px-3 font-medium text-gray-800">{c.razon_social}</td>
                <td className="py-2 px-3 text-gray-600">{c.cuit || '—'}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    c.condicion_iva === 'RI' ? 'bg-blue-50 text-blue-700' :
                    c.condicion_iva === 'MT' ? 'bg-purple-50 text-purple-700' :
                    c.condicion_iva === 'EX' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {c.condicion_iva || 'CF'}
                  </span>
                </td>
                <td className="py-2 px-3">
                  {c.grupos_descuento ? (
                    <span className="bg-violet-50 text-violet-700 text-xs font-medium px-2 py-0.5 rounded-full">
                      {c.grupos_descuento.nombre} {c.grupos_descuento.porcentaje}%
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  {c.codigo_centum ? (
                    <span className="text-green-600 text-xs font-medium">{c.codigo_centum}</span>
                  ) : c.id_centum ? (
                    <span className="text-yellow-600 text-xs font-medium" title="Sin código Centum">#{c.id_centum}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  {c.id_centum ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Centum</span>
                  ) : (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">POS</span>
                  )}
                </td>
                <td className="py-2 px-3 text-xs text-gray-400">
                  {c.updated_at || c.created_at
                    ? new Date(c.updated_at || c.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    : '—'}
                </td>
                <td className="py-2 px-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => setClienteAuditoria(c)}
                      className="text-gray-400 hover:text-amber-600 transition-colors"
                      title="Auditoría"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => abrirEditar(c)}
                      className="text-gray-400 hover:text-emerald-600 transition-colors"
                      title="Editar"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Anterior
          </button>
          <span>Página {page} de {totalPaginas}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
            disabled={page >= totalPaginas}
            className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Modal Resolver Duplicados */}
      {modalResolver && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setModalResolver(null); setWinnerSeleccionado(null) }}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Resolver duplicados — CUIT {modalResolver[0]?.cuit || 'N/A'}</h3>
              <button onClick={() => { setModalResolver(null); setWinnerSeleccionado(null) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <p className="text-sm text-gray-500">Seleccioná el cliente que querés mantener. Los demás serán desactivados y sus ventas/pedidos reasignados.</p>
              {modalResolver.map(c => {
                const isWinner = winnerSeleccionado?.id === c.id
                return (
                  <div
                    key={c.id}
                    className={`border rounded-xl p-3 transition-all cursor-pointer ${
                      isWinner ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setWinnerSeleccionado(c)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-gray-800">{c.codigo}</span>
                        {c.id_centum && (
                          <span className="bg-green-100 text-green-700 text-xs font-medium px-1.5 py-0.5 rounded">
                            Centum #{c.id_centum}
                          </span>
                        )}
                        {c.codigo_centum && (
                          <span className="bg-blue-100 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded">
                            {c.codigo_centum}
                          </span>
                        )}
                        {!c.id_centum && (
                          <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded">Sin Centum</span>
                        )}
                      </div>
                      {isWinner && (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">Mantener</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-700">{c.razon_social}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-500">
                      <span>IVA: {c.condicion_iva || 'CF'}</span>
                      <span>Ventas: <strong className="text-gray-700">{c.total_ventas || 0}</strong></span>
                      <span>Pedidos: <strong className="text-gray-700">{c.total_pedidos || 0}</strong></span>
                      <span>Creado: {c.created_at ? new Date(c.created_at).toLocaleDateString('es-AR') : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
              <button
                onClick={() => { setModalResolver(null); setWinnerSeleccionado(null) }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarResolver}
                disabled={!winnerSeleccionado || resolviendo}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {resolviendo ? 'Resolviendo...' : `Confirmar — desactivar ${modalResolver.length - (winnerSeleccionado ? 1 : 0)} cliente(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Auditoría */}
      {clienteAuditoria && (
        <ModalAuditoriaCliente
          cliente={clienteAuditoria}
          onClose={() => setClienteAuditoria(null)}
        />
      )}

      {/* Modal Crear/Editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrarModal}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                {modal === 'crear' ? 'Nuevo cliente' : 'Editar cliente'}
              </h3>
              <button onClick={cerrarModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Razón Social *</label>
                <input
                  type="text"
                  value={form.razon_social || ''}
                  onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">CUIT</label>
                <input
                  type="text"
                  value={form.cuit || ''}
                  onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="XX-XXXXXXXX-X"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Condición IVA</label>
                <select
                  value={form.condicion_iva || 'CF'}
                  onChange={e => setForm(f => ({ ...f, condicion_iva: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {CONDICIONES_IVA_CREAR.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              {gruposDescuento.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Grupo de descuento</label>
                  <select
                    value={form.grupo_descuento_id || ''}
                    onChange={e => setForm(f => ({ ...f, grupo_descuento_id: e.target.value || null }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Sin grupo</option>
                    {gruposDescuento.map(g => (
                      <option key={g.id} value={g.id}>{g.nombre} ({g.porcentaje}%)</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Dirección</label>
                <input
                  type="text"
                  value={form.direccion || ''}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Celular</label>
                  <input
                    type="text"
                    value={form.celular || ''}
                    onChange={e => setForm(f => ({ ...f, celular: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Teléfono</label>
                  <input
                    type="text"
                    value={form.telefono || ''}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
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

export default SeccionClientes
