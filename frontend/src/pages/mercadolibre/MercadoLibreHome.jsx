// Dashboard principal del módulo Mercado Libre
import React, { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../../services/api'

const formatMoney = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)

const MercadoLibreHome = () => {
  const [searchParams] = useSearchParams()
  const [dashboard, setDashboard] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  // Mostrar mensaje si volvió del callback OAuth
  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setMensaje({ tipo: 'ok', texto: 'Cuenta de Mercado Libre conectada exitosamente' })
    }
    if (searchParams.get('error')) {
      setMensaje({ tipo: 'error', texto: `Error al conectar: ${searchParams.get('error')}` })
    }
  }, [searchParams])

  const cargarDashboard = () => {
    setCargando(true)
    api.get('/api/mercadolibre/dashboard')
      .then(({ data }) => setDashboard(data))
      .catch(() => setDashboard(null))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargarDashboard() }, [])

  const conectarML = async () => {
    try {
      const { data } = await api.get('/api/mercadolibre/auth')
      window.location.href = data.url
    } catch (err) {
      setMensaje({ tipo: 'error', texto: 'Error al iniciar conexión con ML' })
    }
  }

  const desconectar = async () => {
    if (!confirm('¿Desconectar la cuenta de Mercado Libre?')) return
    try {
      await api.post('/api/mercadolibre/desconectar')
      cargarDashboard()
      setMensaje({ tipo: 'ok', texto: 'Cuenta desconectada' })
    } catch {
      setMensaje({ tipo: 'error', texto: 'Error al desconectar' })
    }
  }

  const syncOrdenes = async () => {
    setSincronizando(true)
    try {
      const { data } = await api.post('/api/mercadolibre/ordenes/sync', { dias: 30 })
      setMensaje({ tipo: 'ok', texto: `${data.sincronizadas} órdenes sincronizadas` })
      cargarDashboard()
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al sincronizar' })
    } finally {
      setSincronizando(false)
    }
  }

  const conectado = dashboard?.conexion?.conectado

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/apps" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="font-bold text-gray-800 text-lg">Mercado Libre</h1>
            <p className="text-xs text-gray-400">CRM & Gestión de ventas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conectado && (
            <>
              <button
                onClick={syncOrdenes}
                disabled={sincronizando}
                className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
              >
                <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
              </button>
              <button
                onClick={desconectar}
                className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
              >
                Desconectar
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Mensaje */}
      {mensaje && (
        <div className={`mx-4 mt-4 p-3 rounded-lg text-sm ${
          mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {mensaje.texto}
          <button onClick={() => setMensaje(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* No conectado */}
        {!conectado && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Conectá tu cuenta de Mercado Libre</h2>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Autorizá el acceso para sincronizar tus ventas, gestionar preguntas, reclamos y devoluciones desde acá.
            </p>
            <button
              onClick={conectarML}
              className="px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-xl transition-colors"
            >
              Conectar con Mercado Libre
            </button>
          </div>
        )}

        {/* Dashboard conectado */}
        {conectado && dashboard?.metricas && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <KpiCard
                titulo="Ventas (7 días)"
                valor={dashboard.metricas.ultimos_7_dias.pagadas}
                subtexto={formatMoney(dashboard.metricas.ultimos_7_dias.facturacion)}
                color="bg-yellow-500"
              />
              <KpiCard
                titulo="Ventas (30 días)"
                valor={dashboard.metricas.ultimos_30_dias.pagadas}
                subtexto={formatMoney(dashboard.metricas.ultimos_30_dias.facturacion)}
                color="bg-blue-500"
              />
              <KpiCard
                titulo="Órdenes totales"
                valor={dashboard.metricas.total_ordenes}
                subtexto="sincronizadas"
                color="bg-emerald-500"
              />
              <KpiCard
                titulo="Seller ID"
                valor={dashboard.conexion.seller_id}
                subtexto="Conectado"
                color="bg-green-500"
                esTexto
              />
            </div>

            {/* Estado por tipo */}
            {dashboard.metricas.por_estado && Object.keys(dashboard.metricas.por_estado).length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
                <h3 className="font-semibold text-gray-800 mb-4">Órdenes por estado</h3>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(dashboard.metricas.por_estado).map(([estado, cantidad]) => (
                    <div key={estado} className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        estado === 'paid' ? 'bg-green-500' :
                        estado === 'cancelled' ? 'bg-red-500' :
                        'bg-gray-400'
                      }`} />
                      <span className="text-sm text-gray-600 capitalize">{estado}</span>
                      <span className="text-sm font-bold text-gray-800">{cantidad}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Accesos rápidos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <AccesoRapido
                titulo="Ventas"
                descripcion="Ver todas las órdenes sincronizadas"
                path="/mercadolibre/ventas"
                color="bg-yellow-500"
                icono={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                  </svg>
                }
              />
              <AccesoRapido
                titulo="Preguntas"
                descripcion="Gestionar preguntas de compradores"
                path="/mercadolibre/preguntas"
                color="bg-blue-500"
                proximamente
                icono={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                  </svg>
                }
              />
              <AccesoRapido
                titulo="Reclamos"
                descripcion="Gestionar reclamos y devoluciones"
                path="/mercadolibre/reclamos"
                color="bg-red-500"
                proximamente
                icono={
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                }
              />
            </div>
          </>
        )}

        {/* Conectado pero sin métricas (primera vez) */}
        {conectado && !dashboard?.metricas && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <h3 className="font-semibold text-gray-800 mb-2">Cuenta conectada</h3>
            <p className="text-gray-500 mb-4">Sincronizá tus órdenes para empezar a ver las métricas.</p>
            <button
              onClick={syncOrdenes}
              disabled={sincronizando}
              className="px-5 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold rounded-xl disabled:opacity-50"
            >
              {sincronizando ? 'Sincronizando...' : 'Sincronizar órdenes (últimos 30 días)'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Componente KPI
const KpiCard = ({ titulo, valor, subtexto, color, esTexto }) => (
  <div className="bg-white rounded-2xl border border-gray-200 p-5">
    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{titulo}</p>
    <p className={`${esTexto ? 'text-lg' : 'text-2xl'} font-bold text-gray-800`}>{valor}</p>
    <p className="text-xs text-gray-400 mt-1">{subtexto}</p>
  </div>
)

// Componente acceso rápido
const AccesoRapido = ({ titulo, descripcion, path, color, icono, proximamente }) => {
  const content = (
    <div className={`bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-md transition-all ${proximamente ? 'opacity-60' : 'cursor-pointer'}`}>
      <div className="flex items-start gap-4">
        <div className={`${color} text-white w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0`}>
          {icono}
        </div>
        <div>
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            {titulo}
            {proximamente && <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Próximamente</span>}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">{descripcion}</p>
        </div>
      </div>
    </div>
  )

  if (proximamente) return content
  return <Link to={path}>{content}</Link>
}

export default MercadoLibreHome
