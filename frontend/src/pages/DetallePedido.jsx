// Página de detalle de un pedido individual
// Muestra info completa + items + acciones admin
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/layout/Navbar'
import { useAuth } from '../context/AuthContext'
import api from '../services/api'

const ESTADOS = ['pendiente', 'confirmado', 'entregado', 'cancelado']

const COLORES_ESTADO = {
  pendiente:  'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  entregado:  'bg-green-100 text-green-800',
  cancelado:  'bg-red-100 text-red-800',
}

const DetallePedido = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()

  const [pedido, setPedido] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get(`/api/pedidos/${id}`)
        setPedido(data)
      } catch (err) {
        setError('No se pudo cargar el pedido')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  const cambiarEstado = async (nuevoEstado) => {
    try {
      await api.put(`/api/pedidos/${id}/estado`, { estado: nuevoEstado })
      setPedido(prev => ({ ...prev, estado: nuevoEstado }))
    } catch (err) {
      alert('Error al actualizar el estado del pedido')
    }
  }

  const eliminarPedido = async () => {
    if (!confirm('¿Estás seguro de eliminar este pedido?')) return
    try {
      await api.delete(`/api/pedidos/${id}`)
      navigate('/pedidos')
    } catch (err) {
      alert('Error al eliminar el pedido')
    }
  }

  const descargarArchivo = (ext) => {
    const token = localStorage.getItem('token')
    const url = `${import.meta.env.VITE_API_URL}/api/pedidos/${id}/${ext}`
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error()
        return res.blob()
      })
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.setAttribute('download', `pedido-${id}.${ext}`)
        a.click()
        URL.revokeObjectURL(objectUrl)
      })
      .catch(() => {
        if (ext === 'pdf') alert('Este pedido no tiene artículos manuales')
      })
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Pedido" />
        <div className="flex justify-center mt-10">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      </div>
    )
  }

  if (error || !pedido) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Pedido" />
        <div className="px-4 py-8 text-center">
          <p className="text-red-500 mb-4">{error || 'Pedido no encontrado'}</p>
          <button onClick={() => navigate('/pedidos')} className="btn-secundario max-w-xs mx-auto">
            Volver a pedidos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Pedido" />

      <div className="px-4 py-4">
        {/* Botón volver */}
        <button
          onClick={() => navigate('/pedidos')}
          className="text-sm text-blue-600 hover:underline mb-4 inline-block"
        >
          &larr; Volver a pedidos
        </button>

        {/* Encabezado */}
        <div className="tarjeta mb-4">
          {pedido.nombre && (
            <h2 className="text-lg font-bold text-gray-800 mb-2">{pedido.nombre}</h2>
          )}

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-800">{pedido.sucursales?.nombre}</p>
              <p className="text-sm text-gray-500">
                {new Date(pedido.fecha).toLocaleDateString('es-AR')} · {pedido.perfiles?.nombre}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${COLORES_ESTADO[pedido.estado]}`}>
                {pedido.estado}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                pedido.tipo === 'extraordinario'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {pedido.tipo === 'extraordinario' ? 'Extraordinario' : 'Regular'}
              </span>
            </div>
          </div>
        </div>

        {/* Acciones admin */}
        {esAdmin && (
          <div className="tarjeta mb-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Acciones</h3>
            <div className="flex flex-wrap gap-2">
              <select
                value={pedido.estado}
                onChange={(e) => cambiarEstado(e.target.value)}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {ESTADOS.map(e => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>

              <button
                onClick={() => descargarArchivo('txt')}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                TXT (ERP)
              </button>

              <button
                onClick={() => descargarArchivo('pdf')}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                PDF (Manuales)
              </button>

              <button
                onClick={eliminarPedido}
                className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors ml-auto"
              >
                Eliminar pedido
              </button>
            </div>
          </div>
        )}

        {/* Lista de items */}
        <div className="tarjeta">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Artículos ({pedido.items_pedido?.length || 0})
          </h3>
          <div className="space-y-2">
            {pedido.items_pedido?.map((item, i) => (
              <div key={i} className="flex justify-between text-sm gap-2 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-600 min-w-0 truncate">
                  <span className="text-gray-400 mr-1">{item.articulos.codigo}</span>
                  {item.articulos.nombre}
                </span>
                <span className="font-medium flex-shrink-0">{item.cantidad}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DetallePedido
