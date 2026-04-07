import React, { useState, useEffect, useCallback } from 'react'
import api from '../../services/api'

const LABELS_ACCION = {
  crear: 'Creación',
  editar: 'Edición',
  contacto: 'Contacto actualizado',
  sync_centum: 'Sync Centum',
  refresh: 'Refresh Centum',
  importar: 'Importación',
  desactivar: 'Desactivación',
  reactivar: 'Reactivación',
  resolver_duplicado: 'Duplicado resuelto',
  exportar_centum: 'Exportado a Centum',
}

const LABELS_ORIGEN = {
  admin: 'Admin',
  pos: 'POS',
  api_sync: 'API Sync',
  cron: 'Automático',
  centum_bi: 'Centum BI',
}

const COLORS_ACCION = {
  crear: 'bg-green-100 text-green-700',
  editar: 'bg-blue-100 text-blue-700',
  contacto: 'bg-cyan-100 text-cyan-700',
  sync_centum: 'bg-purple-100 text-purple-700',
  refresh: 'bg-purple-100 text-purple-700',
  importar: 'bg-yellow-100 text-yellow-700',
  desactivar: 'bg-red-100 text-red-700',
  reactivar: 'bg-green-100 text-green-700',
  resolver_duplicado: 'bg-orange-100 text-orange-700',
  exportar_centum: 'bg-indigo-100 text-indigo-700',
}

const LABELS_CAMPO = {
  razon_social: 'Razón Social',
  cuit: 'CUIT',
  condicion_iva: 'Cond. IVA',
  direccion: 'Dirección',
  localidad: 'Localidad',
  codigo_postal: 'Cód. Postal',
  provincia: 'Provincia',
  telefono: 'Teléfono',
  email: 'Email',
  celular: 'Celular',
  grupo_descuento_id: 'Grupo Descuento',
  activo: 'Activo',
  id_centum: 'ID Centum',
  codigo_centum: 'Cód. Centum',
}

export default function ModalAuditoriaCliente({ cliente, onClose }) {
  const [registros, setRegistros] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [cargando, setCargando] = useState(false)

  const LIMIT = 20
  const totalPaginas = Math.ceil(total / LIMIT)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get(`/api/clientes/${cliente.id}/auditoria?page=${page}&limit=${LIMIT}`)
      setRegistros(data.registros || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Error cargando auditoría:', err)
    } finally {
      setCargando(false)
    }
  }, [cliente.id, page])

  useEffect(() => {
    cargar()
  }, [cargar])

  const formatFecha = (iso) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const formatValor = (val) => {
    if (val === null || val === undefined || val === '') return '(vacío)'
    if (val === true) return 'Sí'
    if (val === false) return 'No'
    return String(val)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800">Auditoría de cliente</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {cliente.razon_social} — {cliente.codigo}
              {cliente.cuit ? ` — ${cliente.cuit}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {cargando ? (
            <div className="text-center py-12 text-gray-400">Cargando historial...</div>
          ) : registros.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Sin registros de auditoría</div>
          ) : (
            <div className="space-y-3">
              {registros.map(reg => (
                <div key={reg.id} className="border border-gray-100 rounded-xl p-3">
                  {/* Línea principal */}
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${COLORS_ACCION[reg.accion] || 'bg-gray-100 text-gray-600'}`}>
                      {LABELS_ACCION[reg.accion] || reg.accion}
                    </span>
                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                      {LABELS_ORIGEN[reg.origen] || reg.origen}
                    </span>
                    {reg.usuario && (
                      <span className="text-xs text-gray-500">
                        por <strong>{reg.usuario}</strong>
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {formatFecha(reg.created_at)}
                    </span>
                  </div>

                  {/* Detalle libre */}
                  {reg.detalle && (
                    <p className="text-xs text-gray-500 mb-1.5">{reg.detalle}</p>
                  )}

                  {/* Cambios */}
                  {reg.cambios && Object.keys(reg.cambios).length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {Object.entries(reg.cambios).map(([campo, { antes, despues }]) => (
                        <div key={campo} className="flex items-start gap-2 text-xs">
                          <span className="font-medium text-gray-600 min-w-[100px] shrink-0">
                            {LABELS_CAMPO[campo] || campo}
                          </span>
                          <span className="text-red-500 line-through break-all">
                            {formatValor(antes)}
                          </span>
                          <span className="text-gray-300">→</span>
                          <span className="text-green-600 font-medium break-all">
                            {formatValor(despues)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Paginación */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-gray-100 text-sm text-gray-500">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              Anterior
            </button>
            <span>Página {page} de {totalPaginas}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
              disabled={page >= totalPaginas}
              className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              Siguiente
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end p-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
