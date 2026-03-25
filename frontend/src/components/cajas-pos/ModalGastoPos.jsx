// Modal para registrar un gasto de caja (POS)
import React, { useState } from 'react'
import api from '../../services/api'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const ModalGastoPos = ({ cierreId, cierre, gastosExistentes = [], onClose, onGastoCreado }) => {
  const [descripcion, setDescripcion] = useState('')
  const [importe, setImporte] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  const confirmarGasto = async () => {
    if (!descripcion.trim()) {
      setError('Ingresa una descripcion del gasto')
      return
    }
    const importeNum = parseFloat(importe)
    if (!importeNum || importeNum <= 0) {
      setError('El importe debe ser mayor a $0')
      return
    }
    setEnviando(true)
    setError('')
    try {
      const { data } = await api.post(`/api/cierres-pos/${cierreId}/gastos`, {
        descripcion: descripcion.trim(),
        importe: importeNum,
      })

      if (onGastoCreado) onGastoCreado(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear gasto')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Registrar gasto</h2>
            {cierre && (
              <p className="text-xs text-gray-500">Sesion POS · {cierre.caja?.nombre || ''}</p>
            )}
          </div>
          {importe && parseFloat(importe) > 0 && (
            <div className="text-right">
              <span className="text-xs text-gray-400">Importe</span>
              <p className="text-lg font-bold text-orange-600">{formatMonto(parseFloat(importe))}</p>
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Gastos ya registrados */}
          {gastosExistentes.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-orange-800 mb-2">
                Gastos ya registrados en este turno ({gastosExistentes.length}):
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {gastosExistentes.map((g, i) => (
                  <div key={g.id || i} className="flex items-center justify-between text-xs text-orange-700 bg-white/70 rounded-lg px-2 py-1">
                    <span className="truncate flex-1">{g.descripcion}</span>
                    <span className="font-medium ml-2 whitespace-nowrap">{formatMonto(g.importe)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-xs font-bold text-orange-800 text-right">
                Total: {formatMonto(gastosExistentes.reduce((s, g) => s + parseFloat(g.importe || 0), 0))}
              </div>
            </div>
          )}

          {/* Descripcion */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Descripcion del gasto</label>
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Compra de lapices en libreria"
              className="campo-form text-sm"
              autoFocus
            />
          </div>

          {/* Importe */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Importe</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmarGasto() }}
              placeholder="$0.00"
              className="campo-form text-sm"
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
              onClick={confirmarGasto}
              disabled={enviando}
              className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              {enviando ? 'Registrando...' : 'Confirmar gasto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModalGastoPos
