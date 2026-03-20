// Detalle de proveedor: editar + artículos + promos
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ProveedorDetalle = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [proveedor, setProveedor] = useState(null)
  const [articulos, setArticulos] = useState([])
  const [promos, setPromos] = useState([])
  const [tab, setTab] = useState('info')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  // Form artículo
  const [nuevoArt, setNuevoArt] = useState({ articulo_id: '', unidad_compra: 'unidad', factor_conversion: 1, precio_compra: '' })
  const [busquedaArt, setBusquedaArt] = useState('')
  const [articulosDisp, setArticulosDisp] = useState([])

  // Form promo
  const [nuevaPromo, setNuevaPromo] = useState({ tipo: 'bonificacion', descripcion: '', cantidad_minima: '', cantidad_bonus: '', descuento_porcentaje: '', vigente_hasta: '' })

  useEffect(() => {
    Promise.all([
      api.get(`/api/compras/proveedores/${id}`),
      api.get(`/api/compras/proveedores/${id}/articulos`),
      api.get(`/api/compras/proveedores/${id}/promociones`),
    ]).then(([prov, arts, proms]) => {
      setProveedor(prov.data)
      setArticulos(arts.data)
      setPromos(proms.data)
    }).catch(err => console.error(err))
      .finally(() => setCargando(false))
  }, [id])

  const guardarProveedor = async () => {
    setGuardando(true)
    try {
      const { data } = await api.put(`/api/compras/proveedores/${id}`, proveedor)
      setProveedor(data)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  // Buscar artículos disponibles
  const buscarArticulos = async (q) => {
    setBusquedaArt(q)
    if (q.length < 2) { setArticulosDisp([]); return }
    try {
      const { data } = await api.get(`/api/articulos?busqueda=${encodeURIComponent(q)}&limit=10`)
      setArticulosDisp(data || [])
    } catch { setArticulosDisp([]) }
  }

  const vincularArticulo = async (artId) => {
    try {
      await api.post(`/api/compras/proveedores/${id}/articulos`, {
        articulo_id: artId,
        unidad_compra: nuevoArt.unidad_compra,
        factor_conversion: nuevoArt.factor_conversion,
        precio_compra: nuevoArt.precio_compra || null,
      })
      const { data } = await api.get(`/api/compras/proveedores/${id}/articulos`)
      setArticulos(data)
      setBusquedaArt('')
      setArticulosDisp([])
      setNuevoArt({ articulo_id: '', unidad_compra: 'unidad', factor_conversion: 1, precio_compra: '' })
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const desvincularArticulo = async (paId) => {
    if (!confirm('Desvincular artículo?')) return
    try {
      await api.delete(`/api/compras/proveedor-articulos/${paId}`)
      setArticulos(prev => prev.filter(a => a.id !== paId))
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const crearPromo = async () => {
    try {
      await api.post(`/api/compras/proveedores/${id}/promociones`, nuevaPromo)
      const { data } = await api.get(`/api/compras/proveedores/${id}/promociones`)
      setPromos(data)
      setNuevaPromo({ tipo: 'bonificacion', descripcion: '', cantidad_minima: '', cantidad_bonus: '', descuento_porcentaje: '', vigente_hasta: '' })
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const eliminarPromo = async (promoId) => {
    if (!confirm('Eliminar promoción?')) return
    try {
      await api.delete(`/api/compras/proveedor-promociones/${promoId}`)
      setPromos(prev => prev.filter(p => p.id !== promoId))
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Proveedor" sinTabs volverA="/compras/proveedores" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
      </div>
    </div>
  )

  if (!proveedor) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Proveedor" sinTabs volverA="/compras/proveedores" />
      <div className="text-center py-20 text-gray-400">Proveedor no encontrado</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={proveedor.nombre} sinTabs volverA="/compras/proveedores" />

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {['info', 'articulos', 'promociones'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-sm py-2 rounded-md transition-colors ${tab === t ? 'bg-white text-gray-800 font-medium shadow-sm' : 'text-gray-500'}`}>
              {t === 'info' ? 'Datos' : t === 'articulos' ? `Artículos (${articulos.length})` : `Promos (${promos.length})`}
            </button>
          ))}
        </div>

        {/* Tab: Info */}
        {tab === 'info' && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['nombre', 'Nombre', 'text'],
                ['cuit', 'CUIT', 'text'],
                ['codigo', 'Código', 'text'],
                ['lead_time_dias', 'Lead time (días)', 'number'],
                ['lead_time_variabilidad_dias', 'Variabilidad LT (días)', 'number'],
                ['contacto', 'Contacto', 'text'],
                ['telefono', 'Teléfono', 'text'],
                ['email', 'Email', 'text'],
                ['whatsapp', 'WhatsApp', 'text'],
                ['monto_minimo', 'Monto mínimo ($)', 'number'],
              ].map(([key, label, type]) => (
                <div key={key}>
                  <label className="text-xs text-gray-500">{label}</label>
                  <input type={type} value={proveedor[key] || ''} onChange={e => setProveedor({...proveedor, [key]: type === 'number' ? Number(e.target.value) : e.target.value})}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:border-amber-400" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-gray-500">Notas</label>
              <textarea value={proveedor.notas || ''} onChange={e => setProveedor({...proveedor, notas: e.target.value})}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:border-amber-400" rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={proveedor.activo !== false} onChange={e => setProveedor({...proveedor, activo: e.target.checked})} />
                Activo
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => navigate(`/compras/nueva-orden?proveedor=${id}`)}
                className="text-sm text-amber-600 hover:text-amber-700 px-3 py-1.5 border border-amber-200 rounded-lg">
                Generar OC
              </button>
              <button onClick={guardarProveedor} disabled={guardando}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
                {guardando ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        )}

        {/* Tab: Artículos */}
        {tab === 'articulos' && (
          <div className="space-y-3">
            {/* Buscador para vincular */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <h4 className="text-sm font-medium text-gray-700">Vincular artículo</h4>
              <div className="flex gap-2">
                <input placeholder="Buscar artículo por nombre o código..." value={busquedaArt} onChange={e => buscarArticulos(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
                <select value={nuevoArt.unidad_compra} onChange={e => setNuevoArt({...nuevoArt, unidad_compra: e.target.value})}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-2">
                  <option value="unidad">Unidad</option>
                  <option value="caja">Caja</option>
                  <option value="bolsa">Bolsa</option>
                  <option value="pack">Pack</option>
                </select>
                <input type="number" placeholder="Factor" value={nuevoArt.factor_conversion} onChange={e => setNuevoArt({...nuevoArt, factor_conversion: Number(e.target.value)})}
                  className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-2" />
                <input type="number" placeholder="$ compra" value={nuevoArt.precio_compra} onChange={e => setNuevoArt({...nuevoArt, precio_compra: e.target.value})}
                  className="w-24 text-sm border border-gray-200 rounded-lg px-2 py-2" />
              </div>
              {articulosDisp.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
                  {articulosDisp.map(a => (
                    <button key={a.id} onClick={() => vincularArticulo(a.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 border-b border-gray-100 last:border-0">
                      <span className="font-medium">{a.nombre}</span>
                      <span className="text-gray-400 ml-2">{a.codigo}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Lista artículos vinculados */}
            {articulos.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No hay artículos vinculados</div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {articulos.map(pa => (
                  <div key={pa.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{pa.articulo?.nombre || pa.articulo_id}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {pa.unidad_compra} ×{pa.factor_conversion}
                        {pa.precio_compra && <span className="ml-2">${pa.precio_compra}</span>}
                        {pa.articulo?.stock_actual != null && <span className="ml-2">Stock: {pa.articulo.stock_actual}</span>}
                      </div>
                    </div>
                    <button onClick={() => desvincularArticulo(pa.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                      Desvincular
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Promociones */}
        {tab === 'promociones' && (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h4 className="text-sm font-medium text-gray-700">Nueva promoción</h4>
              <div className="grid grid-cols-2 gap-2">
                <select value={nuevaPromo.tipo} onChange={e => setNuevaPromo({...nuevaPromo, tipo: e.target.value})}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2">
                  <option value="bonificacion">Bonificación (ej: 10+1)</option>
                  <option value="descuento">Descuento %</option>
                  <option value="precio_especial">Precio especial</option>
                </select>
                <input placeholder="Descripción" value={nuevaPromo.descripcion} onChange={e => setNuevaPromo({...nuevaPromo, descripcion: e.target.value})}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
                <input type="number" placeholder="Cant. mínima" value={nuevaPromo.cantidad_minima} onChange={e => setNuevaPromo({...nuevaPromo, cantidad_minima: e.target.value})}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
                {nuevaPromo.tipo === 'bonificacion' && (
                  <input type="number" placeholder="Cant. bonus" value={nuevaPromo.cantidad_bonus} onChange={e => setNuevaPromo({...nuevaPromo, cantidad_bonus: e.target.value})}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
                )}
                {nuevaPromo.tipo === 'descuento' && (
                  <input type="number" placeholder="Descuento %" value={nuevaPromo.descuento_porcentaje} onChange={e => setNuevaPromo({...nuevaPromo, descuento_porcentaje: e.target.value})}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
                )}
                <input type="date" placeholder="Vigente hasta" value={nuevaPromo.vigente_hasta} onChange={e => setNuevaPromo({...nuevaPromo, vigente_hasta: e.target.value})}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
              </div>
              <button onClick={crearPromo} disabled={!nuevaPromo.tipo}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
                Agregar promo
              </button>
            </div>

            {promos.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No hay promociones</div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {promos.map(p => (
                  <div key={p.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">
                        {p.tipo === 'bonificacion' ? `${p.cantidad_minima}+${p.cantidad_bonus}` :
                         p.tipo === 'descuento' ? `${p.descuento_porcentaje}% off` :
                         `$${p.precio_especial}`}
                        {p.descripcion && <span className="text-gray-500 ml-2">— {p.descripcion}</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {p.vigente_hasta ? `Hasta ${p.vigente_hasta}` : 'Sin vencimiento'}
                      </div>
                    </div>
                    <button onClick={() => eliminarPromo(p.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ProveedorDetalle
