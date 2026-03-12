import React, { useState, useEffect } from 'react'
import api from '../services/api'

const EditarClienteModal = ({ cliente, onClose, onGuardado }) => {
  const [form, setForm] = useState({
    razon_social: '',
    cuit: '',
    condicion_iva: 'CF',
    telefono: '',
    email: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)

  useEffect(() => {
    if (!cliente?.id_centum) return
    // Cargar datos actuales del cliente
    api.get('/api/clientes', { params: { buscar: cliente.razon_social, limit: 1 } })
      .then(({ data }) => {
        const cli = (data.clientes || []).find(c => c.id_centum === cliente.id_centum)
        if (cli) {
          setForm({
            razon_social: cli.razon_social || '',
            cuit: cli.cuit || '',
            condicion_iva: cli.condicion_iva || 'CF',
            telefono: cli.celular || cli.telefono || '',
            email: cli.email || '',
          })
        }
      })
      .catch(() => {})
  }, [cliente])

  const actualizar = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
  }

  const guardar = async () => {
    if (!form.razon_social.trim()) {
      setError('La razón social es requerida')
      return
    }
    setGuardando(true)
    setError(null)
    setWarning(null)
    try {
      const payload = { ...form, celular: form.telefono }
      const { data } = await api.put(`/api/clientes/editar-centum/${cliente.id_centum}`, payload)
      if (data.warning_centum) {
        setWarning(data.warning_centum)
        setGuardando(false)
        return
      }
      onGuardado?.({
        ...cliente,
        razon_social: form.razon_social,
        email: form.email,
        celular: form.telefono,
      })
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">Editar cliente</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {warning && (
            <div className="text-sm bg-amber-50 border border-amber-300 rounded-lg px-3 py-3 space-y-2">
              <p className="text-amber-800 font-medium">Guardado local, pero hubo un problema con Centum</p>
              <p className="text-amber-700 text-xs">{warning}</p>
              <button
                onClick={() => { onGuardado?.({ ...cliente, razon_social: form.razon_social, email: form.email, celular: form.celular }); onClose() }}
                className="w-full py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                Entendido
              </button>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Razón Social *</label>
            <input
              type="text"
              value={form.razon_social}
              onChange={e => actualizar('razon_social', e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">CUIT / DNI</label>
            <input
              type="text"
              value={form.cuit}
              onChange={e => actualizar('cuit', e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Condición IVA</label>
            <select
              value={form.condicion_iva}
              onChange={e => actualizar('condicion_iva', e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
            >
              <option value="CF">Consumidor Final</option>
              <option value="RI">Responsable Inscripto</option>
              <option value="MT">Monotributista</option>
              <option value="EX">IVA Exento</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Teléfono / Celular</label>
            <input
              type="tel"
              value={form.telefono}
              onChange={e => actualizar('telefono', e.target.value)}
              placeholder="Ej: 341-1234567"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => actualizar('email', e.target.value)}
              placeholder="correo@ejemplo.com"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditarClienteModal
