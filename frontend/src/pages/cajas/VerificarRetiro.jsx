// Verificación ciega de un retiro — gestor cuenta sin ver montos del cajero
import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const VerificarRetiro = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [retiro, setRetiro] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
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
          api.get(`/api/retiros/${id}`),
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
    setEnviando(true)
    setError('')
    try {
      await api.post(`/api/retiros/${id}/verificar`, {
        billetes,
        monedas,
        total: totalVerificacion,
        observaciones,
      })

      // Navegar al detalle del cierre
      const cierreId = retiro.cierre_id
      navigate(`/cajas/cierre/${cierreId}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al enviar verificación')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Retiro" sinTabs volverA="/cajas" />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </div>
    )
  }

  if (error && !retiro) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Verificar Retiro" sinTabs volverA="/cajas" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  const volverA = retiro?.cierre_id ? `/cajas/cierre/${retiro.cierre_id}` : '/cajas'

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo={`Verificar Retiro #${retiro.numero}`} sinTabs volverA={volverA} />

      <div className="px-4 py-4 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
          <div className="text-sm text-emerald-800">
            <p className="font-semibold">Retiro #{retiro.numero}</p>
            <p>
              {retiro.cierre?.caja?.nombre && `Caja: ${retiro.cierre.caja.nombre}`}
              {retiro.empleado?.nombre && ` · Empleado: ${retiro.empleado.nombre}`}
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-emerald-600">Tu total</span>
            <p className="text-lg font-bold text-emerald-700">{formatMonto(totalVerificacion)}</p>
          </div>
        </div>

        {/* Warning banner */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm text-yellow-800">
          <p className="font-medium">Conteo independiente — no verás los montos del cajero hasta enviar.</p>
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
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4">
          <div className="flex gap-6 text-sm">
            <div className="flex gap-2 text-gray-600">
              <span>Billetes:</span>
              <span className="font-medium">{formatMonto(totalBilletes)}</span>
            </div>
            <div className="flex gap-2 text-gray-600">
              <span>Monedas:</span>
              <span className="font-medium">{formatMonto(totalMonedas)}</span>
            </div>
            <div className="flex gap-2 text-emerald-800 font-bold ml-auto">
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
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {enviando ? 'Enviando...' : 'Enviar verificación'}
        </button>
      </div>
    </div>
  )
}

export default VerificarRetiro
