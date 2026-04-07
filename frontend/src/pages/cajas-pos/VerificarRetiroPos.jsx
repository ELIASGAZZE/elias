// Verificacion ciega de un retiro POS — gestor cuenta sin ver montos del cajero
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const VerificarRetiroPos = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [retiro, setRetiro] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState('')

  const [denomBilletes, setDenomBilletes] = useState([])
  const [denomMonedas, setDenomMonedas] = useState([])

  const [billetes, setBilletes] = useState({})
  const [monedas, setMonedas] = useState({})
  const [observaciones, setObservaciones] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const [retiroRes, denomRes] = await Promise.all([
          api.get(`/api/retiros-pos/${id}`),
          api.get('/api/denominaciones'),
        ])

        setRetiro(retiroRes.data)

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

  const totalVerificacion = totalBilletes + totalMonedas

  const enviarVerificacion = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setEnviando(true)
    setError('')
    try {
      await api.post(`/api/retiros-pos/${id}/verificar`, {
        billetes,
        monedas,
        total: totalVerificacion,
        observaciones,
      })

      // Navegar al detalle del cierre POS
      const cierreId = retiro.cierre_pos_id
      navigate(`/cajas-pos/cierre/${cierreId}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al enviar verificacion')
      submittingRef.current = false
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Retiro POS" sinTabs volverA="/cajas-pos" />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      </div>
    )
  }

  if (error && !retiro) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Retiro POS" sinTabs volverA="/cajas-pos" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  const volverA = retiro?.cierre_pos_id ? `/cajas-pos/cierre/${retiro.cierre_pos_id}` : '/cajas-pos'

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo={`Verificar Retiro POS #${retiro.numero}`} sinTabs volverA={volverA} />

      <div className="px-4 py-4 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl p-3 mb-3">
          <div className="text-sm text-teal-800">
            <p className="font-semibold">Retiro POS #{retiro.numero}</p>
            <p>
              {retiro.cierre?.caja?.nombre && `Caja: ${retiro.cierre.caja.nombre}`}
              {retiro.empleado?.nombre && ` · Empleado: ${retiro.empleado.nombre}`}
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-teal-600">Tu total</span>
            <p className="text-lg font-bold text-teal-700">{formatMonto(totalVerificacion)}</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm text-yellow-800">
          <p className="font-medium">Conteo independiente — no veras los montos del cajero hasta enviar.</p>
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

        {/* Resumen */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
          <div className="flex gap-6 text-sm">
            <div className="flex gap-2 text-gray-600">
              <span>Billetes:</span>
              <span className="font-medium">{formatMonto(totalBilletes)}</span>
            </div>
            <div className="flex gap-2 text-gray-600">
              <span>Monedas:</span>
              <span className="font-medium">{formatMonto(totalMonedas)}</span>
            </div>
            <div className="flex gap-2 text-teal-800 font-bold ml-auto">
              <span>Total:</span>
              <span>{formatMonto(totalVerificacion)}</span>
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

export default VerificarRetiroPos
