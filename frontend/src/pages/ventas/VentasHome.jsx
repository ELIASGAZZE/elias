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
  const [filtroClasificacion, setFiltroClasificacion] = useState('') // '', 'EMPRESA', 'PRUEBA'
  const [filtroTipo, setFiltroTipo] = useState('') // '', 'venta', 'nota_credito'
  const [filtroSucursal, setFiltroSucursal] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [reenviando, setReenviando] = useState(null) // id de venta en proceso
  const [reenvioMasivo, setReenvioMasivo] = useState(false)

  useEffect(() => {
    cargarVentas()
  }, [fecha])

  useEffect(() => {
    api.get('/api/sucursales').then(r => setSucursales(r.data || [])).catch(() => {})
  }, [])

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

  // Filtrar por búsqueda de cliente, clasificación, tipo y sucursal
  const ventasFiltradas = ventas.filter(v => {
    if (busqueda) {
      const term = busqueda.toLowerCase()
      if (!(v.nombre_cliente || '').toLowerCase().includes(term)) return false
    }
    if (filtroClasificacion && v.clasificacion !== filtroClasificacion) return false
    if (filtroTipo === 'nota_credito' && v.tipo !== 'nota_credito') return false
    if (filtroTipo === 'venta' && v.tipo === 'nota_credito') return false
    if (filtroSucursal && v.sucursal_id !== filtroSucursal) return false
    return true
  })

  // Resumen del día
  const soloVentas = ventasFiltradas.filter(v => v.tipo !== 'nota_credito')
  const soloNC = ventasFiltradas.filter(v => v.tipo === 'nota_credito')
  const totalVentas = soloVentas.reduce((sum, v) => sum + (parseFloat(v.total) || 0), 0)
  const totalNC = soloNC.reduce((sum, v) => sum + (parseFloat(v.total) || 0), 0)
  const totalDia = totalVentas + totalNC
  const totalEmpresa = ventasFiltradas.filter(v => v.clasificacion === 'EMPRESA').reduce((s, v) => s + (parseFloat(v.total) || 0), 0)
  const totalPrueba = ventasFiltradas.filter(v => v.clasificacion === 'PRUEBA').reduce((s, v) => s + (parseFloat(v.total) || 0), 0)
  const desgloseMedios = {}
  ventasFiltradas.forEach(v => {
    const pagos = v.pagos || []
    pagos.forEach(p => {
      const medio = p.medio || 'efectivo'
      desgloseMedios[medio] = (desgloseMedios[medio] || 0) + (parseFloat(p.monto) || 0)
    })
  })

  const reenviarCentum = async (e, ventaId) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('¿Reintentar envío a Centum? Esto genera una factura fiscal.')) return
    setReenviando(ventaId)
    try {
      await api.post(`/api/pos/ventas/${ventaId}/reenviar-centum`)
      await cargarVentas()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setReenviando(null)
    }
  }

  const reenviarTodasCentum = async () => {
    const pendientes = ventas.filter(v => !v.centum_sync && !v.centum_comprobante)
    if (pendientes.length === 0) return
    if (!confirm(`¿Reintentar ${pendientes.length} venta(s) en Centum? Esto genera facturas fiscales.`)) return
    setReenvioMasivo(true)
    let ok = 0, fail = 0
    for (const v of pendientes) {
      try {
        await api.post(`/api/pos/ventas/${v.id}/reenviar-centum`)
        ok++
      } catch {
        fail++
      }
    }
    await cargarVentas()
    setReenvioMasivo(false)
    alert(`Listo: ${ok} enviada(s), ${fail} fallida(s)`)
  }

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

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {/* Tipo: Venta / NC */}
          {['', 'venta', 'nota_credito'].map(tipo => (
            <button
              key={`tipo-${tipo}`}
              onClick={() => setFiltroTipo(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroTipo === tipo
                  ? tipo === 'nota_credito' ? 'bg-red-600 text-white'
                    : tipo === 'venta' ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo === 'nota_credito' ? 'Notas de crédito' : tipo === 'venta' ? 'Ventas' : 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          {/* Clasificación: Empresa / Prueba */}
          {['', 'EMPRESA', 'PRUEBA'].map(tipo => (
            <button
              key={`clas-${tipo}`}
              onClick={() => setFiltroClasificacion(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroClasificacion === tipo
                  ? tipo === 'EMPRESA' ? 'bg-blue-600 text-white'
                    : tipo === 'PRUEBA' ? 'bg-amber-500 text-white'
                    : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo || 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          {/* Sucursal */}
          <select
            value={filtroSucursal}
            onChange={e => setFiltroSucursal(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600 border-none focus:ring-2 focus:ring-rose-500"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Resumen del día */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Resumen del día</h2>
            <span className="text-xs text-gray-400">{soloVentas.length} venta{soloVentas.length !== 1 ? 's' : ''}{soloNC.length > 0 ? ` · ${soloNC.length} NC` : ''}</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 mb-2">{formatPrecio(totalDia)}</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">
              Ventas: {formatPrecio(totalVentas)}
            </span>
            {soloNC.length > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                NC: {formatPrecio(totalNC)}
              </span>
            )}
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
              Empresa: {formatPrecio(totalEmpresa)}
            </span>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
              Prueba: {formatPrecio(totalPrueba)}
            </span>
          </div>
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

        {/* Botón reintentar todas en Centum */}
        {ventas.some(v => !v.centum_sync && !v.centum_comprobante) && (
          <button
            onClick={reenviarTodasCentum}
            disabled={reenvioMasivo}
            className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-medium text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {reenvioMasivo
              ? 'Enviando a Centum...'
              : `Reintentar Centum (${ventas.filter(v => !v.centum_sync && !v.centum_comprobante).length} pendientes)`
            }
          </button>
        )}

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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {v.tipo === 'nota_credito' ? (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-700">NC</span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">Venta</span>
                        )}
                        {v.numero_venta && (
                          <span className={`text-sm font-bold ${v.tipo === 'nota_credito' ? 'text-red-600' : 'text-blue-600'}`}>
                            #{v.numero_venta}
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-800">
                          {formatHora(v.created_at)}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          v.clasificacion === 'EMPRESA'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {v.clasificacion}
                        </span>
                        {v.sucursales?.nombre && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">
                            {v.sucursales.nombre}
                          </span>
                        )}
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
                        {v.centum_comprobante && (
                          <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
                            {v.centum_comprobante}
                          </span>
                        )}
                        {!v.centum_sync && !v.centum_comprobante && (
                          <button
                            onClick={(e) => reenviarCentum(e, v.id)}
                            disabled={reenviando === v.id}
                            className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-100 disabled:opacity-50 transition-colors"
                            title={v.centum_error || 'No sincronizada con Centum'}
                          >
                            {reenviando === v.id ? 'Enviando...' : v.centum_error ? 'Reintentar Centum' : 'Enviar a Centum'}
                          </button>
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
                      <span className={`text-base font-semibold ${v.tipo === 'nota_credito' ? 'text-red-600' : 'text-gray-800'}`}>{formatPrecio(v.total)}</span>
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
