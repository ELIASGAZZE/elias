// Nuevo retiro de efectivo — solo billetes + monedas + empleado + observaciones
import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'
import { imprimirRetiro } from '../../utils/imprimirComprobante'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const NuevoRetiro = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [cierre, setCierre] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const [denomBilletes, setDenomBilletes] = useState([])
  const [denomMonedas, setDenomMonedas] = useState([])

  const [billetes, setBilletes] = useState({})
  const [monedas, setMonedas] = useState({})
  const [observaciones, setObservaciones] = useState('')

  // Código de empleado
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const [cierreRes, denomRes] = await Promise.all([
          api.get(`/api/cierres/${id}`),
          api.get('/api/denominaciones'),
        ])

        const cierreData = cierreRes.data
        setCierre(cierreData)
        if (cierreData.estado !== 'abierta') {
          setError('Solo se pueden crear retiros con la caja abierta')
        }

        const denomActivas = (denomRes.data || []).filter(d => d.activo)
        setDenomBilletes(denomActivas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden))
        setDenomMonedas(denomActivas.filter(d => d.tipo === 'moneda').sort((a, b) => a.orden - b.orden))
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar datos')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  const totalBilletes = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetes[d.valor] || 0), 0),
    [denomBilletes, billetes]
  )

  const totalMonedas = useMemo(
    () => denomMonedas.reduce((sum, d) => sum + d.valor * (monedas[d.valor] || 0), 0),
    [denomMonedas, monedas]
  )

  const totalRetiro = totalBilletes + totalMonedas

  const validarCodigoEmpleado = async () => {
    const codigo = codigoEmpleado.trim()
    if (!codigo) {
      setEmpleadoResuelto(null)
      setErrorEmpleado('')
      return
    }
    setValidandoEmpleado(true)
    setErrorEmpleado('')
    try {
      const { data } = await api.get(`/api/empleados/por-codigo/${encodeURIComponent(codigo)}`)
      setEmpleadoResuelto(data)
      setErrorEmpleado('')
    } catch {
      setEmpleadoResuelto(null)
      setErrorEmpleado('Código no válido')
    } finally {
      setValidandoEmpleado(false)
    }
  }

  const confirmarRetiro = async () => {
    if (!empleadoResuelto) {
      setError('Ingresá un código de empleado válido')
      return
    }
    if (totalRetiro <= 0) {
      setError('El retiro debe tener un monto mayor a $0')
      return
    }
    setEnviando(true)
    setError('')
    try {
      const billetesPayload = {}
      denomBilletes.forEach(d => {
        const cant = billetes[d.valor] || 0
        if (cant > 0) billetesPayload[String(d.valor)] = cant
      })

      const monedasPayload = {}
      denomMonedas.forEach(d => {
        const cant = monedas[d.valor] || 0
        if (cant > 0) monedasPayload[String(d.valor)] = cant
      })

      const { data } = await api.post(`/api/cierres/${id}/retiros`, {
        billetes: billetesPayload,
        monedas: monedasPayload,
        total: totalRetiro,
        observaciones,
        codigo_empleado: codigoEmpleado.trim(),
      })

      // Imprimir comprobante
      imprimirRetiro(data, cierre)

      navigate(`/cajas/cierre/${id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear retiro')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Nuevo Retiro" sinTabs volverA={`/cajas/cierre/${id}`} />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </div>
    )
  }

  if (error && !cierre) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Nuevo Retiro" sinTabs volverA="/cajas" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
          <Link to="/cajas" className="text-sm text-emerald-600 mt-4 inline-block">Volver</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Nuevo Retiro" sinTabs volverA={`/cajas/cierre/${id}`} />

      <div className="px-4 py-4 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4">
          <div className="text-sm text-emerald-800">
            <p className="font-semibold">Planilla #{cierre.planilla_id}</p>
            <p>Caja: {cierre.caja?.nombre || '-'} · Empleado: {cierre.empleado?.nombre || '-'} · {formatFecha(cierre.fecha)}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-emerald-600">Total retiro</span>
            <p className="text-lg font-bold text-emerald-700">{formatMonto(totalRetiro)}</p>
          </div>
        </div>

        {/* Grid 2 columnas: Billetes | Monedas */}
        <div className="grid grid-cols-2 gap-6 mb-6">
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

          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Monedas</h3>
            <div className="space-y-1.5">
              {denomMonedas.map(d => (
                <ContadorDenominacion
                  key={`m-${d.id}`}
                  valor={d.valor}
                  cantidad={monedas[d.valor] || 0}
                  onChange={(val) => setMonedas(prev => ({ ...prev, [d.valor]: val }))}
                />
              ))}
            </div>
            <div className="text-right mt-2">
              <span className="text-sm font-medium text-gray-600">Subtotal: {formatMonto(totalMonedas)}</span>
            </div>
          </div>
        </div>

        {/* Código de empleado */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Código de empleado que retira</label>
          <input
            type="text"
            value={codigoEmpleado}
            onChange={(e) => {
              setCodigoEmpleado(e.target.value)
              setEmpleadoResuelto(null)
              setErrorEmpleado('')
            }}
            onBlur={validarCodigoEmpleado}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validarCodigoEmpleado() } }}
            placeholder="Ingresá el código"
            className={`campo-form text-sm ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : ''}`}
          />
          {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
          {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
          {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
        </div>

        {/* Observaciones */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
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
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl mb-4">{error}</p>
        )}

        <button
          onClick={confirmarRetiro}
          disabled={enviando}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {enviando ? 'Creando retiro...' : 'Confirmar retiro'}
        </button>
      </div>
    </div>
  )
}

export default NuevoRetiro
