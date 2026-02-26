// Vista principal del operario: crear un nuevo pedido
// Diseño mobile-first con tarjetas táctiles grandes
// Artículos agrupados por rubro y marca
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const BORRADOR_KEY = 'pedido_borrador'

const guardarBorrador = (sucursalId, cantidades, nombre) => {
  const hayItems = Object.values(cantidades).some(c => c > 0)
  if (!sucursalId || !hayItems) {
    localStorage.removeItem(BORRADOR_KEY)
    return
  }
  localStorage.setItem(BORRADOR_KEY, JSON.stringify({
    sucursal_id: sucursalId,
    cantidades,
    nombre: nombre || '',
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

  // Cargamos artículos cuando cambia la sucursal
  useEffect(() => {
    if (!sucursalSeleccionada) {
      setArticulos([])
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
        if (borrador && borrador.sucursal_id === sucursalSeleccionada) {
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
        } else {
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
  }, [sucursalSeleccionada])

  // Agrupar artículos por rubro → marca
  const articulosAgrupados = useMemo(() => {
    const grupos = {}

    articulos.forEach(art => {
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
  }, [articulos])

  // Autoguardar borrador cada vez que cambian cantidades o sucursal
  // No ejecutar hasta que la restauración del borrador previo haya terminado
  useEffect(() => {
    if (!restauracionLista.current) return
    guardarBorrador(sucursalSeleccionada, cantidades, nombrePedido)
  }, [sucursalSeleccionada, cantidades, nombrePedido])

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

  // Cuenta cuántos artículos tienen cantidad > 0
  const totalArticulos = Object.values(cantidades).filter(c => c > 0).length

  // Envía el pedido al backend
  const handleEnviar = async () => {
    const items = articulos
      .filter(art => cantidades[art.id] > 0)
      .map(art => ({ articulo_id: art.id, cantidad: cantidades[art.id] }))

    if (items.length === 0) {
      setError('Debés agregar al menos un artículo al pedido')
      return
    }

    setEnviando(true)
    setError('')

    try {
      const body = { items, sucursal_id: sucursalSeleccionada }
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
            onClick={() => { limpiarBorrador(); setExito(false) }}
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

        {cargando && (
          <div className="flex justify-center items-center h-32">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        )}

        {sucursalSeleccionada && !cargando && (
          <>
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

// Componente de tarjeta de artículo con selector de cantidad y stock ideal editable
const ArticuloCard = ({ articulo, cantidad, onChange, sucursalId }) => {
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
      </div>

      {/* Fila: Cantidad a pedir */}
      <div className="flex items-center justify-between mb-2">
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

      {/* Fila: Stock ideal */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <span className="text-sm text-blue-600 font-medium">Stock ideal</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => cambiarStock(stockIdeal - 1)}
            className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 text-xl font-bold
                       flex items-center justify-center hover:bg-blue-100 active:bg-blue-200
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
            className="w-12 text-center text-lg font-semibold border border-blue-300 rounded-lg py-1
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => cambiarStock(stockIdeal + 1)}
            className="w-10 h-10 rounded-full bg-blue-500 text-white text-xl font-bold
                       flex items-center justify-center hover:bg-blue-600 active:bg-blue-700"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

export default NuevoPedido
