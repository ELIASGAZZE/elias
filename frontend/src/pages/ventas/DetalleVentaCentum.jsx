// Detalle completo de una venta de Centum BI
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const formatFechaHora = (fecha) => {
  if (!fecha) return '—'
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatPrecio = (precio) => {
  if (precio == null || precio === 0) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const formatCantidad = (cant) => {
  if (cant == null) return '0'
  const n = parseFloat(cant)
  return n % 1 === 0 ? String(n) : n.toFixed(3)
}

const TIPO_COMPROBANTE = {
  1: 'Factura A', 3: 'Nota de Crédito A', 4: 'Factura B',
  6: 'Nota de Crédito B', 7: 'Nota de Crédito C', 8: 'Nota de Crédito E',
}

const CONDICION_IVA = {
  1892: 'Consumidor Final', 1893: 'Exento', 1894: 'Monotributo', 1895: 'Responsable Inscripto',
}

const DetalleVentaCentum = () => {
  const { ventaId } = useParams()
  const navigate = useNavigate()
  const [venta, setVenta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const handleVolver = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/ventas/auditoria')
  }

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get(`/api/pos/ventas/auditoria-centum/${ventaId}`)
        setVenta(data.venta)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar venta de Centum BI')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [ventaId])

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar sinTabs titulo="Detalle Venta Centum" onVolver={handleVolver} />
        <div className="text-center text-gray-400 py-20">Cargando...</div>
      </div>
    )
  }

  if (error || !venta) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar sinTabs titulo="Detalle Venta Centum" onVolver={handleVolver} />
        <div className="text-center py-20">
          <p className="text-red-600 text-sm">{error || 'Venta no encontrada'}</p>
        </div>
      </div>
    )
  }

  const items = venta.items || []
  const esNC = [3, 6, 7, 8].includes(venta.TipoComprobanteID)
  const division = venta.DivisionEmpresaGrupoEconomicoID === 3 ? 'EMPRESA' : 'PRUEBA'

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar sinTabs titulo={`Venta Centum #${venta.VentaID} — ${venta.NumeroDocumento || ''}`} onVolver={handleVolver} />

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Información General */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Informacion General</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">VentaID</span>
            <span className="text-gray-800 font-medium">{venta.VentaID}</span>

            <span className="text-gray-500">Nro Documento</span>
            <span className="text-gray-800 font-medium font-mono">{venta.NumeroDocumento || '—'}</span>

            <span className="text-gray-500">Tipo Comprobante</span>
            <span className={`font-medium ${esNC ? 'text-red-600' : 'text-gray-800'}`}>
              {TIPO_COMPROBANTE[venta.TipoComprobanteID] || `Tipo ${venta.TipoComprobanteID}`}
            </span>

            <span className="text-gray-500">Fecha Documento</span>
            <span className="text-gray-800">{formatFechaHora(venta.FechaDocumento)}</span>

            <span className="text-gray-500">Fecha Creacion</span>
            <span className="text-gray-800">{formatFechaHora(venta.FechaCreacion)}</span>

            {venta.FechaImputacion && (
              <>
                <span className="text-gray-500">Fecha Imputacion</span>
                <span className="text-gray-800">{formatFechaHora(venta.FechaImputacion)}</span>
              </>
            )}

            <span className="text-gray-500">Division</span>
            <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
              division === 'EMPRESA' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
            }`}>{division}</span>

            <span className="text-gray-500">Sucursal</span>
            <span className="text-gray-800">{venta.NombreSucursalFisica || '—'}</span>

            <span className="text-gray-500">Usuario</span>
            <span className="text-gray-800">{venta.NombreUsuario || `ID ${venta.UsuarioID}`}</span>

            {venta.NombreVendedor && (
              <>
                <span className="text-gray-500">Vendedor</span>
                <span className="text-gray-800">{venta.NombreVendedor}</span>
              </>
            )}

            <span className="text-gray-500">Condicion IVA Venta</span>
            <span className="text-gray-800">{CONDICION_IVA[venta.CondicionIVAVentaID] || venta.CondicionIVAVentaID || '—'}</span>

            <span className="text-gray-500">Condicion Venta</span>
            <span className="text-gray-800">{venta.EsContado ? 'Contado' : 'Cuenta Corriente'}</span>

            {venta.Referencia && (
              <>
                <span className="text-gray-500">Referencia</span>
                <span className="text-gray-800">{venta.Referencia}</span>
              </>
            )}

            {venta.ListaPrecioID && (
              <>
                <span className="text-gray-500">Lista de Precio</span>
                <span className="text-gray-800">ID {venta.ListaPrecioID}</span>
              </>
            )}

            {venta.Anulado ? (
              <>
                <span className="text-gray-500">Estado</span>
                <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">ANULADO</span>
              </>
            ) : null}
          </div>
        </div>

        {/* Datos del Cliente */}
        {(venta.RazonSocialCliente || venta.CUITCliente) && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Datos del Cliente</h2>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-gray-500">Razon Social</span>
              <span className="text-gray-800 font-medium">{venta.RazonSocialCliente || '—'}</span>

              {venta.CodigoCliente && (
                <>
                  <span className="text-gray-500">Codigo</span>
                  <span className="text-gray-800">{venta.CodigoCliente}</span>
                </>
              )}

              {venta.CUITCliente && (
                <>
                  <span className="text-gray-500">CUIT</span>
                  <span className="text-gray-800">{venta.CUITCliente}</span>
                </>
              )}

              {venta.CondicionIVAClienteID && (
                <>
                  <span className="text-gray-500">Condicion IVA</span>
                  <span className="text-gray-800">{CONDICION_IVA[venta.CondicionIVAClienteID] || venta.CondicionIVAClienteID}</span>
                </>
              )}

              {venta.DireccionCliente && (
                <>
                  <span className="text-gray-500">Direccion</span>
                  <span className="text-gray-800">{venta.DireccionCliente}{venta.LocalidadCliente ? `, ${venta.LocalidadCliente}` : ''}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Importes */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Importes</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            {venta.SubTotal != null && venta.SubTotal !== 0 && (
              <>
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-800">{formatPrecio(venta.SubTotal)}</span>
              </>
            )}

            {venta.DescuentoPorcentaje > 0 && (
              <>
                <span className="text-gray-500">Descuento</span>
                <span className="text-gray-800">{venta.DescuentoPorcentaje}%</span>
              </>
            )}

            {venta.SubtotalSinImpuestosConDescuento != null && venta.SubtotalSinImpuestosConDescuento !== 0 && (
              <>
                <span className="text-gray-500">Subtotal s/impuestos</span>
                <span className="text-gray-800">{formatPrecio(venta.SubtotalSinImpuestosConDescuento)}</span>
              </>
            )}

            {venta.NetoGravado != null && venta.NetoGravado !== 0 && (
              <>
                <span className="text-gray-500">Neto Gravado</span>
                <span className="text-gray-800">{formatPrecio(venta.NetoGravado)}</span>
              </>
            )}

            {venta.IVA != null && venta.IVA !== 0 && (
              <>
                <span className="text-gray-500">IVA</span>
                <span className="text-gray-800">{formatPrecio(venta.IVA)}</span>
              </>
            )}

            {venta.NoGravado != null && venta.NoGravado !== 0 && (
              <>
                <span className="text-gray-500">No Gravado</span>
                <span className="text-gray-800">{formatPrecio(venta.NoGravado)}</span>
              </>
            )}

            {venta.Exento != null && venta.Exento !== 0 && (
              <>
                <span className="text-gray-500">Exento</span>
                <span className="text-gray-800">{formatPrecio(venta.Exento)}</span>
              </>
            )}

            {venta.ImpuestosInternos != null && venta.ImpuestosInternos !== 0 && (
              <>
                <span className="text-gray-500">Impuestos Internos</span>
                <span className="text-gray-800">{formatPrecio(venta.ImpuestosInternos)}</span>
              </>
            )}

            {venta.RegimenesEspeciales != null && venta.RegimenesEspeciales !== 0 && (
              <>
                <span className="text-gray-500">Regimenes Especiales</span>
                <span className="text-gray-800">{formatPrecio(venta.RegimenesEspeciales)}</span>
              </>
            )}

            <span className="text-gray-500 font-semibold">Total</span>
            <span className={`font-bold text-lg ${esNC ? 'text-red-600' : 'text-gray-800'}`}>
              {formatPrecio(venta.Total)}
            </span>

            {venta.TotalRecibidoContado != null && venta.TotalRecibidoContado !== 0 && (
              <>
                <span className="text-gray-500">Total Recibido Contado</span>
                <span className="text-gray-800">{formatPrecio(venta.TotalRecibidoContado)}</span>
              </>
            )}
          </div>
        </div>

        {/* Items */}
        {items.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Items ({items.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-2 py-2">Codigo</th>
                    <th className="px-2 py-2">Articulo</th>
                    <th className="px-2 py-2 text-right">Cant</th>
                    <th className="px-2 py-2 text-right">Precio</th>
                    <th className="px-2 py-2 text-right">IVA %</th>
                    <th className="px-2 py-2 text-right">Desc.</th>
                    <th className="px-2 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item, i) => {
                    const subtotal = (parseFloat(item.Precio) || 0) * (parseFloat(item.Cantidad) || 0)
                    const descTotal = (item.Descuento1 || 0) + (item.Descuento2 || 0) + (item.Descuento3 || 0) + (item.DescuentoPromocion || 0)
                    return (
                      <tr key={item.VentaItemID || i} className="hover:bg-gray-50">
                        <td className="px-2 py-2 text-gray-500 font-mono text-xs">{item.CodigoArticulo || '—'}</td>
                        <td className="px-2 py-2 text-gray-800 max-w-[250px] truncate" title={item.NombreArticulo}>
                          {item.NombreArticulo || `Artículo ${item.ArticuloID}`}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-700">{formatCantidad(item.Cantidad)}</td>
                        <td className="px-2 py-2 text-right text-gray-700">{formatPrecio(item.Precio)}</td>
                        <td className="px-2 py-2 text-right text-gray-500">{item.ImpuestoTasa || 0}%</td>
                        <td className="px-2 py-2 text-right text-gray-500">
                          {descTotal > 0 ? `${descTotal}%` : '—'}
                        </td>
                        <td className="px-2 py-2 text-right font-medium text-gray-800">{formatPrecio(subtotal)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Observaciones */}
        {(venta.NotaVenta || venta.ObservacionVenta || venta.ObservacionInternaVenta) && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Observaciones</h2>
            <div className="space-y-2 text-sm">
              {venta.NotaVenta && (
                <div>
                  <span className="text-gray-500 text-xs">Nota:</span>
                  <p className="text-gray-800">{venta.NotaVenta}</p>
                </div>
              )}
              {venta.ObservacionVenta && (
                <div>
                  <span className="text-gray-500 text-xs">Observacion:</span>
                  <p className="text-gray-800">{venta.ObservacionVenta}</p>
                </div>
              )}
              {venta.ObservacionInternaVenta && (
                <div>
                  <span className="text-gray-500 text-xs">Observacion Interna:</span>
                  <p className="text-gray-800">{venta.ObservacionInternaVenta}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Otros datos */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">Otros Datos</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-600">
            <span>SucursalFisicaID</span><span>{venta.SucursalFisicaID}</span>
            <span>ClienteID</span><span>{venta.ClienteID}</span>
            <span>UsuarioID</span><span>{venta.UsuarioID}</span>
            {venta.VendedorID && (<><span>VendedorID</span><span>{venta.VendedorID}</span></>)}
            {venta.ListaPrecioID && (<><span>ListaPrecioID</span><span>{venta.ListaPrecioID}</span></>)}
            {venta.MonedaVentaID && (<><span>MonedaVentaID</span><span>{venta.MonedaVentaID}</span></>)}
            {venta.CotizacionVenta != null && venta.CotizacionVenta !== 1 && (<><span>Cotizacion</span><span>{venta.CotizacionVenta}</span></>)}
            {venta.CondicionVentaID && (<><span>CondicionVentaID</span><span>{venta.CondicionVentaID}</span></>)}
            {venta.BonificacionVentaID && (<><span>BonificacionVentaID</span><span>{venta.BonificacionVentaID}</span></>)}
            {venta.TipoVentaFiscalID && (<><span>TipoVentaFiscalID</span><span>{venta.TipoVentaFiscalID}</span></>)}
            {venta.FechaEntrega && (<><span>Fecha Entrega</span><span>{formatFechaHora(venta.FechaEntrega)}</span></>)}
            {venta.TurnoEntregaID && (<><span>TurnoEntregaID</span><span>{venta.TurnoEntregaID}</span></>)}
            {venta.TransporteVentaID && (<><span>TransporteVentaID</span><span>{venta.TransporteVentaID}</span></>)}
            {venta.CentroCostosID && (<><span>CentroCostosID</span><span>{venta.CentroCostosID}</span></>)}
            {venta.FechaVencimiento && (<><span>Fecha Vencimiento</span><span>{formatFechaHora(venta.FechaVencimiento)}</span></>)}
            <span>BaseDatosGrupoEconomicoID</span><span>{venta.BaseDatosGrupoEconomicoID}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DetalleVentaCentum
