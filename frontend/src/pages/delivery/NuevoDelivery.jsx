// Crear nuevo pedido delivery — flujo en 2 pasos: 1) Cliente 2) Artículos
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const NuevoDelivery = () => {
  const navigate = useNavigate()
  const { usuario, esAdmin } = useAuth()

  // Paso actual: 1 = cliente, 2 = artículos
  const [paso, setPaso] = useState(1)

  // ─── Paso 1: Cliente ───
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientes, setClientes] = useState([])
  const [totalClientes, setTotalClientes] = useState(0)
  const [pageClientes, setPageClientes] = useState(1)
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)

  // Formulario nuevo cliente
  const [mostrarFormCliente, setMostrarFormCliente] = useState(false)
  const [nuevoCliente, setNuevoCliente] = useState({
    razon_social: '', cuit: '', direccion: '', localidad: '', telefono: '',
  })
  const [creandoCliente, setCreandoCliente] = useState(false)
  const [errorCliente, setErrorCliente] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  const [msgSync, setMsgSync] = useState('')

  const LIMIT_CLIENTES = 10
  const busquedaTimerRef = useRef(null)

  // ─── Paso 2: Artículos ───
  const [busquedaArt, setBusquedaArt] = useState('')
  const [articulosErp, setArticulosErp] = useState([])
  const [totalArt, setTotalArt] = useState(0)
  const [pageArt, setPageArt] = useState(1)
  const [buscandoArt, setBuscandoArt] = useState(false)
  const [cantidades, setCantidades] = useState({}) // { articulo_id: cantidad }
  const [articulosSeleccionados, setArticulosSeleccionados] = useState([]) // datos completos

  const [direccionEntrega, setDireccionEntrega] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)

  // Sucursal
  const [sucursales, setSucursales] = useState([])
  const [sucursalId, setSucursalId] = useState('')

  const ERP_LIMIT = 20

  // Cargar sucursales al inicio
  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data)
        if (!esAdmin && usuario?.sucursal_id) {
          setSucursalId(usuario.sucursal_id)
        }
      } catch (err) {
        console.error('Error cargando sucursales:', err)
      }
    }
    cargar()
  }, [])

  // ─── Búsqueda de clientes con debounce ───
  useEffect(() => {
    if (busquedaTimerRef.current) clearTimeout(busquedaTimerRef.current)

    busquedaTimerRef.current = setTimeout(() => {
      buscarClientes()
    }, 300)

    return () => {
      if (busquedaTimerRef.current) clearTimeout(busquedaTimerRef.current)
    }
  }, [busquedaCliente, pageClientes])

  const buscarClientes = async () => {
    setBuscandoClientes(true)
    try {
      const params = { page: pageClientes, limit: LIMIT_CLIENTES }
      if (busquedaCliente.trim()) params.buscar = busquedaCliente.trim()

      const { data } = await api.get('/api/clientes', { params })
      setClientes(data.clientes)
      setTotalClientes(data.total)
    } catch (err) {
      console.error('Error buscando clientes:', err)
    } finally {
      setBuscandoClientes(false)
    }
  }

  const handleBusquedaCliente = (valor) => {
    setBusquedaCliente(valor)
    setPageClientes(1)
  }

  // Crear nuevo cliente inline
  const handleCrearCliente = async () => {
    if (!nuevoCliente.razon_social.trim()) {
      setErrorCliente('La razón social es requerida')
      return
    }
    setCreandoCliente(true)
    setErrorCliente('')
    try {
      const { data } = await api.post('/api/clientes', nuevoCliente)
      setClienteSeleccionado(data)
      setDireccionEntrega(data.direccion || '')
      setMostrarFormCliente(false)
      setNuevoCliente({ razon_social: '', cuit: '', direccion: '', localidad: '', telefono: '' })
      setPaso(2)
    } catch (err) {
      setErrorCliente(err.response?.data?.error || 'Error al crear cliente')
    } finally {
      setCreandoCliente(false)
    }
  }

  // Sincronizar clientes desde Centum
  const handleSincronizarCentum = async () => {
    setSincronizando(true)
    setMsgSync('')
    try {
      const { data } = await api.post('/api/clientes/sincronizar-centum')
      setMsgSync(`${data.cantidad} clientes sincronizados`)
      buscarClientes()
    } catch (err) {
      setMsgSync(err.response?.data?.error || 'Error al sincronizar')
    } finally {
      setSincronizando(false)
      setTimeout(() => setMsgSync(''), 4000)
    }
  }

  // Seleccionar cliente existente
  const handleSeleccionarCliente = (cliente) => {
    setClienteSeleccionado(cliente)
    setDireccionEntrega(cliente.direccion || '')
    setPaso(2)
  }

  // ─── Búsqueda de artículos ───
  useEffect(() => {
    if (paso !== 2) return
    cargarArticulos()
  }, [paso, pageArt, busquedaArt])

  const cargarArticulos = async () => {
    setBuscandoArt(true)
    try {
      const params = { page: pageArt, limit: ERP_LIMIT }
      if (busquedaArt.trim()) params.buscar = busquedaArt.trim()

      const { data } = await api.get('/api/articulos/erp', { params })
      setArticulosErp(data.articulos)
      setTotalArt(data.total)
    } catch (err) {
      console.error('Error cargando artículos:', err)
    } finally {
      setBuscandoArt(false)
    }
  }

  const handleBusquedaArt = (valor) => {
    setBusquedaArt(valor)
    setPageArt(1)
  }

  // Actualizar cantidad de un artículo
  const actualizarCantidad = (articuloId, valor) => {
    const cantidad = Math.max(0, parseInt(valor) || 0)
    setCantidades(prev => ({ ...prev, [articuloId]: cantidad }))
  }

  // Mantener artículos seleccionados con datos completos
  useEffect(() => {
    const idsConCantidad = Object.entries(cantidades).filter(([, c]) => c > 0).map(([id]) => id)
    if (idsConCantidad.length === 0) {
      setArticulosSeleccionados([])
      return
    }

    const idsYaCargados = new Set(articulosSeleccionados.map(a => a.id))
    const idsFaltantes = idsConCantidad.filter(id => !idsYaCargados.has(id))
    const seleccionadosFiltrados = articulosSeleccionados.filter(a => cantidades[a.id] > 0)

    if (idsFaltantes.length === 0) {
      if (seleccionadosFiltrados.length !== articulosSeleccionados.length) {
        setArticulosSeleccionados(seleccionadosFiltrados)
      }
      return
    }

    const fetchFaltantes = async () => {
      try {
        const { data } = await api.get('/api/articulos/erp', { params: { ids: idsFaltantes.join(',') } })
        setArticulosSeleccionados([...seleccionadosFiltrados, ...(data.articulos || [])])
      } catch {}
    }
    fetchFaltantes()
  }, [cantidades])

  const totalArticulos = Object.values(cantidades).filter(c => c > 0).length
  const totalPaginasClientes = Math.max(1, Math.ceil(totalClientes / LIMIT_CLIENTES))
  const totalPaginasArt = Math.max(1, Math.ceil(totalArt / ERP_LIMIT))

  // Enviar pedido
  const handleEnviar = async () => {
    const items = Object.entries(cantidades)
      .filter(([, cant]) => cant > 0)
      .map(([articulo_id, cantidad]) => ({ articulo_id, cantidad }))

    if (items.length === 0) {
      setError('Debés agregar al menos un artículo')
      return
    }

    if (!sucursalId) {
      setError('Seleccioná una sucursal')
      return
    }

    setEnviando(true)
    setError('')

    try {
      await api.post('/api/delivery', {
        cliente_id: clienteSeleccionado.id,
        items,
        sucursal_id: sucursalId,
        direccion_entrega: direccionEntrega.trim() || null,
        observaciones: observaciones.trim() || null,
      })
      setExito(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear el pedido')
    } finally {
      setEnviando(false)
    }
  }

  // Pantalla de éxito
  if (exito) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Delivery" sinTabs volverA="/delivery" />
        <div className="flex flex-col items-center justify-center h-[80vh] px-4 text-center">
          <div className="text-6xl mb-4">&#x2705;</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Pedido creado</h2>
          <p className="text-gray-500 mb-6">El pedido delivery fue registrado correctamente</p>
          <button
            onClick={() => {
              setExito(false)
              setPaso(1)
              setClienteSeleccionado(null)
              setCantidades({})
              setArticulosSeleccionados([])
              setDireccionEntrega('')
              setObservaciones('')
              setBusquedaCliente('')
              setBusquedaArt('')
              setError('')
            }}
            className="btn-primario max-w-xs"
          >
            Crear otro pedido
          </button>
          <button
            onClick={() => navigate('/delivery')}
            className="btn-secundario max-w-xs mt-3"
          >
            Ver pedidos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <Navbar titulo="Nuevo Delivery" sinTabs volverA="/delivery" />

      <div className="px-4 py-4 max-w-4xl mx-auto">

        {/* Indicador de pasos */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`flex-1 h-1 rounded-full ${paso >= 1 ? 'bg-amber-600' : 'bg-gray-200'}`} />
          <div className={`flex-1 h-1 rounded-full ${paso >= 2 ? 'bg-amber-600' : 'bg-gray-200'}`} />
        </div>
        <p className="text-xs text-gray-400 mb-4">
          {paso === 1 ? 'Paso 1: Seleccioná un cliente' : 'Paso 2: Cargá los artículos'}
        </p>

        {/* ═══════ PASO 1: CLIENTE ═══════ */}
        {paso === 1 && (
          <>
            {/* Buscador por CUIT/DNI */}
            <div className="mb-3">
              <input
                type="text"
                value={busquedaCliente}
                onChange={(e) => handleBusquedaCliente(e.target.value)}
                placeholder="Buscar por CUIT, DNI o razón social..."
                className="campo-form"
              />
              <p className="text-xs text-gray-400 mt-1">Los clientes se sincronizan desde Centum ERP</p>
            </div>

            {/* Botones: Sync + Crear nuevo */}
            <div className="flex gap-2 mb-4">
              {esAdmin && (
                <button
                  onClick={handleSincronizarCentum}
                  disabled={sincronizando}
                  className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-colors bg-white text-blue-700 border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                >
                  {sincronizando ? 'Sincronizando...' : 'Sincronizar Centum'}
                </button>
              )}
              <button
                onClick={() => setMostrarFormCliente(!mostrarFormCliente)}
                className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-colors bg-white text-amber-700 border-amber-400 hover:bg-amber-50"
              >
                {mostrarFormCliente ? 'Cancelar' : 'Crear nuevo cliente'}
              </button>
            </div>

            {msgSync && (
              <p className={`text-sm mb-3 px-3 py-2 rounded-lg ${
                msgSync.includes('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
              }`}>
                {msgSync}
              </p>
            )}

            {/* Form nuevo cliente inline */}
            {mostrarFormCliente && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
                <h3 className="font-semibold text-gray-700 text-sm">Nuevo cliente</h3>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Razón Social *</label>
                  <input
                    type="text"
                    value={nuevoCliente.razon_social}
                    onChange={(e) => setNuevoCliente(prev => ({ ...prev, razon_social: e.target.value }))}
                    className="campo-form text-sm"
                    placeholder="Nombre o razón social"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">CUIT</label>
                    <input
                      type="text"
                      value={nuevoCliente.cuit}
                      onChange={(e) => setNuevoCliente(prev => ({ ...prev, cuit: e.target.value }))}
                      className="campo-form text-sm"
                      placeholder="XX-XXXXXXXX-X"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Teléfono</label>
                    <input
                      type="text"
                      value={nuevoCliente.telefono}
                      onChange={(e) => setNuevoCliente(prev => ({ ...prev, telefono: e.target.value }))}
                      className="campo-form text-sm"
                      placeholder="341-XXXXXXX"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Dirección</label>
                  <input
                    type="text"
                    value={nuevoCliente.direccion}
                    onChange={(e) => setNuevoCliente(prev => ({ ...prev, direccion: e.target.value }))}
                    className="campo-form text-sm"
                    placeholder="Calle y número"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Localidad</label>
                  <input
                    type="text"
                    value={nuevoCliente.localidad}
                    onChange={(e) => setNuevoCliente(prev => ({ ...prev, localidad: e.target.value }))}
                    className="campo-form text-sm"
                    placeholder="Localidad"
                  />
                </div>

                {errorCliente && (
                  <p className="text-sm text-red-600">{errorCliente}</p>
                )}

                <button
                  onClick={handleCrearCliente}
                  disabled={creandoCliente}
                  className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors text-sm"
                >
                  {creandoCliente ? 'Creando...' : 'Crear y seleccionar'}
                </button>
              </div>
            )}

            {/* Lista de clientes */}
            {buscandoClientes ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
              </div>
            ) : (
              <>
                <p className="text-gray-500 text-sm mb-3">
                  {totalClientes} cliente{totalClientes !== 1 ? 's' : ''} encontrado{totalClientes !== 1 ? 's' : ''}
                </p>

                <div className="space-y-2">
                  {clientes.map(cliente => (
                    <button
                      key={cliente.id}
                      onClick={() => handleSeleccionarCliente(cliente)}
                      className="w-full text-left bg-white border border-gray-200 rounded-xl p-4 hover:border-amber-400 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-800 truncate mr-2">{cliente.razon_social}</p>
                        {cliente.cuit && (
                          <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex-shrink-0">
                            {cliente.cuit}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {cliente.direccion && <span>{cliente.direccion}</span>}
                        {cliente.localidad && <span> · {cliente.localidad}</span>}
                        {cliente.telefono && <span> · Tel: {cliente.telefono}</span>}
                      </div>
                    </button>
                  ))}
                </div>

                {clientes.length === 0 && !busquedaCliente && (
                  <p className="text-center text-gray-400 mt-6 text-sm">
                    No hay clientes cargados. Creá uno nuevo o sincronizá desde Centum.
                  </p>
                )}

                {/* Paginación clientes */}
                {totalClientes > LIMIT_CLIENTES && (
                  <div className="flex items-center justify-between mt-4 gap-2">
                    <button
                      onClick={() => setPageClientes(p => Math.max(1, p - 1))}
                      disabled={pageClientes <= 1}
                      className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-sm text-gray-500">
                      Pág. {pageClientes} de {totalPaginasClientes}
                    </span>
                    <button
                      onClick={() => setPageClientes(p => Math.min(totalPaginasClientes, p + 1))}
                      disabled={pageClientes >= totalPaginasClientes}
                      className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════ PASO 2: ARTÍCULOS ═══════ */}
        {paso === 2 && (
          <>
            {/* Info del cliente seleccionado */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-800">{clienteSeleccionado?.razon_social}</p>
                <p className="text-xs text-amber-600">
                  {clienteSeleccionado?.direccion || 'Sin dirección'}
                  {clienteSeleccionado?.telefono && ` · Tel: ${clienteSeleccionado.telefono}`}
                </p>
              </div>
              <button
                onClick={() => { setPaso(1); setClienteSeleccionado(null) }}
                className="text-xs text-amber-700 underline ml-3 whitespace-nowrap"
              >
                Cambiar
              </button>
            </div>

            {/* Sucursal (solo admin) */}
            {esAdmin && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal</label>
                <select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  className="campo-form"
                >
                  <option value="">Seleccioná una sucursal</option>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Dirección de entrega */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de entrega</label>
              <input
                type="text"
                value={direccionEntrega}
                onChange={(e) => setDireccionEntrega(e.target.value)}
                placeholder="Calle y número de entrega"
                className="campo-form"
              />
            </div>

            {/* Observaciones */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observaciones <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="campo-form text-sm"
                rows={2}
                placeholder="Notas para el pedido..."
              />
            </div>

            {/* Buscador de artículos */}
            <div className="mb-4">
              <input
                type="text"
                value={busquedaArt}
                onChange={(e) => handleBusquedaArt(e.target.value)}
                placeholder="Buscar artículo por nombre o código..."
                className="campo-form"
              />
            </div>

            {buscandoArt ? (
              <div className="flex justify-center items-center h-32">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-600" />
              </div>
            ) : (
              <>
                <p className="text-gray-500 text-sm mb-3">
                  {totalArt} artículo{totalArt !== 1 ? 's' : ''}
                  {totalArticulos > 0 && (
                    <span className="text-amber-600 font-medium"> · {totalArticulos} seleccionado{totalArticulos !== 1 ? 's' : ''}</span>
                  )}
                </p>

                {/* Artículos ya seleccionados */}
                {!busquedaArt && articulosSeleccionados.length > 0 && (
                  <div className="mb-4">
                    <h2 className="text-sm font-bold text-amber-700 bg-amber-50 px-3 py-2 rounded-t-lg uppercase tracking-wide border border-amber-200 border-b-0">
                      En el pedido ({articulosSeleccionados.length})
                    </h2>
                    <div className="space-y-3 py-2 px-1 bg-amber-50/30 border border-amber-200 border-t-0 rounded-b-lg">
                      {articulosSeleccionados
                        .sort((a, b) => a.nombre.localeCompare(b.nombre))
                        .map(articulo => (
                          <ArticuloCardDelivery
                            key={'sel-' + articulo.id}
                            articulo={articulo}
                            cantidad={cantidades[articulo.id] || 0}
                            onChange={(val) => actualizarCantidad(articulo.id, val)}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Lista de artículos ERP */}
                <div className="space-y-3">
                  {articulosErp.map(articulo => (
                    <ArticuloCardDelivery
                      key={articulo.id}
                      articulo={articulo}
                      cantidad={cantidades[articulo.id] || 0}
                      onChange={(val) => actualizarCantidad(articulo.id, val)}
                    />
                  ))}
                </div>

                {articulosErp.length === 0 && (
                  <p className="text-center text-gray-400 mt-10">No se encontraron artículos</p>
                )}

                {/* Paginación artículos */}
                {totalArt > ERP_LIMIT && (
                  <div className="flex items-center justify-between mt-4 gap-2">
                    <button
                      onClick={() => setPageArt(p => Math.max(1, p - 1))}
                      disabled={pageArt <= 1}
                      className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-sm text-gray-500">
                      Pág. {pageArt} de {totalPaginasArt}
                    </span>
                    <button
                      onClick={() => setPageArt(p => Math.min(totalPaginasArt, p + 1))}
                      disabled={pageArt >= totalPaginasArt}
                      className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                    >
                      Siguiente
                    </button>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200 mt-4">
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* Barra inferior fija — solo en paso 2 */}
      {paso === 2 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              {totalArticulos} artículo{totalArticulos !== 1 ? 's' : ''} seleccionado{totalArticulos !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={handleEnviar}
            disabled={enviando || totalArticulos === 0}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors text-sm"
          >
            {enviando ? 'Creando pedido...' : 'Confirmar pedido delivery'}
          </button>
        </div>
      )}
    </div>
  )
}

// Componente de tarjeta de artículo simplificado para delivery
const ArticuloCardDelivery = ({ articulo, cantidad, onChange }) => {
  const tieneUnidades = cantidad > 0

  return (
    <div className={`tarjeta transition-all ${
      tieneUnidades ? 'border-amber-400 bg-amber-50' : ''
    }`}>
      <div className="mb-2">
        <p className="font-medium text-gray-800 truncate">{articulo.nombre}</p>
        <p className="text-xs text-gray-400 mt-0.5">Código: {articulo.codigo}</p>
        {articulo.stock_deposito != null && (
          <p className={`text-xs mt-0.5 font-medium ${
            articulo.stock_deposito > 0 ? 'text-green-600' : 'text-gray-400'
          }`}>
            Stock depósito: {articulo.stock_deposito}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600 font-medium">Cantidad</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(cantidad - 1)}
            className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 text-xl font-bold
                       flex items-center justify-center hover:bg-gray-300 active:bg-gray-400
                       disabled:opacity-30"
            disabled={cantidad <= 0}
          >
            −
          </button>
          <input
            type="number"
            value={cantidad || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            min="0"
            className="w-12 text-center text-lg font-semibold border border-gray-300 rounded-lg py-1
                       focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            onClick={() => onChange(cantidad + 1)}
            className="w-10 h-10 rounded-full bg-amber-600 text-white text-xl font-bold
                       flex items-center justify-center hover:bg-amber-700 active:bg-amber-800"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

export default NuevoDelivery
