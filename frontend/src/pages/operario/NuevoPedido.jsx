// Vista principal del operario: crear un nuevo pedido
// Diseño mobile-first con tarjetas táctiles grandes
// Soporta pedidos Regular (artículos habilitados por sucursal) y Extraordinario (todos los artículos ERP)
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const BORRADOR_KEY = 'pedido_borrador'

const guardarBorrador = (sucursalId, cantidades, nombre, tipoPedido) => {
  const hayItems = Object.values(cantidades).some(c => c > 0)
  if (!sucursalId || !hayItems) {
    localStorage.removeItem(BORRADOR_KEY)
    return
  }
  localStorage.setItem(BORRADOR_KEY, JSON.stringify({
    sucursal_id: sucursalId,
    cantidades,
    nombre: nombre || '',
    tipo: tipoPedido || 'regular',
    timestamp: Date.now(),
  }))
}

const leerBorrador = () => {
  try {
    const raw = localStorage.getItem(BORRADOR_KEY)
    if (!raw) return null
    const borrador = JSON.parse(raw)
    // Descartar borradores de más de 24hs
    if (Date.now() - borrador.timestamp > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(BORRADOR_KEY)
      return null
    }
    return borrador
  } catch {
    localStorage.removeItem(BORRADOR_KEY)
    return null
  }
}

const limpiarBorrador = () => localStorage.removeItem(BORRADOR_KEY)

