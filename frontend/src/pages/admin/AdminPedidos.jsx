// Vista de pedidos: listado con paginación
// Cada pedido es un link a la página de detalle
import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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

const LIMIT = 15

const AdminPedidos = () => {
  const { esAdmin } = useAuth()
  const navigate = useNavigate()

  const [pedidos, setPedidos] = useState([])
  const [total, setTotal] = useState(0)
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState(1)

  // Filtros
  const [filtroSucursal, setFiltroSucursal] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT))

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const params = { page: pagina, limit: LIMIT }
      if (filtroSucursal) params.sucursal_id = filtroSucursal
      if (filtroEstado) params.estado = filtroEstado
      if (filtroUsuario) params.usuario_id = filtroUsuario
      if (filtroFechaDesde) params.fecha_desde = filtroFechaDesde
      if (filtroFechaHasta) params.fecha_hasta = filtroFechaHasta

      const [resPedidos, resSucursales] = await Promise.all([
        api.get('/api/pedidos', { params }),
        api.get('/api/sucursales'),
      ])
      setPedidos(resPedidos.data.pedidos)
      setTotal(resPedidos.data.total)
      setSucursales(resSucursales.data)
    } catch (err) {
      console.error('Error al cargar datos:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [pagina, filtroSucursal, filtroEstado, filtroUsuario, filtroFechaDesde, filtroFechaHasta])

  // Reset a página 1 cuando cambia un filtro
  const aplicarFiltro = (setter) => (e) => {
    setPagina(1)
    setter(e.target.value)
  }

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
                onChange={aplicarFiltro(setFiltroSucursal)}
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
                onChange={aplicarFiltro(setFiltroEstado)}
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
                onChange={aplicarFiltro(setFiltroUsuario)}
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
                onChange={aplicarFiltro(setFiltroFechaDesde)}
                className="campo-form text-xs py-1.5 px-2"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="text-xs text-gray-500 mb-0.5 block">Hasta</label>
              <input
                type="date"
                value={filtroFechaHasta}
                onChange={aplicarFiltro(setFiltroFechaHasta)}
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
          <>
            <div className="space-y-3">
              {pedidos.length === 0 && (
                <p className="text-center text-gray-400 mt-8">No se encontraron pedidos</p>
              )}

              {pedidos.map(pedido => (
                <div
                  key={pedido.id}
                  onClick={() => navigate(`/pedidos/${pedido.id}`)}
                  className="tarjeta cursor-pointer hover:shadow-md active:bg-gray-50 transition-all"
                >
                  {/* Nombre del pedido */}
                  {pedido.nombre && (
                    <p className="text-sm font-bold text-blue-700 mb-1 truncate">{pedido.nombre}</p>
                  )}

                  {/* Encabezado del pedido */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-800 truncate">
                        {pedido.sucursales?.nombre}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {new Date(pedido.fecha).toLocaleDateString('es-AR')} · {pedido.perfiles?.nombre}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-xs font-semibold px-3 py-1 rounded-full ${COLORES_ESTADO[pedido.estado]}`}>
                        {pedido.estado}
                      </span>
                      {pedido.tipo === 'extraordinario' && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                          Extraordinario
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-2">
                    {pedido.items_pedido?.length || 0} artículo(s)
                  </p>
                </div>
              ))}
            </div>

            {/* Paginación */}
            {total > LIMIT && (
              <div className="flex items-center justify-between mt-4 gap-2">
                <button
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={pagina <= 1}
                  className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  Anterior
                </button>
                <span className="text-sm text-gray-500">
                  Página {pagina} de {totalPaginas}
                </span>
                <button
                  onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                  disabled={pagina >= totalPaginas}
                  className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AdminPedidos
