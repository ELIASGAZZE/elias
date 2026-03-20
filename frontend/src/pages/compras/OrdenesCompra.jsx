// Lista de órdenes de compra
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADO_BADGE = {
  borrador: 'bg-gray-100 text-gray-600',
  enviada: 'bg-blue-100 text-blue-600',
  recibida_parcial: 'bg-yellow-100 text-yellow-600',
  recibida: 'bg-green-100 text-green-600',
  cancelada: 'bg-red-100 text-red-600',
}

const OrdenesCompra = () => {
  const [ordenes, setOrdenes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('')

  useEffect(() => {
    const params = filtroEstado ? `?estado=${filtroEstado}` : ''
    api.get(`/api/compras/ordenes${params}`)
      .then(r => setOrdenes(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }, [filtroEstado])

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Órdenes de Compra" sinTabs volverA="/compras" />

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-2 items-center">
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2">
            <option value="">Todos los estados</option>
            <option value="borrador">Borrador</option>
            <option value="enviada">Enviada</option>
            <option value="recibida_parcial">Recibida parcial</option>
            <option value="recibida">Recibida</option>
            <option value="cancelada">Cancelada</option>
          </select>
          <div className="flex-1" />
          <Link to="/compras/nueva-orden"
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Nueva OC
          </Link>
        </div>

        {cargando ? (
          <div className="text-center py-10 text-gray-400">Cargando...</div>
        ) : ordenes.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay órdenes</div>
        ) : (
          <div className="space-y-2">
            {ordenes.map(o => (
              <Link key={o.id} to={`/compras/ordenes/${o.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-800">
                      {o.numero}
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[o.estado]}`}>{o.estado}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {o.proveedores?.nombre || 'Proveedor'}
                      <span className="mx-2">—</span>
                      {new Date(o.created_at).toLocaleDateString('es-AR')}
                      {o.items && <span className="ml-2">{Array.isArray(o.items) ? o.items.length : 0} items</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-gray-800">${Number(o.total || 0).toLocaleString('es-AR')}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default OrdenesCompra
