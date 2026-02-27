import React from 'react'

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const ContadorDenominacion = ({ valor, cantidad, onChange, prefijo = '$', alerta = false }) => {
  const total = valor * cantidad
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1 ${alerta ? 'bg-red-50 border border-red-400' : 'bg-white border border-gray-200'}`}>
      <div className="min-w-[80px]">
        <span className="text-sm font-semibold text-gray-800">{prefijo}{valor.toLocaleString('es-AR')}</span>
        {cantidad > 0 && (
          <span className="text-xs text-gray-400 ml-1.5">= {formatMonto(total)}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, cantidad - 1))}
          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center transition-colors"
        >
          -
        </button>
        <input
          type="number"
          min="0"
          value={cantidad || ''}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-12 text-center text-sm font-medium border border-gray-200 rounded-lg py-1 focus:outline-none focus:border-emerald-400"
          placeholder="0"
        />
        <button
          type="button"
          onClick={() => onChange(cantidad + 1)}
          className="w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold text-sm flex items-center justify-center transition-colors"
        >
          +
        </button>
      </div>
    </div>
  )
}

export default ContadorDenominacion
