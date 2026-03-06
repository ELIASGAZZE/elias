// Modal para resolver/explicar una diferencia en un cierre de caja
import React, { useState } from 'react'

const CAUSAS = [
  { value: 'factura_duplicada', label: 'Factura duplicada' },
  { value: 'venta_sin_confirmar', label: 'Venta sin confirmar' },
  { value: 'error_conteo', label: 'Error de conteo' },
  { value: 'redondeo', label: 'Redondeo' },
  { value: 'faltante_caja', label: 'Faltante de caja' },
  { value: 'sobrante_caja', label: 'Sobrante de caja' },
  { value: 'nota_credito', label: 'Nota de crédito' },
  { value: 'error_sistema', label: 'Error de sistema/ERP' },
  { value: 'retiro_no_registrado', label: 'Retiro no registrado' },
  { value: 'gasto_no_registrado', label: 'Gasto no registrado' },
  { value: 'otro', label: 'Otro' },
]

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const ResolverDiferenciaModal = ({ isOpen, onClose, onGuardar, tipoDiferencia, montoDiferencia, cierreId, sugerenciasIA, cargando }) => {
  const [causa, setCausa] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)

  if (!isOpen) return null

  const handleGuardar = async () => {
    if (!causa) return
    setGuardando(true)
    try {
      await onGuardar({
        cierre_id: cierreId,
        tipo_diferencia: tipoDiferencia,
        monto_diferencia: montoDiferencia || 0,
        causa,
        descripcion: descripcion.trim() || null,
      })
      setCausa('')
      setDescripcion('')
      onClose()
    } catch (err) {
      alert(err.message || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const aplicarSugerencia = (sug) => {
    setCausa(sug.causa)
    if (sug.descripcion) setDescripcion(sug.descripcion)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Resolver diferencia</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Info de la diferencia */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tipo</span>
              <span className="font-medium text-gray-800 capitalize">{tipoDiferencia?.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Monto</span>
              <span className={`font-bold ${montoDiferencia > 0 ? 'text-red-600' : montoDiferencia < 0 ? 'text-blue-600' : 'text-gray-800'}`}>
                {formatMonto(montoDiferencia)}
              </span>
            </div>
          </div>

          {/* Sugerencias de la IA */}
          {sugerenciasIA && sugerenciasIA.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-violet-700">Sugerencias de IA</p>
              <div className="flex flex-wrap gap-1.5">
                {sugerenciasIA.map((sug, idx) => (
                  <button
                    key={idx}
                    onClick={() => aplicarSugerencia(sug)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                      causa === sug.causa
                        ? 'bg-violet-100 border-violet-300 text-violet-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:text-violet-600'
                    }`}
                  >
                    {sug.label || CAUSAS.find(c => c.value === sug.causa)?.label || sug.causa}
                    {sug.confianza && <span className="ml-1 text-gray-400">({Math.round(sug.confianza * 100)}%)</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selector de causa */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Causa</label>
            <select
              value={causa}
              onChange={(e) => setCausa(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400"
            >
              <option value="">Seleccionar causa...</option>
              {CAUSAS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Descripción (opcional)</label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Se encontró factura duplicada #A-0001234 por $45.000"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 h-20 resize-none"
            />
          </div>
        </div>

        {/* Botones */}
        <div className="p-4 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={!causa || guardando}
            className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {guardando ? 'Guardando...' : 'Resolver'}
          </button>
        </div>
      </div>
    </div>
  )
}

export { CAUSAS }
export default ResolverDiferenciaModal
