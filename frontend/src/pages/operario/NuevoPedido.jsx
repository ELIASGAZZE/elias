// Vista principal del operario: crear un nuevo pedido
// Diseño mobile-first con tarjetas táctiles grandes
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import { OPERARIO_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const NuevoPedido = () => {
  const [sucursales, setSucursales] = useState([])
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState('')
  const [articulos, setArticulos] = useState([])
  const [cantidades, setCantidades] = useState({}) // { articulo_id: cantidad }
  const [cargando, setCargando] = useState(false)
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)
  const navigate = useNavigate()

  // Cargamos las sucursales al iniciar
  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data)
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
      } catch (err) {
        setError('Error al cargar artículos')
      } finally {
        setCargando(false)
      }
    }
    cargarArticulos()
    // Limpiamos cantidades al cambiar de sucursal
    setCantidades({})
  }, [sucursalSeleccionada])

  // Actualiza la cantidad de un artículo específico
  const actualizarCantidad = (articuloId, valor) => {
    const cantidad = Math.max(0, parseInt(valor) || 0)
    setCantidades(prev => ({
      ...prev,
      [articuloId]: cantidad,
    }))
  }

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
      await api.post('/api/pedidos', { items, sucursal_id: sucursalSeleccionada })
      setExito(true)
      setCantidades({})
    } catch (err) {
      setError('Error al enviar el pedido. Intentá nuevamente.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoSucursales) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Nuevo Pedido" tabs={OPERARIO_TABS} />
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
        <Navbar titulo="Nuevo Pedido" tabs={OPERARIO_TABS} />
        <div className="flex flex-col items-center justify-center h-[80vh] px-4 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">¡Pedido enviado!</h2>
          <p className="text-gray-500 mb-6">Tu pedido fue registrado correctamente</p>
          <button
            onClick={() => setExito(false)}
            className="btn-primario max-w-xs"
          >
            Hacer otro pedido
          </button>
          <button
            onClick={() => navigate('/operario/pedidos')}
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
      <Navbar titulo="Nuevo Pedido" tabs={OPERARIO_TABS} />

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

            {/* Lista de artículos */}
            <div className="space-y-3">
              {articulos.map(articulo => (
                <ArticuloCard
                  key={articulo.id}
                  articulo={articulo}
                  cantidad={cantidades[articulo.id] || 0}
                  onChange={(val) => actualizarCantidad(articulo.id, val)}
                />
              ))}
            </div>

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

// Componente de tarjeta de artículo con selector de cantidad
const ArticuloCard = ({ articulo, cantidad, onChange }) => {
  const tieneUnidades = cantidad > 0

  return (
    <div className={`tarjeta flex items-center justify-between transition-all ${
      tieneUnidades ? 'border-blue-400 bg-blue-50' : ''
    }`}>
      {/* Info del artículo */}
      <div className="flex-1 min-w-0 mr-3">
        <p className="font-medium text-gray-800 truncate">{articulo.nombre}</p>
        <p className="text-xs text-gray-400 mt-0.5">Código: {articulo.codigo}</p>
      </div>

      {/* Selector de cantidad con botones +/- grandes (fáciles de tocar) */}
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
  )
}

export default NuevoPedido