const NuevoPedido = () => {
  const [sucursales, setSucursales] = useState([])
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState('')
  const [tipoPedido, setTipoPedido] = useState('regular')
  const [articulos, setArticulos] = useState([])
  const [cantidades, setCantidades] = useState({}) // { articulo_id: cantidad }
  const [nombrePedido, setNombrePedido] = useState('')
  const [cargando, setCargando] = useState(false)
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)
  const [borradorRecuperado, setBorradorRecuperado] = useState(false)
  const navigate = useNavigate()
  const borradorAplicado = useRef(false)
  const restauracionLista = useRef(false)

  // Estado para flujo extraordinario
  const [articulosErp, setArticulosErp] = useState([])
  const [totalErp, setTotalErp] = useState(0)
  const [paginaErp, setPaginaErp] = useState(1)
  const [busquedaErp, setBusquedaErp] = useState('')
  const [buscandoErp, setBuscandoErp] = useState(false)
  const [articulosSeleccionados, setArticulosSeleccionados] = useState([]) // artículos con cantidad > 0 (datos completos)
  const busquedaTimerRef = useRef(null)
  const ERP_LIMIT = 20

  const [filtroRubro, setFiltroRubro] = useState('')

  const esExtraordinario = tipoPedido === 'extraordinario'

  // Cargamos las sucursales al iniciar
  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data)

        // Restaurar borrador si existe (solo una vez)
        if (!borradorAplicado.current) {
          const borrador = leerBorrador()
          if (borrador) {
            setSucursalSeleccionada(borrador.sucursal_id)
            if (borrador.nombre) setNombrePedido(borrador.nombre)
            if (borrador.tipo) setTipoPedido(borrador.tipo)
            // Las cantidades se aplican después de que carguen los artículos
            borradorAplicado.current = borrador
          } else {
            // No hay borrador, autoguardado puede arrancar ya
            restauracionLista.current = true
          }
        }
      } catch (err) {
        setError('Error al cargar sucursales')
      } finally {
        setCargandoSucursales(false)
      }
    }
    cargar()
  }, [])

  // Cargamos artículos cuando cambia la sucursal (solo flujo regular)
  useEffect(() => {
    if (!sucursalSeleccionada || esExtraordinario) {
      if (!esExtraordinario) setArticulos([])
      return
    }

    const cargarArticulos = async () => {
      setCargando(true)
      setError('')
      try {
        const { data } = await api.get('/api/articulos', {
          params: { sucursal_id: sucursalSeleccionada }
        })
        setArticulos(data)

        // Si hay borrador pendiente para esta sucursal, restaurar cantidades
        const borrador = borradorAplicado.current
        if (borrador && borrador.sucursal_id === sucursalSeleccionada && (!borrador.tipo || borrador.tipo === 'regular')) {
          const idsValidos = new Set(data.map(a => a.id))
          const cantidadesRestauradas = {}
          Object.entries(borrador.cantidades).forEach(([id, cant]) => {
            if (idsValidos.has(id) && cant > 0) {
              cantidadesRestauradas[id] = cant
            }
          })
          if (Object.keys(cantidadesRestauradas).length > 0) {
            setCantidades(cantidadesRestauradas)
            setBorradorRecuperado(true)
          }
          borradorAplicado.current = false
          restauracionLista.current = true
        } else if (!borradorAplicado.current) {
          // Limpiamos cantidades al cambiar de sucursal manualmente
          setCantidades({})
        }
      } catch (err) {
        setError('Error al cargar artículos')
      } finally {
        setCargando(false)
      }
    }
    cargarArticulos()
  }, [sucursalSeleccionada, esExtraordinario])

  // Cargar artículos ERP cuando cambia página, búsqueda o se activa flujo extraordinario
  useEffect(() => {
    if (!sucursalSeleccionada || !esExtraordinario) {
      setArticulosErp([])
      setTotalErp(0)
      return
    }

    const cargarErp = async () => {
      setBuscandoErp(true)
      setError('')
      try {
        const params = { page: paginaErp, limit: ERP_LIMIT }
        if (busquedaErp.trim()) params.buscar = busquedaErp.trim()

        const { data } = await api.get('/api/articulos/erp', { params })
        setArticulosErp(data.articulos)
        setTotalErp(data.total)

        // Restaurar cantidades del borrador extraordinario
        const borrador = borradorAplicado.current
        if (borrador && borrador.tipo === 'extraordinario') {
          const cantidadesRestauradas = {}
          Object.entries(borrador.cantidades).forEach(([id, cant]) => {
            if (cant > 0) cantidadesRestauradas[id] = cant
          })
          if (Object.keys(cantidadesRestauradas).length > 0) {
            setCantidades(cantidadesRestauradas)
            setBorradorRecuperado(true)
          }
          borradorAplicado.current = false
          restauracionLista.current = true
        }
      } catch (err) {
        setError('Error al cargar artículos ERP')
      } finally {
        setBuscandoErp(false)
      }
    }
    cargarErp()
  }, [sucursalSeleccionada, esExtraordinario, paginaErp, busquedaErp])

  // Rubros únicos para el filtro (solo flujo regular)
  const rubrosDisponibles = useMemo(() => {
    if (esExtraordinario) return []
    const set = new Set()
    articulos.forEach(a => set.add(a.rubro || 'Sin rubro'))
    return [...set].sort((a, b) => {
      if (a === 'Sin rubro') return 1
      if (b === 'Sin rubro') return -1
      return a.localeCompare(b)
    })
  }, [articulos, esExtraordinario])

  // Agrupar artículos por rubro -> marca (solo flujo regular)
  const articulosAgrupados = useMemo(() => {
    if (esExtraordinario) return []
    const lista = filtroRubro ? articulos.filter(a => (a.rubro || 'Sin rubro') === filtroRubro) : articulos
    const grupos = {}

    lista.forEach(art => {
      const rubro = art.rubro || 'Sin rubro'
      const marca = art.marca || 'Sin marca'

      if (!grupos[rubro]) grupos[rubro] = {}
      if (!grupos[rubro][marca]) grupos[rubro][marca] = []
      grupos[rubro][marca].push(art)
    })

    // Convertir a array ordenado
    return Object.keys(grupos)
      .sort((a, b) => {
        if (a === 'Sin rubro') return 1
        if (b === 'Sin rubro') return -1
        return a.localeCompare(b)
      })
      .map(rubro => ({
        rubro,
        marcas: Object.keys(grupos[rubro])
          .sort((a, b) => {
            if (a === 'Sin marca') return 1
            if (b === 'Sin marca') return -1
            return a.localeCompare(b)
          })
          .map(marca => ({
            marca,
            articulos: grupos[rubro][marca].sort((a, b) => a.nombre.localeCompare(b.nombre)),
          })),
      }))
  }, [articulos, esExtraordinario, filtroRubro])

  // Cargar datos completos de artículos seleccionados (con cantidad > 0) en flujo extraordinario
  useEffect(() => {
    if (!esExtraordinario) {
      setArticulosSeleccionados([])
      return
    }
    const idsConCantidad = Object.entries(cantidades).filter(([, c]) => c > 0).map(([id]) => id)
    if (idsConCantidad.length === 0) {
      setArticulosSeleccionados([])
      return
    }
    // Solo fetch IDs que no tenemos ya cargados
    const idsYaCargados = new Set(articulosSeleccionados.map(a => a.id))
    const idsFaltantes = idsConCantidad.filter(id => !idsYaCargados.has(id))
    // Limpiar artículos que ya no tienen cantidad
    const seleccionadosFiltrados = articulosSeleccionados.filter(a => cantidades[a.id] > 0)

    if (idsFaltantes.length === 0) {
      // Solo necesitamos filtrar los que ya no tienen cantidad
      if (seleccionadosFiltrados.length !== articulosSeleccionados.length) {
        setArticulosSeleccionados(seleccionadosFiltrados)
      }
      return
    }

    const fetchFaltantes = async () => {
      try {
        const { data } = await api.get('/api/articulos/erp', { params: { ids: idsFaltantes.join(',') } })
        setArticulosSeleccionados([...seleccionadosFiltrados, ...(data.articulos || [])])
      } catch {
        // Si falla, al menos mantenemos los que ya teníamos
      }
    }
    fetchFaltantes()
  }, [cantidades, esExtraordinario])

  // Autoguardar borrador cada vez que cambian cantidades o sucursal
  // No ejecutar hasta que la restauración del borrador previo haya terminado
  useEffect(() => {
    if (!restauracionLista.current) return
    guardarBorrador(sucursalSeleccionada, cantidades, nombrePedido, tipoPedido)
  }, [sucursalSeleccionada, cantidades, nombrePedido, tipoPedido])

  // Actualiza la cantidad de un artículo específico
  const actualizarCantidad = (articuloId, valor) => {
    const cantidad = Math.max(0, parseInt(valor) || 0)
    setCantidades(prev => ({
      ...prev,
      [articuloId]: cantidad,
    }))
  }

  const descartarBorrador = useCallback(() => {
    limpiarBorrador()
    setCantidades({})
    setNombrePedido('')
    setBorradorRecuperado(false)
  }, [])

  // Al cambiar tipo de pedido, limpiar cantidades y estados del otro flujo
  const handleCambiarTipo = (nuevoTipo) => {
    if (nuevoTipo === tipoPedido) return
    setTipoPedido(nuevoTipo)
    setCantidades({})
    setBorradorRecuperado(false)
    setBusquedaErp('')
    setPaginaErp(1)
    setFiltroRubro('')
  }

  // Búsqueda con debounce para flujo extraordinario
  const handleBusquedaErp = (valor) => {
    setBusquedaErp(valor)
    setPaginaErp(1)
  }

  // Cuenta cuántos artículos tienen cantidad > 0
  const totalArticulos = Object.values(cantidades).filter(c => c > 0).length

  const totalPaginasErp = Math.max(1, Math.ceil(totalErp / ERP_LIMIT))

  // Envía el pedido al backend
  const handleEnviar = async () => {
    // Para extraordinario, los items vienen de cantidades directamente (no de articulosErp de la página actual)
    const items = Object.entries(cantidades)
      .filter(([, cant]) => cant > 0)
      .map(([articuloId, cant]) => ({ articulo_id: articuloId, cantidad: cant }))

    if (items.length === 0) {
      setError('Debés agregar al menos un artículo al pedido')
      return
    }

    setEnviando(true)
    setError('')

    try {
      const body = { items, sucursal_id: sucursalSeleccionada, tipo: tipoPedido }
      if (nombrePedido.trim()) body.nombre = nombrePedido.trim()
      await api.post('/api/pedidos', body)
      limpiarBorrador()
      setExito(true)
      setCantidades({})
      setNombrePedido('')
      setBorradorRecuperado(false)
    } catch (err) {
      setError('Error al enviar el pedido. Intentá nuevamente.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoSucursales) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Nuevo Pedido" />
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      </div>
    )
  }

  // Pantalla de éxito
  if (exito) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Nuevo Pedido" />
        <div className="flex flex-col items-center justify-center h-[80vh] px-4 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">¡Pedido enviado!</h2>
          <p className="text-gray-500 mb-6">Tu pedido fue registrado correctamente</p>
          <button
            onClick={() => { limpiarBorrador(); setExito(false); setTipoPedido('regular') }}
            className="btn-primario max-w-xs"
          >
            Hacer otro pedido
          </button>
          <button
            onClick={() => navigate('/pedidos')}
            className="btn-secundario max-w-xs mt-3"
          >
            Ver mis pedidos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <Navbar titulo="Nuevo Pedido" />

      <div className="px-4 py-4">

        {/* Selector de sucursal */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal</label>
          <select
            value={sucursalSeleccionada}
            onChange={(e) => setSucursalSeleccionada(e.target.value)}
            className="campo-form"
          >
            <option value="">Seleccioná una sucursal</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Selector de tipo de pedido */}
        {sucursalSeleccionada && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de pedido</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleCambiarTipo('regular')}
                className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  tipoPedido === 'regular'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Regular
              </button>
              <button
                onClick={() => handleCambiarTipo('extraordinario')}
                className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  tipoPedido === 'extraordinario'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Extraordinario
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {esExtraordinario
                ? 'Todos los artículos del ERP disponibles para pedir'
                : 'Artículos habilitados para la sucursal'}
            </p>
          </div>
        )}

        {/* Nombre del pedido (opcional) */}
        {sucursalSeleccionada && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre del pedido <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={nombrePedido}
              onChange={(e) => setNombrePedido(e.target.value)}
              placeholder="Ej: Pedido picadas"
              className="campo-form"
              maxLength={100}
            />
          </div>
        )}

        {/* Banner de borrador recuperado */}
        {borradorRecuperado && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800">Pedido en curso recuperado</p>
              <p className="text-xs text-amber-600">Se restauraron las cantidades que tenías cargadas</p>
            </div>
            <button
              onClick={descartarBorrador}
              className="text-xs text-amber-700 underline ml-3 whitespace-nowrap"
            >
              Descartar
            </button>
          </div>
        )}

        {!sucursalSeleccionada && (
          <p className="text-center text-gray-400 mt-10">
            Seleccioná una sucursal para ver los artículos
          </p>
        )}

        {/* ───── FLUJO REGULAR ───── */}
        {sucursalSeleccionada && !esExtraordinario && (
          <>
            {cargando && (
              <div className="flex justify-center items-center h-32">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
              </div>
            )}

            {!cargando && (
              <>
                {/* Filtro por rubro */}
                {rubrosDisponibles.length > 1 && (
                  <div className="mb-4">
                    <select
                      value={filtroRubro}
                      onChange={e => setFiltroRubro(e.target.value)}
                      className="campo-form text-sm"
                    >
                      <option value="">Todos los rubros</option>
                      {rubrosDisponibles.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Resumen de artículos en el pedido */}
                {totalArticulos > 0 && (
                  <div className="mb-4">
                    <h2 className="text-sm font-bold text-blue-700 bg-blue-50 px-3 py-2 rounded-t-lg uppercase tracking-wide border border-blue-200 border-b-0">
                      En el pedido ({totalArticulos})
                    </h2>
                    <div className="space-y-3 py-2 px-1 bg-blue-50/30 border border-blue-200 border-t-0 rounded-b-lg">
                      {articulos
                        .filter(a => cantidades[a.id] > 0)
                        .sort((a, b) => a.nombre.localeCompare(b.nombre))
                        .map(articulo => (
                          <ArticuloCard
                            key={'resumen-' + articulo.id}
                            articulo={articulo}
                            cantidad={cantidades[articulo.id] || 0}
                            onChange={(val) => actualizarCantidad(articulo.id, val)}
                            sucursalId={sucursalSeleccionada}
                            mostrarStockIdeal={false}
                          />
                        ))}
                    </div>
                  </div>
                )}

                <p className="text-gray-500 text-sm mb-4">
                  Tocá un artículo para agregar cantidad
                </p>

                {/* Lista de artículos agrupada por rubro/marca */}
                {articulosAgrupados.map(grupo => (
                  <div key={grupo.rubro} className="mb-4">
                    {/* Header de rubro */}
                    <h2 className="text-sm font-bold text-gray-700 bg-gray-200 px-3 py-2 rounded-t-lg uppercase tracking-wide">
                      {grupo.rubro}
                    </h2>

                    {grupo.marcas.map(subgrupo => (
                      <div key={subgrupo.marca}>
                        {/* Header de marca */}
                        <h3 className="text-xs font-semibold text-blue-700 bg-blue-50 px-3 py-1.5 border-b border-blue-100">
                          {subgrupo.marca}
                        </h3>

                        <div className="space-y-3 py-2">
                          {subgrupo.articulos.map(articulo => (
                            <ArticuloCard
                              key={articulo.id}
                              articulo={articulo}
                              cantidad={cantidades[articulo.id] || 0}
                              onChange={(val) => actualizarCantidad(articulo.id, val)}
                              sucursalId={sucursalSeleccionada}
                              mostrarStockIdeal
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {articulos.length === 0 && (
                  <p className="text-center text-gray-400 mt-10">
                    No hay artículos habilitados para esta sucursal
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* ───── FLUJO EXTRAORDINARIO ───── */}
        {sucursalSeleccionada && esExtraordinario && (
          <>
            {/* Buscador */}
            <div className="mb-4">
              <input
                type="text"
                value={busquedaErp}
                onChange={(e) => handleBusquedaErp(e.target.value)}
                placeholder="Buscar por nombre o código..."
                className="campo-form"
              />
            </div>

            {buscandoErp && (
              <div className="flex justify-center items-center h-32">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600" />
              </div>
            )}

            {!buscandoErp && (
              <>
                <p className="text-gray-500 text-sm mb-3">
                  {totalErp} artículo{totalErp !== 1 ? 's' : ''} encontrado{totalErp !== 1 ? 's' : ''}
                  {totalArticulos > 0 && (
                    <span className="text-purple-600 font-medium"> · {totalArticulos} seleccionado{totalArticulos !== 1 ? 's' : ''}</span>
                  )}
                </p>

                {/* Sección: artículos ya seleccionados (solo sin búsqueda) */}
                {!busquedaErp && articulosSeleccionados.length > 0 && (
                  <div className="mb-4">
                    <h2 className="text-sm font-bold text-purple-700 bg-purple-50 px-3 py-2 rounded-t-lg uppercase tracking-wide border border-purple-200 border-b-0">
                      En el pedido ({articulosSeleccionados.length})
                    </h2>
                    <div className="space-y-3 py-2 px-1 bg-purple-50/30 border border-purple-200 border-t-0 rounded-b-lg">
                      {articulosSeleccionados
                        .sort((a, b) => a.nombre.localeCompare(b.nombre))
                        .map(articulo => (
                          <ArticuloCard
                            key={'sel-' + articulo.id}
                            articulo={articulo}
                            cantidad={cantidades[articulo.id] || 0}
                            onChange={(val) => actualizarCantidad(articulo.id, val)}
                            mostrarStockIdeal={false}
                          />
                        ))}
                    </div>
                  </div>
                )}

                {/* Lista plana de artículos ERP */}
                <div className="space-y-3">
                  {articulosErp.map(articulo => (
                    <ArticuloCard
                      key={articulo.id}
                      articulo={articulo}
                      cantidad={cantidades[articulo.id] || 0}
                      onChange={(val) => actualizarCantidad(articulo.id, val)}
                      mostrarStockIdeal={false}
                    />
                  ))}
                </div>

                {articulosErp.length === 0 && (
                  <p className="text-center text-gray-400 mt-10">
                    No se encontraron artículos
                  </p>
                )}

                {/* Paginación */}
                {totalErp > ERP_LIMIT && (
                  <div className="flex items-center justify-between mt-4 gap-2">
                    <button
                      onClick={() => setPaginaErp(p => Math.max(1, p - 1))}
                      disabled={paginaErp <= 1}
                      className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                    >
                      Anterior
                    </button>
                    <span className="text-sm text-gray-500">
                      Página {paginaErp} de {totalPaginasErp}
                    </span>
                    <button
                      onClick={() => setPaginaErp(p => Math.min(totalPaginasErp, p + 1))}
                      disabled={paginaErp >= totalPaginasErp}
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

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200 mt-4">
            {error}
          </div>
        )}
      </div>

      {/* Barra inferior fija con el botón de enviar */}
      {sucursalSeleccionada && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">
              {totalArticulos} artículo{totalArticulos !== 1 ? 's' : ''} seleccionado{totalArticulos !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={handleEnviar}
            disabled={enviando || totalArticulos === 0}
            className="btn-primario"
          >
            {enviando ? 'Enviando...' : 'Confirmar pedido'}
          </button>
        </div>
      )}
    </div>
  )
}

// Componente de tarjeta de artículo con selector de cantidad y stock ideal editable (opcional)
const ArticuloCard = ({ articulo, cantidad, onChange, sucursalId, mostrarStockIdeal = true }) => {
  const tieneUnidades = cantidad > 0
  const [stockIdeal, setStockIdeal] = useState(articulo.stock_ideal || 0)
  const guardandoRef = useRef(false)

  const cambiarStock = async (valor) => {
    const nuevoStock = Math.max(0, parseInt(valor) || 0)
    setStockIdeal(nuevoStock)
    if (guardandoRef.current) return
    guardandoRef.current = true
    try {
      await api.put(`/api/articulos/${articulo.id}/sucursal/${sucursalId}/stock-ideal`, {
        stock_ideal: nuevoStock,
      })
      articulo.stock_ideal = nuevoStock
    } catch {
      setStockIdeal(articulo.stock_ideal || 0)
    } finally {
      guardandoRef.current = false
    }
  }

  return (
    <div className={`tarjeta transition-all ${
      tieneUnidades ? 'border-blue-400 bg-blue-50' : ''
    }`}>
      {/* Info del artículo */}
      <div className="mb-2">
        <p className="font-medium text-gray-800 truncate">{articulo.nombre}</p>
        <p className="text-xs text-gray-400 mt-0.5">Código: {articulo.codigo}</p>
        {!mostrarStockIdeal && articulo.stock_deposito != null && (
          <p className={`text-xs mt-0.5 font-medium ${
            articulo.stock_deposito > 0 ? 'text-green-600' : 'text-gray-400'
          }`}>
            Stock depósito: {articulo.stock_deposito}
          </p>
        )}
      </div>

      {/* Fila: Cantidad a pedir */}
      <div className={`flex items-center justify-between ${mostrarStockIdeal ? 'mb-2' : ''}`}>
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
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => onChange(cantidad + 1)}
            className="w-10 h-10 rounded-full bg-blue-600 text-white text-xl font-bold
                       flex items-center justify-center hover:bg-blue-700 active:bg-blue-800"
          >
            +
          </button>
        </div>
      </div>

      {/* Fila: Stock ideal (solo en flujo regular) */}
      {mostrarStockIdeal && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-600 font-medium">Stock ideal</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => cambiarStock(stockIdeal - 1)}
              className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 text-xl font-bold
                         flex items-center justify-center hover:bg-gray-300 active:bg-gray-400
                         disabled:opacity-30"
              disabled={stockIdeal <= 0}
            >
              −
            </button>
            <input
              type="number"
              value={stockIdeal || ''}
              onChange={(e) => cambiarStock(e.target.value)}
              placeholder="0"
              min="0"
              className="w-12 text-center text-lg font-semibold border border-gray-300 rounded-lg py-1
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => cambiarStock(stockIdeal + 1)}
              className="w-10 h-10 rounded-full bg-blue-600 text-white text-xl font-bold
                         flex items-center justify-center hover:bg-blue-700 active:bg-blue-800"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default NuevoPedido
