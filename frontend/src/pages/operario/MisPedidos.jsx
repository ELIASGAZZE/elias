// Vista del operario: historial de sus pedidos
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import { OPERARIO_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

// Colores para los distintos estados del pedido
const COLORES_ESTADO = {
  pendiente:  'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  entregado:  'bg-green-100 text-green-800',
  cancelado:  'bg-red-100 text-red-800',
}

const MisPedidos = () => {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/pedidos')
        setPedidos(data)
      } catch (err) {
        console.error('Error al cargar pedidos:', err)
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Mis Pedidos" tabs={OPERARIO_TABS} />

      <div className="px-4 py-4 space-y-3">
        {cargando && (
          <div className="flex justify-center mt-10">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        )}

        {!cargando && pedidos.length === 0 && (
          <div className="text-center mt-16">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500">Todavía no hiciste ningún pedido</p>
          </div>
        )}

        {pedidos.map(pedido => (
          <div key={pedido.id} className="tarjeta">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold text-gray-800">
                  Pedido del {new Date(pedido.fecha).toLocaleDateString('es-AR')}
                </p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {pedido.sucursales?.nombre} · {pedido.items_pedido?.length} artículo{pedido.items_pedido?.length !== 1 ? 's' : ''}
                </p>
              </div>
              {/* Badge de estado */}
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${COLORES_ESTADO[pedido.estado]}`}>
                {pedido.estado}
              </span>
            </div>

            {/* Lista resumida de artículos */}
            <div className="space-y-1 mt-3 border-t border-gray-100 pt-3">
              {pedido.items_pedido?.slice(0, 3).map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-600">{item.articulos.nombre}</span>
                  <span className="font-medium">{item.cantidad}</span>
                </div>
              ))}
              {pedido.items_pedido?.length > 3 && (
                <p className="text-xs text-gray-400 text-right">
                  +{pedido.items_pedido.length - 3} más
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Botón flotante para hacer nuevo pedido */}
      <button
        onClick={() => navigate('/operario')}
        className="fixed bottom-6 right-6 bg-blue-600 text-white rounded-full w-16 h-16
                   flex items-center justify-center shadow-lg text-2xl
                   hover:bg-blue-700 active:bg-blue-800 transition-colors"
        title="Nuevo pedido"
      >
        +
      </button>
    </div>
  )
}

export default MisPedidos
