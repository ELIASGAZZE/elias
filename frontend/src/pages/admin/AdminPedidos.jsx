// Vista de pedidos: todos los usuarios ven todos los pedidos
// Admin tiene acciones extra (cambiar estado, eliminar, CSV)
import React, { useState, useEffect, useMemo } from 'react'
import Navbar from '../../components/layout/Navbar'
import { useAuth } from '../../context/AuthContext'
import api from '../../services/api'

const ESTADOS = ['pendiente', 'confirmado', 'entregado', 'cancelado']

const COLORES_ESTADO = {
  pendiente:  'bg-yellow-100 text-yellow-800',
  confirmado: 'bg-blue-100 text-blue-800',
  entregado:  'bg-green-100 text-green-800',
  cancelado:  'bg-red-100 text-red-800',
}

const AdminPedidos = () => {
  const { esAdmin } = useAuth()

  const [pedidos, setPedidos] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)

  // Filtros
  const [filtroSucursal, setFiltroSucursal] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')

  const [pedidoExpandido, setPedidoExpandido] = useState(null)

  const cargarDatos = async () => {
    try {
      const params = {}
      if (filtroSucursal) params.sucursal_id = filtroSucursal
      if (filtroEstado) params.estado = filtroEstado
      if (filtroUsuario) params.usuario_id = filtroUsuario
      if (filtroFechaDesde) params.fecha_desde = filtroFechaDesde
      if (filtroFechaHasta) params.fecha_hasta = filtroFechaHasta

      const [resPedidos, resSucursales] = await Promise.all([
        api.get('/api/pedidos', { params }),
        api.get('/api/sucursales'),
      ])
      setPedidos(resPedidos.data)
      setSucursales(resSucursales.data)
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [filtroSucursal, filtroEstado, filtroUsuario, filtroFechaDesde, filtroFechaHasta])

  // Extraer usuarios únicos de los pedidos cargados (para el filtro)
  const usuariosUnicos = useMemo(() => {
    const mapa = new Map()
    pedidos.forEach(p => {
      if (p.perfiles?.id && !mapa.has(p.perfiles.id)) {
        mapa.set(p.perfiles.id, p.perfiles.nombre)
      }
    })
    return Array.from(mapa, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [pedidos])

  // Cambia el estado de un pedido (solo admin)
  const cambiarEstado = async (pedidoId, nuevoEstado) => {
    try {
      await api.put(`/api/pedidos/${pedidoId}/estado`, { estado: nuevoEstado })
      setPedidos(prev =>
        prev.map(p => p.id === pedidoId ? { ...p, estado: nuevoEstado } : p)
      )
    } catch (err) {
      alert('Error al actualizar el estado del pedido')
    }
  }

  // Elimina un pedido (solo admin)
  const eliminarPedido = async (pedidoId) => {
    if (!confirm('¿Estás seguro de eliminar este pedido?')) return

    try {
      await api.delete(`/api/pedidos/${pedidoId}`)
      setPedidos(prev => prev.filter(p => p.id !== pedidoId))
    } catch (err) {
      alert('Error al eliminar el pedido')
    }
  }

  // Descarga el pedido como CSV (solo admin)
  const descargarCSV = (pedidoId) => {
    const token = localStorage.getItem('token')
    const url = `${import.meta.env.VITE_API_URL}/api/pedidos/${pedidoId}/csv`
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.blob())
      .then(blob => {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.setAttribute('download', `pedido-${pedidoId}.csv`)
        a.click()
        URL.revokeObjectURL(objectUrl)
      })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Pedidos" />

      <div className="px-4 py-4">

        {/* Filtros */}
        <div className="tarjeta mb-4">
          <h2 className="font-semibold text-gray-700 mb-2 text-sm">Filtros</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Sucursal</label>
              <select
                value={filtroSucursal}
                onChange={(e) => setFiltroSucursal(e.target.value)}
                className="campo-form text-xs py-1.5 px-2"
              >
                <option value="">Todas</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Estado</label>
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                className="campo-form text-xs py-1.5 px-2"
              >
                <option value="">Todos</option>
                {ESTADOS.map(e => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Creado por</label>
              <select
                value={filtroUsuario}
                onChange={(e) => setFiltroUsuario(e.target.value)}
                className="campo-form text-xs py-1.5 px-2"
              >
                <option value="">Todos</option>
                {usuariosUnicos.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-0.5 block">Desde</label>
              <input
                type="date"
                value={filtroFechaDesde}
                onChange={(e) => setFiltroFechaDesde(e.target.value)}
                className="campo-form text-xs py-1.5 px-2"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Hasta</label>
              <input
                type="date"
                value={filtroFechaHasta}
                onChange={(e) => setFiltroFechaHasta(e.target.value)}
                className="campo-form text-xs py-1.5 px-2"
              />
            </div>
          </div>
        </div>

        {/* Lista de pedidos */}
        {cargando ? (
          <div className="flex justify-center mt-10">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {pedidos.length === 0 && (
              <p className="text-center text-gray-400 mt-8">No se encontraron pedidos</p>
            )}

            {pedidos.map(pedido => (
              <div key={pedido.id} className="tarjeta">
                {/* Encabezado del pedido */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-800 truncate">
                      {pedido.sucursales?.nombre}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {new Date(pedido.fecha).toLocaleDateString('es-AR')} · {pedido.perfiles?.nombre}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full flex-shrink-0 ${COLORES_ESTADO[pedido.estado]}`}>
                    {pedido.estado}
                  </span>
                </div>

                {/* Botón para expandir/colapsar los items */}
                <button
                  onClick={() => setPedidoExpandido(pedidoExpandido === pedido.id ? null : pedido.id)}
                  className="text-sm text-blue-600 hover:underline mt-1"
                >
                  {pedidoExpandido === pedido.id ? 'Ocultar items' : `Ver ${pedido.items_pedido?.length} artículo(s)`}
                </button>

                {/* Items expandidos */}
                {pedidoExpandido === pedido.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-1">
                    {pedido.items_pedido?.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm gap-2">
                        <span className="text-gray-600 min-w-0 truncate">
                          <span className="text-gray-400 mr-1">{item.articulos.codigo}</span>
                          {item.articulos.nombre}
                        </span>
                        <span className="font-medium flex-shrink-0">{item.cantidad}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Acciones admin */}
                {esAdmin && (
                  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                    {/* Selector de estado */}
                    <select
                      value={pedido.estado}
                      onChange={(e) => cambiarEstado(pedido.id, e.target.value)}
                      className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {ESTADOS.map(e => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>

                    {/* Descargar CSV */}
                    <button
                      onClick={() => descargarCSV(pedido.id)}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      CSV
                    </button>

                    {/* Eliminar */}
                    <button
                      onClick={() => eliminarPedido(pedido.id)}
                      className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors ml-auto"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminPedidos
