// Crear nueva orden de compra con sugerencias IA
import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const MOTIVOS = [
  { value: 'consumo_interno', label: 'Consumo interno' },
  { value: 'pedido_especial', label: 'Pedido especial' },
  { value: 'estacionalidad', label: 'Estacionalidad' },
  { value: 'promo_propia', label: 'Promo propia' },
  { value: 'merma', label: 'Merma/vencimiento' },
  { value: 'otro', label: 'Otro' },
]

const NuevaOrden = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [proveedores, setProveedores] = useState([])
  const [proveedorId, setProveedorId] = useState(searchParams.get('proveedor') || '')
  const [items, setItems] = useState([])
  const [justificacion, setJustificacion] = useState('')
  const [alertas, setAlertas] = useState([])
  const [notas, setNotas] = useState('')
  const [cargandoIA, setCargandoIA] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [ajusteIdx, setAjusteIdx] = useState(null)
  const [ajusteMotivo, setAjusteMotivo] = useState('otro')
  const [ajusteNota, setAjusteNota] = useState('')

  useEffect(() => {
    api.get('/api/compras/proveedores')
      .then(r => setProveedores(r.data?.filter(p => p.activo !== false) || []))
      .catch(err => console.error(err))
  }, [])

  // Auto-cargar si viene con proveedor
  useEffect(() => {
    if (proveedorId) generarSugerencia()
  }, [])

  const generarSugerencia = async () => {
    if (!proveedorId) return
    setCargandoIA(true)
    setItems([])
    try {
      const { data } = await api.post(`/api/compras/orden-sugerida/${proveedorId}`)
      setItems((data.items || []).map(i => ({ ...i, _modificado: false })))
      setJustificacion(data.justificacion || '')
      setAlertas(data.alertas || [])
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setCargandoIA(false)
    }
  }

  const actualizarCantidad = (idx, nuevaCantidad) => {
    setItems(prev => {
      const nuevo = [...prev]
      const item = { ...nuevo[idx] }
      item.cantidad_final = Number(nuevaCantidad)
      item.subtotal = item.cantidad_final * (item.precio_unitario || 0)
      item._modificado = item.cantidad_final !== item.cantidad_sugerida_ia
      nuevo[idx] = item
      return nuevo
    })
    // Si cambió, mostrar selector de motivo
    const item = items[idx]
    if (Number(nuevaCantidad) !== item.cantidad_sugerida_ia) {
      setAjusteIdx(idx)
    }
  }

  const confirmarAjuste = async () => {
    if (ajusteIdx === null) return
    const item = items[ajusteIdx]
    try {
      await api.post('/api/compras/ajustes', {
        articulo_id: item.articulo_id,
        cantidad_sugerida: item.cantidad_sugerida_ia,
        cantidad_final: item.cantidad_final,
        motivo: ajusteMotivo,
        nota: ajusteNota,
      })
    } catch {}
    setAjusteIdx(null)
    setAjusteMotivo('otro')
    setAjusteNota('')
  }

  const guardarOrden = async (enviar = false) => {
    if (!proveedorId || items.length === 0) return
    setGuardando(true)
    try {
      const { data } = await api.post('/api/compras/ordenes', {
        proveedor_id: proveedorId,
        items: items.map(i => ({
          articulo_id: i.articulo_id,
          codigo: i.codigo,
          nombre: i.nombre,
          cantidad_sugerida_ia: i.cantidad_sugerida_ia,
          cantidad_final: i.cantidad_final,
          unidad_compra: i.unidad_compra,
          factor_conversion: i.factor_conversion,
          precio_unitario: i.precio_unitario,
          subtotal: i.subtotal,
          motivo_ajuste: i._modificado ? i.motivo_ajuste : null,
        })),
        notas,
      })

      if (enviar && data.id) {
        await api.put(`/api/compras/ordenes/${data.id}/enviar`)
      }

      navigate(`/compras/ordenes/${data.id}`)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  const total = items.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Nueva Orden de Compra" sinTabs volverA="/compras/ordenes" />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Selector proveedor */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500">Proveedor</label>
              <select value={proveedorId} onChange={e => setProveedorId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1">
                <option value="">Seleccionar proveedor...</option>
                {proveedores.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre} ({p.total_articulos} art.)</option>
                ))}
              </select>
            </div>
            <button onClick={generarSugerencia} disabled={!proveedorId || cargandoIA}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {cargandoIA ? 'Analizando...' : 'Generar con IA'}
            </button>
          </div>
        </div>

        {/* Loading IA */}
        {cargandoIA && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto mb-3" />
            <p className="text-sm text-violet-700">Analizando demanda y generando sugerencias...</p>
          </div>
        )}

        {/* Justificación IA */}
        {justificacion && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <p className="text-sm text-violet-800">{justificacion}</p>
          </div>
        )}

        {/* Alertas */}
        {alertas.length > 0 && (
          <div className="space-y-2">
            {alertas.map((a, i) => (
              <div key={i} className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-sm text-yellow-800">{a}</div>
            ))}
          </div>
        )}

        {/* Tabla items */}
        {items.length > 0 && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="text-left px-3 py-2">Artículo</th>
                    <th className="text-right px-3 py-2">Stock</th>
                    <th className="text-right px-3 py-2">Vel/día</th>
                    <th className="text-right px-3 py-2">Sugerido IA</th>
                    <th className="text-right px-3 py-2">Cantidad</th>
                    <th className="text-center px-3 py-2">Unidad</th>
                    <th className="text-right px-3 py-2">Precio</th>
                    <th className="text-right px-3 py-2">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item, idx) => (
                    <tr key={idx} className={`hover:bg-gray-50 ${item.riesgo === 'rojo' ? 'bg-red-50' : item.riesgo === 'amarillo' ? 'bg-yellow-50' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{item.nombre}</div>
                        <div className="text-xs text-gray-400">{item.codigo}</div>
                        {item.promo_activa && <div className="text-xs text-green-600 mt-0.5">{item.promo_activa.descripcion || item.promo_activa.tipo}</div>}
                      </td>
                      <td className="text-right px-3 py-2 text-gray-600">{item.stock_actual ?? '-'}</td>
                      <td className="text-right px-3 py-2 text-gray-600">{item.velocidad_diaria ?? '-'}</td>
                      <td className="text-right px-3 py-2 text-gray-400">{item.cantidad_sugerida_ia}</td>
                      <td className="text-right px-3 py-2">
                        <input type="number" value={item.cantidad_final} onChange={e => actualizarCantidad(idx, e.target.value)}
                          className={`w-20 text-sm text-right border rounded px-2 py-1 ${item._modificado ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} />
                      </td>
                      <td className="text-center px-3 py-2 text-gray-500 text-xs">{item.unidad_compra}</td>
                      <td className="text-right px-3 py-2 text-gray-600">${Number(item.precio_unitario || 0).toLocaleString('es-AR')}</td>
                      <td className="text-right px-3 py-2 font-medium text-gray-700">${Number(item.subtotal || 0).toLocaleString('es-AR')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-medium">
                    <td colSpan={7} className="text-right px-3 py-2 text-gray-600">Total</td>
                    <td className="text-right px-3 py-2 text-amber-700 text-lg">${total.toLocaleString('es-AR')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Modal ajuste */}
            {ajusteIdx !== null && (
              <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl p-5 w-full max-w-sm mx-4 space-y-3">
                  <h3 className="font-medium text-gray-800">Motivo del ajuste</h3>
                  <p className="text-xs text-gray-500">
                    {items[ajusteIdx]?.nombre}: IA sugirió {items[ajusteIdx]?.cantidad_sugerida_ia}, vos pusiste {items[ajusteIdx]?.cantidad_final}
                  </p>
                  <select value={ajusteMotivo} onChange={e => setAjusteMotivo(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2">
                    {MOTIVOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input placeholder="Nota (opcional)" value={ajusteNota} onChange={e => setAjusteNota(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setAjusteIdx(null)} className="text-sm text-gray-500 px-3 py-1.5">Omitir</button>
                    <button onClick={confirmarAjuste}
                      className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Confirmar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Notas */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="text-xs text-gray-500">Notas para la orden</label>
              <textarea value={notas} onChange={e => setNotas(e.target.value)}
                placeholder="Notas adicionales..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1" rows={2} />
            </div>

            {/* Acciones */}
            <div className="flex gap-3 justify-end">
              <button onClick={() => guardarOrden(false)} disabled={guardando}
                className="text-sm text-gray-600 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
                {guardando ? 'Guardando...' : 'Guardar borrador'}
              </button>
              <button onClick={() => guardarOrden(true)} disabled={guardando}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-medium">
                {guardando ? 'Guardando...' : 'Guardar y enviar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default NuevaOrden
