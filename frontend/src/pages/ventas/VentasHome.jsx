// Historial de ventas POS
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const formatHora = (fecha) => {
  if (!fecha) return ''
  return new Date(fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatPrecio = (precio) => {
  if (precio == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const MEDIOS_LABELS = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta Dbto',
  credito: 'Tarjeta Crto',
  qr: 'QR / Transferencia',
  cuenta_corriente: 'Cta. Corriente',
}

const VentasHome = () => {
  const { esAdmin } = useAuth()
  const [ventas, setVentas] = useState([])
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    cargarVentas()
  }, [fecha])

  const cargarVentas = async () => {
    setCargando(true)
    try {
      const { data } = await api.get(`/api/pos/ventas?fecha=${fecha}`)
      setVentas(data.ventas || [])
    } catch (err) {
      console.error('Error al cargar ventas:', err)
    } finally {
      setCargando(false)
    }
  }

  // Filtrar por búsqueda de cliente
  const ventasFiltradas = ventas.filter(v => {
    if (!busqueda) return true
    const term = busqueda.toLowerCase()
    return (v.nombre_cliente || '').toLowerCase().includes(term)
  })

  // Resumen del día
  const totalDia = ventasFiltradas.reduce((sum, v) => sum + (parseFloat(v.total) || 0), 0)
  const desgloseMedios = {}
  ventasFiltradas.forEach(v => {
    const pagos = v.pagos || []
    pagos.forEach(p => {
      const medio = p.medio || 'efectivo'
      desgloseMedios[medio] = (desgloseMedios[medio] || 0) + (parseFloat(p.monto) || 0)
    })
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
          />
          <input
            type="text"
            placeholder="Buscar por cliente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
          />
        </div>

        {/* Resumen del día */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Resumen del día</h2>
            <span className="text-xs text-gray-400">{ventasFiltradas.length} venta{ventasFiltradas.length !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 mb-3">{formatPrecio(totalDia)}</p>
          {Object.keys(desgloseMedios).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(desgloseMedios).map(([medio, monto]) => (
                <span key={medio} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                  {MEDIOS_LABELS[medio] || medio}: {formatPrecio(monto)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Lista de ventas */}
        {cargando ? (
          <div className="text-center text-gray-400 py-10">Cargando ventas...</div>
        ) : ventasFiltradas.length === 0 ? (
          <div className="text-center text-gray-400 py-10">
            {busqueda ? 'Sin resultados para la búsqueda' : 'No hay ventas para esta fecha'}
          </div>
        ) : (
          <div className="space-y-2">
            {ventasFiltradas.map(v => {
              const pagos = v.pagos || []
              const mediosUsados = [...new Set(pagos.map(p => MEDIOS_LABELS[p.medio] || p.medio))]

              return (
                <Link
                  key={v.id}
                  to={`/ventas/${v.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-rose-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-800">
                          {formatHora(v.created_at)}
                        </span>
                        {esAdmin && v.perfiles?.nombre && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                            {v.perfiles.nombre}
                          </span>
                        )}
                        {v.pedido && (
                          <span className="text-xs bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
                            Pedido #{v.pedido.numero || '—'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">
                        {v.nombre_cliente || 'Consumidor Final'}
                      </p>
                      {mediosUsados.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {mediosUsados.map(m => (
                            <span key={m} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right ml-3">
                      <span className="text-base font-semibold text-gray-800">{formatPrecio(v.total)}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default VentasHome
