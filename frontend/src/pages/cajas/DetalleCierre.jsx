// Detalle de un cierre de caja con comparación cajero vs gestor
import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADOS = {
  pendiente_gestor: { label: 'Pendiente verificación', color: 'bg-yellow-100 text-yellow-700' },
  pendiente_agente: { label: 'Verificado', color: 'bg-blue-100 text-blue-700' },
  cerrado: { label: 'Cerrado', color: 'bg-green-100 text-green-700' },
  con_diferencia: { label: 'Con diferencia', color: 'bg-red-100 text-red-700' },
}

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const DENOMINACIONES_BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100]
const DENOMINACIONES_MONEDAS = [500, 200, 100, 50, 20, 10, 5, 2, 1]

const FilaComparativa = ({ label, valorCajero, valorGestor, esMoneda = true }) => {
  const cajero = esMoneda ? formatMonto(valorCajero) : valorCajero
  const gestor = esMoneda ? formatMonto(valorGestor) : valorGestor
  const hayDiferencia = valorCajero !== valorGestor
  return (
    <div className={`flex items-center text-sm py-1.5 ${hayDiferencia ? 'bg-red-50 -mx-2 px-2 rounded-lg' : ''}`}>
      <span className="flex-1 text-gray-600">{label}</span>
      <span className="w-28 text-right font-medium text-gray-800">{cajero}</span>
      <span className={`w-28 text-right font-medium ${hayDiferencia ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{gestor}</span>
    </div>
  )
}

const DetalleCierre = () => {
  const { id } = useParams()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data: cierreData } = await api.get(`/api/cierres/${id}`)
        setCierre(cierreData)

        // Intentar cargar verificación si no es operario y no es blind
        if (usuario?.rol !== 'operario' && !cierreData._blind) {
          try {
            const { data: verifData } = await api.get(`/api/cierres/${id}/verificacion`)
            setVerificacion(verifData)
          } catch {
            // No hay verificación aún
          }
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar cierre')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id, usuario?.rol])

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre" sinTabs />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre" sinTabs />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
          <Link to="/cajas" className="text-sm text-emerald-600 mt-4 inline-block">Volver</Link>
        </div>
      </div>
    )
  }

  const estadoCfg = ESTADOS[cierre.estado] || { label: cierre.estado, color: 'bg-gray-100 text-gray-700' }
  const esBlind = cierre._blind

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Cierre" sinTabs />

      <div className="px-4 py-4 max-w-lg mx-auto space-y-4">

        {/* Metadata */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">{cierre.cajas?.nombre}</h2>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoCfg.color}`}>
              {estadoCfg.label}
            </span>
          </div>
          <div className="text-sm text-gray-500 space-y-0.5">
            <p>Fecha: {formatFecha(cierre.fecha)}</p>
            <p>Cajero: {cierre.cajero?.nombre}</p>
            {cierre.cajas?.sucursales?.nombre && (
              <p>Sucursal: {cierre.cajas.sucursales.nombre}</p>
            )}
            {!esBlind && cierre.fondo_fijo > 0 && (
              <p>Fondo fijo: {formatMonto(cierre.fondo_fijo)}</p>
            )}
          </div>
        </div>

        {/* Modo ciego para gestor */}
        {esBlind && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-yellow-800">
              Debés realizar tu conteo independiente antes de ver los montos del cajero.
            </p>
            <Link
              to={`/cajas/verificar/${cierre.id}`}
              className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
            >
              Verificar cierre
            </Link>
          </div>
        )}

        {/* Montos del cajero (si no es blind) */}
        {!esBlind && !verificacion && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Detalle del cierre</h3>

            {/* Billetes */}
            {cierre.billetes && Object.keys(cierre.billetes).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Billetes</p>
                {DENOMINACIONES_BILLETES.filter(d => cierre.billetes[d] > 0).map(d => (
                  <div key={d} className="flex justify-between text-sm py-0.5">
                    <span className="text-gray-600">${d.toLocaleString('es-AR')} x {cierre.billetes[d]}</span>
                    <span className="text-gray-800 font-medium">{formatMonto(d * cierre.billetes[d])}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Monedas */}
            {cierre.monedas && Object.keys(cierre.monedas).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Monedas</p>
                {DENOMINACIONES_MONEDAS.filter(d => cierre.monedas[d] > 0).map(d => (
                  <div key={d} className="flex justify-between text-sm py-0.5">
                    <span className="text-gray-600">${d.toLocaleString('es-AR')} x {cierre.monedas[d]}</span>
                    <span className="text-gray-800 font-medium">{formatMonto(d * cierre.monedas[d])}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total efectivo</span>
                <span className="font-medium">{formatMonto(cierre.total_efectivo)}</span>
              </div>
              {cierre.cheques > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Cheques ({cierre.cheques_cantidad})</span>
                  <span className="font-medium">{formatMonto(cierre.cheques)}</span>
                </div>
              )}
              {cierre.vouchers_tc > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Vouchers TC ({cierre.vouchers_tc_cantidad})</span>
                  <span className="font-medium">{formatMonto(cierre.vouchers_tc)}</span>
                </div>
              )}
              {cierre.vouchers_td > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Vouchers TD ({cierre.vouchers_td_cantidad})</span>
                  <span className="font-medium">{formatMonto(cierre.vouchers_td)}</span>
                </div>
              )}
              {cierre.transferencias > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Transferencias ({cierre.transferencias_cantidad})</span>
                  <span className="font-medium">{formatMonto(cierre.transferencias)}</span>
                </div>
              )}
              {cierre.pagos_digitales > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Pagos digitales ({cierre.pagos_digitales_cantidad})</span>
                  <span className="font-medium">{formatMonto(cierre.pagos_digitales)}</span>
                </div>
              )}
              {cierre.otros > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Otros{cierre.otros_detalle ? ` (${cierre.otros_detalle})` : ''}</span>
                  <span className="font-medium">{formatMonto(cierre.otros)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t border-gray-200">
                <span>Total general</span>
                <span className="text-emerald-700">{formatMonto(cierre.total_general)}</span>
              </div>
            </div>

            {cierre.observaciones && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-400">Observaciones</p>
                <p className="text-sm text-gray-700">{cierre.observaciones}</p>
              </div>
            )}
          </div>
        )}

        {/* Tabla comparativa (si hay verificación) */}
        {!esBlind && verificacion && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Comparación cajero vs gestor</h3>
            <p className="text-xs text-gray-400">Gestor: {verificacion.gestor?.nombre}</p>

            {/* Header */}
            <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-100">
              <span className="flex-1">Concepto</span>
              <span className="w-28 text-right">Cajero</span>
              <span className="w-28 text-right">Gestor</span>
            </div>

            <FilaComparativa label="Total efectivo" valorCajero={parseFloat(cierre.total_efectivo)} valorGestor={parseFloat(verificacion.total_efectivo)} />
            <FilaComparativa label="Cheques" valorCajero={parseFloat(cierre.cheques)} valorGestor={parseFloat(verificacion.cheques)} />
            <FilaComparativa label="Vouchers TC" valorCajero={parseFloat(cierre.vouchers_tc)} valorGestor={parseFloat(verificacion.vouchers_tc)} />
            <FilaComparativa label="Vouchers TD" valorCajero={parseFloat(cierre.vouchers_td)} valorGestor={parseFloat(verificacion.vouchers_td)} />
            <FilaComparativa label="Transferencias" valorCajero={parseFloat(cierre.transferencias)} valorGestor={parseFloat(verificacion.transferencias)} />
            <FilaComparativa label="Pagos digitales" valorCajero={parseFloat(cierre.pagos_digitales)} valorGestor={parseFloat(verificacion.pagos_digitales)} />
            <FilaComparativa label="Otros" valorCajero={parseFloat(cierre.otros)} valorGestor={parseFloat(verificacion.otros)} />

            <div className="border-t border-gray-200 pt-2">
              <FilaComparativa label="TOTAL GENERAL" valorCajero={parseFloat(cierre.total_general)} valorGestor={parseFloat(verificacion.total_general)} />
            </div>

            {/* Diferencia */}
            {parseFloat(cierre.total_general) !== parseFloat(verificacion.total_general) && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2">
                <p className="text-sm font-semibold text-red-700">
                  Diferencia: {formatMonto(parseFloat(verificacion.total_general) - parseFloat(cierre.total_general))}
                </p>
              </div>
            )}

            {parseFloat(cierre.total_general) === parseFloat(verificacion.total_general) && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
                <p className="text-sm font-semibold text-green-700">Sin diferencias</p>
              </div>
            )}
          </div>
        )}

        {/* Botón verificar para gestor/admin si aún no verificado */}
        {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && !esBlind && (
          <Link
            to={`/cajas/verificar/${cierre.id}`}
            className="block w-full bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
          >
            Verificar cierre
          </Link>
        )}

        <Link
          to="/cajas"
          className="block text-center text-sm text-gray-500 hover:text-gray-700 py-2"
        >
          Volver a Control de Cajas
        </Link>
      </div>
    </div>
  )
}

export default DetalleCierre
