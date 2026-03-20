// Análisis de demanda por proveedor
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const RIESGO_BADGE = {
  rojo: 'bg-red-100 text-red-700',
  amarillo: 'bg-yellow-100 text-yellow-700',
  verde: 'bg-green-100 text-green-700',
  gris: 'bg-gray-100 text-gray-500',
}

const DemandaProveedor = () => {
  const { id } = useParams()
  const [resultado, setResultado] = useState(null)
  const [proveedor, setProveedor] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get(`/api/compras/demanda/${id}`),
      api.get(`/api/compras/proveedores/${id}`),
    ]).then(([dem, prov]) => {
      setResultado(dem.data)
      setProveedor(prov.data)
    }).catch(err => console.error(err))
      .finally(() => setCargando(false))
  }, [id])

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Demanda" sinTabs volverA="/compras/proveedores" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
        <span className="ml-3 text-sm text-gray-500">Calculando demanda...</span>
      </div>
    </div>
  )

  const demanda = resultado?.demanda || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={`Demanda — ${proveedor?.nombre || ''}`} sinTabs volverA={`/compras/proveedores/${id}`} />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Resumen IA */}
        {resultado?.resumen_ia && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-violet-600 text-sm font-medium">Análisis IA</span>
            </div>
            <p className="text-sm text-violet-800 whitespace-pre-wrap">{resultado.resumen_ia}</p>
          </div>
        )}

        {/* Tabla de demanda */}
        {demanda.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay artículos vinculados a este proveedor</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-left px-3 py-2">Artículo</th>
                  <th className="text-right px-3 py-2">Stock</th>
                  <th className="text-right px-3 py-2">Vel/día</th>
                  <th className="text-right px-3 py-2">Días stock</th>
                  <th className="text-center px-3 py-2">Tendencia</th>
                  <th className="text-center px-3 py-2">Riesgo</th>
                  <th className="text-right px-3 py-2">Sugerido</th>
                  <th className="text-right px-3 py-2">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {demanda.map(d => (
                  <tr key={d.articulo_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{d.nombre}</div>
                      <div className="text-xs text-gray-400">{d.codigo}</div>
                    </td>
                    <td className="text-right px-3 py-2 text-gray-700">{d.stock_actual}</td>
                    <td className="text-right px-3 py-2 text-gray-700">{d.velocidad_diaria}</td>
                    <td className="text-right px-3 py-2 font-medium text-gray-800">{d.dias_stock}</td>
                    <td className="text-center px-3 py-2">
                      <span className={`text-xs ${d.tendencia === 'creciente' ? 'text-green-600' : d.tendencia === 'decreciente' ? 'text-red-600' : 'text-gray-400'}`}>
                        {d.tendencia === 'creciente' ? '↑' : d.tendencia === 'decreciente' ? '↓' : '→'}
                      </span>
                    </td>
                    <td className="text-center px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${RIESGO_BADGE[d.riesgo]}`}>{d.riesgo}</span>
                    </td>
                    <td className="text-right px-3 py-2">
                      {d.cantidad_sugerida > 0 && (
                        <span className="font-medium text-amber-700">
                          {d.cantidad_sugerida} {d.unidad_compra !== 'unidad' ? d.unidad_compra : ''}
                        </span>
                      )}
                      {d.promo_activa && (
                        <div className="text-xs text-green-600">{d.promo_activa.descripcion || d.promo_activa.tipo}</div>
                      )}
                    </td>
                    <td className="text-right px-3 py-2 text-gray-600">
                      {d.subtotal > 0 ? `$${d.subtotal.toLocaleString('es-AR')}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={7} className="px-3 py-2 text-right text-gray-600">Total estimado</td>
                  <td className="text-right px-3 py-2 text-amber-700">
                    ${demanda.reduce((s, d) => s + (d.subtotal || 0), 0).toLocaleString('es-AR')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default DemandaProveedor
