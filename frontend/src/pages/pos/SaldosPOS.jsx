// Pantalla de Saldos a Favor — POS
// Admin: lista completa + editar saldos
// Gestor/Operario: buscador por DNI/CUIT → muestra saldo
import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const SaldosPOS = ({ embebido }) => {
  const { esAdmin } = useAuth()

  return esAdmin
    ? <VistaAdmin embebido={embebido} />
    : <VistaConsulta embebido={embebido} />
}

// ── Vista Admin: lista completa + editar ──
function VistaAdmin({ embebido }) {
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false)

  // Ajuste manual
  const [mostrarAjuste, setMostrarAjuste] = useState(false)
  const [ajusteMonto, setAjusteMonto] = useState('')
  const [ajusteMotivo, setAjusteMotivo] = useState('')
  const [ajustando, setAjustando] = useState(false)

  const cargarSaldos = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/pos/saldos', { params: busqueda ? { buscar: busqueda } : {} })
      setClientes(data.clientes || [])
    } catch (err) {
      console.error('Error cargando saldos:', err)
    } finally {
      setCargando(false)
    }
  }, [busqueda])

  useEffect(() => {
    const timeout = setTimeout(cargarSaldos, 300)
    return () => clearTimeout(timeout)
  }, [cargarSaldos])

  async function verDetalle(cliente) {
    setClienteSeleccionado(cliente)
    setMostrarAjuste(false)
    setAjusteMonto('')
    setAjusteMotivo('')
    setCargandoMovimientos(true)
    try {
      const { data } = await api.get(`/api/pos/saldo/${cliente.id_cliente_centum}`)
      setMovimientos(data.movimientos || [])
      if (data.saldo != null) {
        setClienteSeleccionado(prev => ({ ...prev, saldo: data.saldo }))
        setClientes(prev => prev.map(c =>
          c.id_cliente_centum === cliente.id_cliente_centum ? { ...c, saldo: data.saldo } : c
        ))
      }
    } catch (err) {
      console.error('Error cargando movimientos:', err)
    } finally {
      setCargandoMovimientos(false)
    }
  }

  async function handleAjuste() {
    if (!clienteSeleccionado || !ajusteMonto || !ajusteMotivo.trim()) return
    setAjustando(true)
    try {
      const { data } = await api.post('/api/pos/saldos/ajuste', {
        id_cliente_centum: clienteSeleccionado.id_cliente_centum,
        nombre_cliente: clienteSeleccionado.nombre_cliente,
        monto: parseFloat(ajusteMonto),
        motivo: ajusteMotivo.trim(),
      })
      // Actualizar saldo y recargar movimientos
      setClienteSeleccionado(prev => ({ ...prev, saldo: data.saldo }))
      setClientes(prev => prev.map(c =>
        c.id_cliente_centum === clienteSeleccionado.id_cliente_centum ? { ...c, saldo: data.saldo } : c
      ))
      setAjusteMonto('')
      setAjusteMotivo('')
      setMostrarAjuste(false)
      // Recargar movimientos
      const { data: detalle } = await api.get(`/api/pos/saldo/${clienteSeleccionado.id_cliente_centum}`)
      setMovimientos(detalle.movimientos || [])
    } catch (err) {
      alert(err.response?.data?.error || 'Error al ajustar saldo')
    } finally {
      setAjustando(false)
    }
  }

  return (
    <div className={embebido ? 'h-full bg-gray-50 flex flex-col overflow-hidden' : 'min-h-screen bg-gray-50'}>
      {!embebido && (
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a href="/apps" className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                </svg>
              </a>
              <h1 className="text-lg font-bold text-gray-800">Saldos a Favor</h1>
            </div>
            <button onClick={cargarSaldos} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
              Actualizar
            </button>
          </div>
        </div>
      )}

      <div className={embebido ? 'px-4 pt-3' : 'max-w-4xl mx-auto px-4 pt-4'}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-500 font-medium">{clientes.length} cliente{clientes.length !== 1 ? 's' : ''} con saldo</span>
          {embebido && (
            <button onClick={cargarSaldos} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
              Actualizar
            </button>
          )}
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre de cliente..."
            className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={embebido ? 'flex-1 overflow-y-auto px-4 py-3' : 'max-w-4xl mx-auto px-4 py-4'}>
        {cargando ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Cargando saldos...
          </div>
        ) : clientes.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
            {busqueda ? 'Sin resultados para la búsqueda' : 'No hay clientes con saldo a favor'}
          </div>
        ) : (
          <div className="space-y-2">
            {clientes.map(cli => (
              <div
                key={cli.id_cliente_centum}
                onClick={() => verDetalle(cli)}
                className="bg-white rounded-xl border shadow-sm p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-800">{cli.nombre_cliente}</span>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Ultima actividad: {new Date(cli.ultima_actividad).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </div>
                  </div>
                  <span className="text-lg font-bold text-emerald-600">{formatPrecio(cli.saldo)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawer detalle movimientos + ajuste */}
      {clienteSeleccionado && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setClienteSeleccionado(null)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
              <div>
                <h2 className="text-lg font-bold text-gray-800">{clienteSeleccionado.nombre_cliente}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-gray-500">Saldo:</span>
                  <span className="text-lg font-bold text-emerald-600">{formatPrecio(clienteSeleccionado.saldo)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMostrarAjuste(!mostrarAjuste)}
                  className={`p-2 rounded-lg transition-colors ${mostrarAjuste ? 'bg-violet-100 text-violet-700' : 'hover:bg-gray-200 text-gray-500'}`}
                  title="Ajustar saldo"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button onClick={() => setClienteSeleccionado(null)} className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Formulario de ajuste */}
            {mostrarAjuste && (
              <div className="px-5 py-4 border-b bg-violet-50 space-y-3">
                <h3 className="text-sm font-semibold text-violet-800">Ajuste manual de saldo</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Monto (+ agrega, - quita)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={ajusteMonto}
                      onChange={e => setAjusteMonto(e.target.value)}
                      className="w-full text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                      placeholder="Ej: 500 o -200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Motivo</label>
                    <input
                      type="text"
                      value={ajusteMotivo}
                      onChange={e => setAjusteMotivo(e.target.value)}
                      className="w-full text-sm border rounded-lg px-3 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                      placeholder="Motivo del ajuste..."
                    />
                  </div>
                </div>
                <button
                  onClick={handleAjuste}
                  disabled={ajustando || !ajusteMonto || !ajusteMotivo.trim()}
                  className="w-full text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white py-2 rounded-lg transition-colors"
                >
                  {ajustando ? 'Aplicando...' : 'Aplicar ajuste'}
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Historial de movimientos</div>
              {cargandoMovimientos ? (
                <div className="flex items-center justify-center py-8 text-gray-400">
                  <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Cargando...
                </div>
              ) : movimientos.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">Sin movimientos</div>
              ) : (
                <div className="space-y-2">
                  {movimientos.map(mov => {
                    const esCredito = parseFloat(mov.monto) > 0
                    return (
                      <div key={mov.id} className={`rounded-lg border p-3 ${esCredito ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">{mov.motivo}</span>
                          <span className={`text-sm font-bold ${esCredito ? 'text-emerald-600' : 'text-red-600'}`}>
                            {esCredito ? '+' : ''}{formatPrecio(parseFloat(mov.monto))}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          {new Date(mov.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                          {new Date(mov.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
    </div>
  )
}

// ── Vista Consulta (Gestor/Operario): solo buscar por DNI/CUIT ──
function VistaConsulta({ embebido }) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [buscado, setBuscado] = useState(false)

  async function handleBuscar(e) {
    e?.preventDefault()
    const termino = busqueda.trim()
    if (termino.length < 3) return
    setBuscando(true)
    setBuscado(false)
    try {
      const { data } = await api.get('/api/pos/saldos/buscar-cuit', { params: { cuit: termino } })
      setResultados(data.clientes || [])
      setBuscado(true)
    } catch (err) {
      console.error('Error buscando saldo:', err)
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className={embebido ? 'h-full bg-gray-50 flex flex-col overflow-hidden' : 'min-h-screen bg-gray-50'}>
      {!embebido && (
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3">
            <h1 className="text-lg font-bold text-gray-800">Consultar Saldo</h1>
          </div>
        </div>
      )}

      <div className={embebido ? 'px-4 pt-4' : 'max-w-md mx-auto px-4 pt-8'}>
        <div className="text-center mb-6">
          <svg className="w-12 h-12 mx-auto mb-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="text-sm text-gray-500">Ingresá el DNI o CUIT del cliente para consultar su saldo</p>
        </div>

        <form onSubmit={handleBuscar} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="DNI o CUIT..."
              className="w-full text-sm border rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={buscando || busqueda.trim().length < 3}
            className="px-4 py-2.5 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {/* Resultados */}
        <div className="mt-6">
          {buscando && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Buscando...
            </div>
          )}

          {!buscando && buscado && resultados.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              No se encontraron clientes con ese DNI/CUIT
            </div>
          )}

          {!buscando && resultados.length > 0 && (
            <div className="space-y-3">
              {resultados.map(cli => (
                <div key={cli.id_cliente_centum} className="bg-white rounded-xl border shadow-sm p-5">
                  <div className="text-sm font-semibold text-gray-800">{cli.nombre_cliente}</div>
                  {cli.cuit && (
                    <div className="text-xs text-gray-400 mt-0.5">CUIT: {cli.cuit}</div>
                  )}
                  <div className="mt-3 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                    <span className="text-sm text-gray-600">Saldo a favor:</span>
                    <span className={`text-xl font-bold ${cli.saldo > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {formatPrecio(cli.saldo)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SaldosPOS
