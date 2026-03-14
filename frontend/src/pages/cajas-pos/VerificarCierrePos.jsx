// Verificacion ciega POS — gestor cuenta sin ver montos del cajero — layout desktop 2 columnas
import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatHora = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const CampoMedio = ({ label, monto, onMontoChange, cantidad, onCantidadChange }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="text-xs text-gray-400">Monto total</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={monto || ''}
          onChange={(e) => onMontoChange(parseFloat(e.target.value) || 0)}
          className="campo-form text-sm"
          placeholder="$0.00"
        />
      </div>
      <div className="w-24">
        <label className="text-xs text-gray-400">Cantidad</label>
        <input
          type="number"
          min="0"
          value={cantidad || ''}
          onChange={(e) => onCantidadChange(parseInt(e.target.value) || 0)}
          className="campo-form text-sm"
          placeholder="0"
        />
      </div>
    </div>
  </div>
)

const VerificarCierrePos = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [cierre, setCierre] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Dynamic config from API
  const [denomBilletes, setDenomBilletes] = useState([])
  const [denomMonedas, setDenomMonedas] = useState([])
  const [formasCobro, setFormasCobro] = useState([])

  // Gastos
  const [gastos, setGastos] = useState([])
  const [controlandoGasto, setControlandoGasto] = useState(null)

  // Efectivo
  const [billetes, setBilletes] = useState({})
  const [monedas, setMonedas] = useState({})

  // Otros medios (dynamic, keyed by forma_cobro_id)
  const [mediosPago, setMediosPago] = useState({})
  const [observaciones, setObservaciones] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const [cierreRes, denomRes, formasRes, gastosRes] = await Promise.all([
          api.get(`/api/cierres-pos/${id}`),
          api.get('/api/denominaciones'),
          api.get('/api/formas-cobro'),
          api.get(`/api/cierres-pos/${id}/gastos`).catch(() => ({ data: [] })),
        ])

        setGastos(gastosRes.data || [])

        setCierre(cierreRes.data)
        if (cierreRes.data.estado !== 'pendiente_gestor') {
          setError('Este cierre ya fue verificado')
        }

        // Filter active, split by tipo, sort by orden
        const denomActivas = (denomRes.data || []).filter(d => d.activo)
        setDenomBilletes(denomActivas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden))
        setDenomMonedas(denomActivas.filter(d => d.tipo === 'moneda').sort((a, b) => a.orden - b.orden))

        // Filter active formas_cobro, sort by orden
        const formasActivas = (formasRes.data || []).filter(f => f.activo).sort((a, b) => a.orden - b.orden)
        setFormasCobro(formasActivas)

        // Initialize mediosPago state for each forma_cobro
        const mediosInit = {}
        formasActivas.forEach(f => {
          mediosInit[f.id] = { monto: 0, cantidad: 0 }
        })
        setMediosPago(mediosInit)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar datos')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  const totalBilletes = useMemo(() =>
    denomBilletes.reduce((sum, d) => sum + d.valor * (billetes[d.valor] || 0), 0),
    [denomBilletes, billetes]
  )
  const totalMonedas = useMemo(() =>
    denomMonedas.reduce((sum, d) => sum + d.valor * (monedas[d.valor] || 0), 0),
    [denomMonedas, monedas]
  )
  const totalEfectivo = totalBilletes + totalMonedas

  const totalOtrosMedios = useMemo(() =>
    Object.values(mediosPago).reduce((sum, m) => sum + (m.monto || 0), 0),
    [mediosPago]
  )
  const totalGeneral = totalEfectivo + totalOtrosMedios

  const toggleControlarGasto = async (gastoId, controlado) => {
    setControlandoGasto(gastoId)
    try {
      const { data } = await api.put(`/api/gastos-pos/${gastoId}/controlar`, { controlado: !controlado })
      setGastos(prev => prev.map(g => g.id === gastoId ? { ...g, ...data } : g))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al controlar gasto')
    } finally {
      setControlandoGasto(null)
    }
  }

  const actualizarMedio = (formaCobroId, campo, valor) => {
    setMediosPago(prev => ({
      ...prev,
      [formaCobroId]: { ...prev[formaCobroId], [campo]: valor },
    }))
  }

  // Delivery: solo un campo de monto recibido
  const [efectivoDelivery, setEfectivoDelivery] = useState('')
  const esDelivery = cierre?.tipo === 'delivery'

  const enviarVerificacion = async () => {
    setEnviando(true)
    setError('')
    try {
      if (esDelivery) {
        const montoRecibido = parseFloat(efectivoDelivery) || 0
        await api.post(`/api/cierres-pos/${id}/verificar`, {
          billetes: {},
          monedas: {},
          total_efectivo: montoRecibido,
          medios_pago: [],
          total_general: montoRecibido,
          observaciones,
        })
      } else {
        // Build medios_pago array — only entries with monto > 0
        const mediosPagoArray = formasCobro
          .filter(f => (mediosPago[f.id]?.monto || 0) > 0)
          .map(f => ({
            forma_cobro_id: f.id,
            nombre: f.nombre,
            monto: mediosPago[f.id].monto,
            cantidad: mediosPago[f.id].cantidad,
          }))

        await api.post(`/api/cierres-pos/${id}/verificar`, {
          billetes,
          monedas,
          total_efectivo: totalEfectivo,
          medios_pago: mediosPagoArray,
          total_general: totalGeneral,
          observaciones,
        })
      }
      navigate(`/cajas-pos/cierre/${id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al enviar verificacion')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Cierre POS" sinTabs volverA="/cajas-pos" />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      </div>
    )
  }

  if (error && !cierre) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Cierre POS" sinTabs volverA="/cajas-pos" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  // ── Delivery: vista simplificada ──
  if (esDelivery) {
    return (
      <div className="min-h-screen bg-gray-50 pb-6">
        <Navbar titulo="Verificar Delivery" sinTabs volverA="/cajas-pos" />

        <div className="px-4 py-4 max-w-lg mx-auto space-y-4">

          {/* Header delivery */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
              </svg>
              <span className="font-semibold text-purple-800">{cierre.observaciones_apertura || 'Delivery'}</span>
            </div>
            <p className="text-sm text-purple-700">{cierre.observaciones || ''}</p>
          </div>

          {/* Total esperado */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500 mb-1">Total que el repartidor debe dejar</p>
            <p className="text-3xl font-bold text-gray-800">{formatMonto(cierre.total_efectivo)}</p>
            {cierre.fondo_fijo > 0 && (
              <p className="text-xs text-gray-400 mt-1">Cambio entregado: {formatMonto(cierre.fondo_fijo)}</p>
            )}
          </div>

          {/* Campo: cuanto recibiste */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <label className="text-sm font-medium text-gray-700 mb-2 block">Efectivo recibido del repartidor</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={efectivoDelivery}
              onChange={(e) => setEfectivoDelivery(e.target.value)}
              className="campo-form text-lg font-semibold text-center"
              placeholder="$0.00"
              autoFocus
            />
          </div>

          {/* Observaciones */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <label className="text-sm font-medium text-gray-700 mb-1 block">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="campo-form text-sm"
              rows={2}
              placeholder="Observaciones opcionales..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>
          )}

          <button
            onClick={enviarVerificacion}
            disabled={enviando || !efectivoDelivery}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
          >
            {enviando ? 'Enviando...' : 'Confirmar recepcion'}
          </button>
        </div>
      </div>
    )
  }

  // ── Regular: vista completa ──
  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Verificar Cierre POS" sinTabs volverA="/cajas-pos" />

      <div className="px-4 py-4 max-w-5xl mx-auto">

        {/* Header: info del cierre + total efectivo */}
        <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl p-3 mb-3">
          <div className="text-sm text-teal-800">
            <p className="font-semibold">Sesion POS</p>
            <p>Caja: {cierre.caja?.nombre || ''} · Empleado: {cierre.empleado?.nombre || ''}{cierre.apertura_at ? ` · Apertura: ${formatHora(cierre.apertura_at)}` : ''}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-teal-600">Total efectivo</span>
            <p className="text-lg font-bold text-teal-700">{formatMonto(totalEfectivo)}</p>
          </div>
        </div>

        {/* Warning banner — blind verification */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm text-yellow-800">
          <p className="font-medium">Conteo independiente — no veras los montos del cajero hasta enviar.</p>
        </div>

        {/* Grid 2 columnas: Billetes | Medios */}
        <div className="grid grid-cols-2 gap-6 mb-6">

          {/* Col 1: Billetes */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Billetes</h3>
            <div className="space-y-1.5">
              {denomBilletes.map(d => (
                <ContadorDenominacion
                  key={`b-${d.id}`}
                  valor={d.valor}
                  cantidad={billetes[d.valor] || 0}
                  onChange={(val) => setBilletes(prev => ({ ...prev, [d.valor]: val }))}
                />
              ))}
            </div>
            <div className="text-right mt-2">
              <span className="text-sm font-medium text-gray-600">Subtotal: {formatMonto(totalBilletes)}</span>
            </div>
          </div>

          {/* Col 2: Otros medios + Observaciones */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Otros medios de pago</h3>
            {formasCobro.map(f => (
              <CampoMedio
                key={f.id}
                label={f.nombre}
                monto={mediosPago[f.id]?.monto || 0}
                onMontoChange={(val) => actualizarMedio(f.id, 'monto', val)}
                cantidad={mediosPago[f.id]?.cantidad || 0}
                onCantidadChange={(val) => actualizarMedio(f.id, 'cantidad', val)}
              />
            ))}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Observaciones</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="campo-form text-sm"
                rows={2}
                placeholder="Observaciones opcionales..."
              />
            </div>
          </div>
        </div>

        {/* Gastos — checkboxes de control */}
        {gastos.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 space-y-3">
            <h3 className="text-sm font-semibold text-orange-800">
              Gastos a controlar ({gastos.length})
            </h3>
            <p className="text-xs text-orange-600">Marca cada gasto como controlado para confirmar que fue verificado.</p>
            <div className="space-y-2">
              {gastos.map(g => (
                <div key={g.id} className="flex items-center gap-3 bg-white border border-orange-100 rounded-lg p-3">
                  <button
                    onClick={() => toggleControlarGasto(g.id, g.controlado)}
                    disabled={controlandoGasto === g.id}
                    className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                      g.controlado
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-orange-300 hover:border-orange-500'
                    } ${controlandoGasto === g.id ? 'opacity-50' : ''}`}
                  >
                    {g.controlado && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-800">{g.descripcion}</span>
                  </div>
                  <span className="text-sm font-bold text-orange-700 flex-shrink-0">{formatMonto(g.importe)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-orange-200 pt-2 flex justify-between text-sm font-medium">
              <span className="text-orange-800">Total gastos</span>
              <span className="text-orange-700 font-bold">{formatMonto(gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0))}</span>
            </div>
            {gastos.some(g => !g.controlado) && (
              <div className="bg-orange-100 border border-orange-300 rounded-lg p-2 text-xs text-orange-800 font-medium text-center">
                {gastos.filter(g => !g.controlado).length} gasto(s) pendiente(s) de control
              </div>
            )}
          </div>
        )}

        {/* Resumen + boton confirmar — ancho completo */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-teal-800 mb-2">Resumen de tu verificacion</h3>
          <div className="flex gap-6 text-sm">
            <div className="flex gap-2 text-gray-600">
              <span>Total efectivo:</span>
              <span className="font-medium">{formatMonto(totalEfectivo)}</span>
            </div>
            {totalOtrosMedios > 0 && (
              <div className="flex gap-2 text-gray-600">
                <span>Otros medios:</span>
                <span className="font-medium">{formatMonto(totalOtrosMedios)}</span>
              </div>
            )}
            <div className="flex gap-2 text-teal-800 font-bold ml-auto">
              <span>Total general:</span>
              <span>{formatMonto(totalGeneral)}</span>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl mb-4">{error}</p>
        )}

        <button
          onClick={enviarVerificacion}
          disabled={enviando}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {enviando ? 'Enviando...' : 'Enviar verificacion'}
        </button>
      </div>
    </div>
  )
}

export default VerificarCierrePos
