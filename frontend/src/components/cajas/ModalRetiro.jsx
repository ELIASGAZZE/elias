// Modal para crear un retiro de alivio de efectivo
import React, { useState, useEffect, useMemo } from 'react'
import ContadorDenominacion from './ContadorDenominacion'
import api from '../../services/api'
import { imprimirRetiro } from '../../utils/imprimirComprobante'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const ModalRetiro = ({ cierreId, cierre, onClose, onRetiroCreado }) => {
  const [denomBilletes, setDenomBilletes] = useState([])
  const [billetes, setBilletes] = useState({})
  const [observaciones, setObservaciones] = useState('')
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/denominaciones')
        const activas = (data || []).filter(d => d.activo)
        setDenomBilletes(activas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden))
      } catch (err) {
        setError('Error al cargar denominaciones')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  const totalRetiro = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetes[d.valor] || 0), 0),
    [denomBilletes, billetes]
  )

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

      const { data } = await api.post(`/api/cierres/${cierreId}/retiros`, {
        billetes: billetesPayload,
        monedas: {},
        total: totalRetiro,
        observaciones,
        codigo_empleado: codigoEmpleado.trim(),
      })

      // Imprimir comprobante
      imprimirRetiro(data, cierre)

      if (onRetiroCreado) onRetiroCreado(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear retiro')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Retiro de alivio</h2>
            {cierre && (
              <p className="text-xs text-gray-500">Planilla #{cierre.planilla_id} · {cierre.caja?.nombre || ''}</p>
            )}
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-400">Total</span>
            <p className="text-lg font-bold text-emerald-700">{formatMonto(totalRetiro)}</p>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {cargando ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
            </div>
          ) : (
            <>
              {/* Denominaciones */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Billetes a retirar</h3>
                <div className="space-y-1.5">
                  {denomBilletes.map(d => (
                    <ContadorDenominacion
                      key={`r-${d.id}`}
                      valor={d.valor}
                      cantidad={billetes[d.valor] || 0}
                      onChange={(val) => setBilletes(prev => ({ ...prev, [d.valor]: val }))}
                    />
                  ))}
                </div>
              </div>

              {/* Código de empleado */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Código de empleado que retira</label>
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

              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>
              )}

              {/* Botones */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-100 py-2.5 rounded-xl font-medium transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarRetiro}
                  disabled={enviando}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors text-sm"
                >
                  {enviando ? 'Creando...' : 'Confirmar retiro'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ModalRetiro
